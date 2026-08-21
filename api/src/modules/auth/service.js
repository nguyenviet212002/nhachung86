import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { withActor } from '../../core/tx.js';
import { knex } from '../../db/knex.js';
import { AppError, mapPgError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { otpAdapter } from '../../core/otp/index.js';
import { hashInviteToken } from '../invites/token.js';

// ---------------------------------------------------------------------------
// Băm định danh — dùng cho phone_hash trong otp_challenges, và cho hoá đơn
// audit "ai đã cố đăng nhập" mà không lưu số điện thoại/email thật.
// ---------------------------------------------------------------------------
export function hashPhone(phone) {
  return crypto.createHmac('sha256', config.OTP_PEPPER).update(phone).digest('hex');
}

function hashToken(raw) {
  // Token xoay vòng là chuỗi ngẫu nhiên 256-bit, KHÔNG phải mật khẩu người
  // dùng gõ — không cần hàm băm chậm (argon2) cho việc tra cứu tần suất cao
  // này; sha256 đủ vì entropy đầu vào đã rất cao (không dò được).
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// Cộng đồng — nền tảng này phục vụ MỘT cộng đồng, nhưng mọi bảng vẫn khoá
// theo community_id (kiến trúc sẵn sàng đa cộng đồng). Brief Task 7 không
// đưa ra middleware "phân giải cộng đồng theo tên miền/subdomain" (chưa tới
// lượt), nên tạm lấy cộng đồng đầu tiên đã tồn tại. Việc phân giải theo
// request thật (subdomain, header, ...) để dành cho task nào cần nó thật.
// ---------------------------------------------------------------------------
export async function resolveCommunityId() {
  const { rows: [c] } = await knex.raw(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`);
  if (!c) throw new AppError('INTERNAL', 'Chưa khởi tạo cộng đồng nào trên máy chủ này.', { status: 500 });
  return c.id;
}

// ---------------------------------------------------------------------------
// OTP — chỉ dùng để xác minh số điện thoại lúc nộp đơn gia nhập ('register')
// và đặt lại mật khẩu ('reset'). KHÔNG dùng để đăng nhập — giao diện đăng
// nhập bằng mật khẩu, không có màn nhập OTP.
// ---------------------------------------------------------------------------
// Xuất ra để bài test kiểm tính chất đệm số 0 gọi thẳng được — 500 lần gọi hàm
// thuần mất vài mili giây, còn 500 lần qua requestOtp thì mỗi lần một argon2.hash
// (cố ý chậm) cộng một vòng CSDL. Tính chất cần kiểm nằm ở hàm này, không nằm ở
// đường đi mạng, nên kiểm ở đây vừa chắc hơn vừa không làm suite chập chờn.
export function newCode() {
  // crypto.randomInt, KHÔNG PHẢI Math.random — Math.random không phải CSPRNG,
  // dò được từ vài trăm mẫu đầu ra. OTP là đường đặt lại mật khẩu, dò trúng
  // là chiếm tài khoản.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

const MAX_ATTEMPTS = 5; // sai 5 lần trên một challenge ⇒ burned, phải xin mã mới
const LOCK_AFTER_BURNED = 3; // 3 challenge hỏng liên tiếp (burned/expired) ⇒ khoá số 15 phút
const LOCK_WINDOW_MS = 15 * 60_000;

export async function requestOtp({ communityId, phone, purpose }) {
  const phoneHash = hashPhone(phone);
  return withActor(null, async (trx) => {
    // 3 challenge gần nhất (trong 1 giờ) đều hỏng (burned/expired) ⇒ khoá 15
    // phút kể từ challenge gần nhất. Không throw sau khi đã ghi gì xuống CSDL
    // ở nhánh này — tới đây chưa có UPDATE/INSERT nào cả, nên throw ngay tại
    // chỗ vẫn an toàn (không có gì để rollback mất).
    // BẪY (soát xét vòng 1, Important): brief gốc lọc bốn câu truy vấn OTP
    // này chỉ bằng phone_hash (+purpose), KHÔNG có community_id — dù bảng có
    // cột community_id NOT NULL và hàm đã nhận sẵn tham số communityId.
    // hashPhone() không trộn communityId vào HMAC, nên hai cộng đồng khác
    // nhau cùng chạy trên một máy chủ mà trùng số điện thoại (số điện thoại
    // không phải định danh duy nhất toàn cục) sẽ đụng độ: yêu cầu OTP của
    // cộng đồng A có thể so khớp/tiêu thụ challenge của cộng đồng B, và 3 lần
    // dò hỏng ở B khoá luôn số đó ở A — một cộng đồng gây từ chối dịch vụ cho
    // cộng đồng khác. Vô hại hôm nay (nền tảng đơn cộng đồng) nhưng phá đúng
    // lý do toàn bộ kiến trúc đặt community_id vào mọi bảng: để cộng đồng thứ
    // hai không phải đập đi làm lại. Thêm "AND community_id = ?" vào cả bốn
    // câu (hai câu ở đây, một câu UPDATE ngay dưới, một câu trong verifyOtp).
    const { rows: [lock] } = await trx.raw(
      `SELECT count(*)::int AS n FROM (
         SELECT status FROM otp_challenges
          WHERE phone_hash = ? AND community_id = ? AND created_at > now() - interval '1 hour'
          ORDER BY created_at DESC LIMIT ?) t
        WHERE status IN ('burned','expired')`,
      [phoneHash, communityId, LOCK_AFTER_BURNED]
    );
    if (lock.n >= LOCK_AFTER_BURNED) {
      const { rows: [last] } = await trx.raw(
        `SELECT created_at FROM otp_challenges WHERE phone_hash = ? AND community_id = ? ORDER BY created_at DESC LIMIT 1`,
        [phoneHash, communityId]
      );
      if (last && Date.now() - new Date(last.created_at).getTime() < LOCK_WINDOW_MS) {
        throw new AppError('OTP_LOCKED', 'Số này tạm khóa 15 phút do nhập sai nhiều lần.', { status: 429 });
      }
    }

    await trx.raw(
      `UPDATE otp_challenges SET status = 'expired' WHERE phone_hash = ? AND community_id = ? AND status = 'open'`,
      [phoneHash, communityId]
    );
    const code = newCode();
    await trx.raw(
      `INSERT INTO otp_challenges (community_id, phone_hash, code_hash, purpose)
       VALUES (?, ?, ?, ?)`,
      [communityId, phoneHash, await argon2.hash(code), purpose]
    );
    await otpAdapter().send({ phone, code, purpose });
  });
}

// `ch` = id của challenge đã dùng. Cần nó vì otp_token là vé MANG THEO: không
// có gì trong bản thân JWT ngăn nộp cùng một vé ba lần trong 5 phút để lập ba
// đơn gia nhập. register() dùng `ch` để đánh dấu consumed_at trên đúng hàng
// challenge đó (migration 009), nên vé chỉ tiêu được một lần.
function jwtSignOtp({ phoneHash, purpose, challengeId }) {
  return jwt.sign({ ph: phoneHash, purpose, typ: 'otp', ch: challengeId }, config.JWT_SECRET, { expiresIn: '5m' });
}

export async function verifyOtp({ communityId, phone, code, purpose }) {
  const phoneHash = hashPhone(phone);

  // BẪY (đã sửa so với bản mẫu trong brief): brief gốc ghi audit_log rồi
  // `throw` NGAY TRONG CÙNG giao dịch withActor() đang mở. core/audit.js đã
  // tự cảnh báo đúng bẫy này (bẫy mục 3, xem comment ở logDenied): một ngoại
  // lệ ném ra bên trong callback của withActor() làm knex.transaction() tự
  // ROLLBACK toàn bộ những gì đã làm trong đó — kể cả dòng audit_log VÀ dòng
  // UPDATE attempts/status='burned' vừa ghi. Hậu quả nếu giữ nguyên bản mẫu:
  // "sai 5 lần thì challenge bị burned" sẽ KHÔNG BAO GIỜ persist — mỗi lần
  // sai, UPDATE bị chính exception của lần đó xoá sạch. Cách sửa: giao dịch
  // không bao giờ throw ở bên trong — nó LUÔN commit, trả về một kết quả có
  // trạng thái {ok, reason}; hàm ngoài đọc kết quả rồi mới throw, SAU KHI
  // giao dịch đã commit xong (throw ở đây không rollback được gì nữa).
  //
  // Đồng thời sửa luôn việc bản mẫu INSERT thẳng vào audit_log bằng SQL —
  // vi phạm ràng buộc toàn cục "ghi audit_log phải qua audit.log(trx, …)".
  const result = await withActor(null, async (trx) => {
    const { rows: [ch] } = await trx.raw(
      `SELECT * FROM otp_challenges
        WHERE phone_hash = ? AND community_id = ? AND purpose = ? AND status = 'open' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [phoneHash, communityId, purpose]
    );

    const fail = async (reason) => {
      await auditLog(trx, {
        communityId,
        actorId: null,
        action: 'otp.failed',
        // detail CHỈ chứa phone_hash (HMAC 64 hex) + mã lý do — KHÔNG BAO GIỜ
        // số điện thoại thật, KHÔNG BAO GIỜ mã OTP.
        detail: { phone_hash: phoneHash, reason },
      });
      return { ok: false, reason };
    };

    if (!ch) return fail('no_open_challenge');

    const match = await argon2.verify(ch.code_hash, code).catch(() => false);
    if (!match) {
      const attempts = ch.attempts + 1;
      const burned = attempts >= MAX_ATTEMPTS;
      await trx.raw(`UPDATE otp_challenges SET attempts = ?, status = ? WHERE id = ?`, [
        attempts,
        burned ? 'burned' : 'open',
        ch.id,
      ]);
      return fail(burned ? 'burned' : 'wrong_code');
    }

    await trx.raw(`UPDATE otp_challenges SET status = 'used' WHERE id = ?`, [ch.id]);
    return { ok: true, otpToken: jwtSignOtp({ phoneHash, purpose, challengeId: ch.id }) };
  });

  if (!result.ok) {
    // MỘT thông báo duy nhất cho mọi nguyên nhân (không có challenge mở, mã
    // sai, hay vừa bị burned) — không giúp kẻ dò phân biệt được lý do.
    throw new AppError('OTP_INVALID', 'Mã xác minh không đúng hoặc đã hết hạn.', { status: 400 });
  }
  return { otpToken: result.otpToken };
}

// ---------------------------------------------------------------------------
// Đăng ký — nộp đơn gia nhập. Việc này Task 7 cố ý để lại (nó phụ thuộc bảng
// join_requests, migration 009) và Task 8 nhận.
//
// QĐ-1 ĐÃ ĐỔI ĐẦU VÀO CỦA HÀM NÀY. Trước đây người nộp đơn gõ `referrer_id`
// (một uuid), và vì ô nhập ấy là một MÁY DÒ danh sách thành viên nên đặc tả
// dòng 815 bắt ba nhánh hỏng phải trả CÙNG một câu: không tồn tại / không phải
// member / hết hạn mức. Nay không còn ô nhập nào: `referrer_id` đến từ token
// của đường link mà chính người bảo lãnh đã phát.
//
// Hệ quả với luật "ba nhánh giống hệt nhau": nó không còn đối tượng để bảo vệ.
// Token 256 bit không dò được, nên người đang cầm link là người đã được trao
// link, và nói thật với họ ("link đã có người dùng" khác "link hết hạn") không
// rò ra điều gì về Hội. Ngược lại, gộp cả bốn nhánh thành một câu chung sẽ để
// người bị chuyền tay một cái link đã dùng đứng trước một lời từ chối không
// hiểu nổi — đúng chỗ QĐ-1 đòi họ phải hiểu.
//
// Lớp đệm thời lượng ở routes.js GIỮ NGUYÊN: nó rẻ, và nó vẫn che chênh lệch
// giữa nhánh có chạy tiếp với nhánh dừng sớm.
//
// GUARANTEE_QUOTA_EXCEEDED gần như không tới được đây nữa, và đó chính là điểm
// 2 của QĐ-1: suất bị tiêu ngay lúc PHÁT link, nên tới lúc người ta đăng ký
// thì chỗ đã giữ sẵn. Vẫn bắt mã đó ở đây vì cửa sổ 12 tháng trượt và
// `communities.config` đều đổi được giữa lúc phát link và lúc dùng link.
// ---------------------------------------------------------------------------

// Bốn nhánh hỏng của link mời, cộng nhánh hết hạn mức. Danh sách CHO PHÉP: một
// mã lạ (lỗi thật của hệ thống) phải nổi lên thành 500 chứ không bị nuốt thành
// một câu "link không dùng được".
const INVITE_FAILURE_CODES = [
  'INVITE_NOT_FOUND',
  'INVITE_EXPIRED',
  'INVITE_REVOKED',
  'INVITE_ALREADY_USED',
  'GUARANTEE_QUOTA_EXCEEDED',
];

function inviteFailure(err) {
  const raw = String(err?.message ?? '');
  return INVITE_FAILURE_CODES.find((code) => raw.includes(code)) ?? null;
}

export async function register({
  communityId, otpToken, phone, fullName, birthYear, areaId, inviteToken, password,
}) {
  const phoneHash = hashPhone(phone);
  let claims = null;
  if (otpToken) {
    try {
      claims = jwt.verify(otpToken, config.JWT_SECRET);
    } catch {
      claims = null;
    }
    // Client cũ đã gửi vé thì vẫn phải dùng một vé hợp lệ đúng số điện thoại.
    if (!claims || claims.typ !== 'otp' || claims.purpose !== 'register' || claims.ph !== phoneHash || !claims.ch) {
      throw new AppError('OTP_INVALID', 'Mã xác minh không đúng hoặc đã hết hạn.', { status: 400 });
    }
  }

  // Băm mật khẩu TRƯỚC khi mở giao dịch, và trên MỌI nhánh — argon2 là phần
  // tốn thời gian nhất của cả lời gọi (cố ý chậm). Nếu chỉ băm ở nhánh thành
  // công thì chênh lệch thời gian giữa "thành công" và "hỏng" lớn hơn nhiều
  // lần mọi thứ khác, và lớp đệm 300ms ở tầng HTTP không che nổi.
  const passwordHash = await argon2.hash(password);

  const result = await withActor(null, async (trx) => {
    // Client cũ có gửi otp_token thì tiêu thụ đúng một lần. Luồng đăng ký mới
    // không gửi vé và đi thẳng qua link mời bảo lãnh.
    if (claims) {
      const { rows: [consumed] } = await trx.raw(
        `UPDATE otp_challenges SET consumed_at = now()
          WHERE id = ? AND community_id = ? AND purpose = 'register'
            AND status = 'used' AND consumed_at IS NULL
          RETURNING id`,
        [claims.ch, communityId]
      );
      if (!consumed) {
        throw new AppError('OTP_INVALID', 'Mã xác minh không đúng hoặc đã hết hạn.', { status: 400 });
      }
    }

    // 2. Năm sinh đọc từ communities.config, KHÔNG cứng trong mã (đặc tả dòng
    //    776). Cộng đồng này là hội đồng niên Bính Dần 1986; cộng đồng sau có
    //    thể là năm khác, và lúc đó không ai phải sửa mã nguồn.
    const { rows: [community] } = await trx.raw(
      `SELECT coalesce((config->>'birth_year')::int, 1986) AS birth_year FROM communities WHERE id = ?`,
      [communityId]
    );
    if (!community || community.birth_year !== birthYear) {
      // Lỗi nhập liệu của người dùng, KHÔNG phải nhánh dò danh sách — ném
      // trong giao dịch để nó rollback, trả lại otp_token cho người gõ nhầm.
      throw new AppError(
        'BIRTH_YEAR_MISMATCH',
        `Cộng đồng này chỉ nhận người sinh năm ${community?.birth_year ?? ''}.`,
        { status: 422, fields: { birth_year: 'không đúng năm sinh của cộng đồng' } }
      );
    }

    const { rows: [area] } = await trx.raw(`SELECT id FROM areas
      WHERE id = ? AND community_id = ? AND is_active = true`, [
      areaId, communityId,
    ]);
    if (!area) {
      throw new AppError('INVALID_REFERENCE', 'Khu vực không hợp lệ.', {
        status: 422, fields: { area_id: 'không tồn tại' },
      });
    }

    // 3. Nhận link mời rồi lập đơn — CÙNG MỘT GIAO DỊCH (QĐ-1, điểm 1).
    //
    //    THỨ TỰ TRONG SAVEPOINT KHÔNG TUỲ NGHI. `guarantee_invite_claim()` đặt
    //    `used_at` TRƯỚC khi đơn được chèn, và phải như vậy: câu đếm hạn mức
    //    tính cả link còn mở lẫn đơn đang sống, nên nếu đơn ra đời trong lúc
    //    link vẫn còn "mở" thì MỘT lời hứa bị tính thành HAI suất. Đặt used_at
    //    trước thì suất chuyển tay gọn từ link sang đơn, tổng không đổi.
    //
    //    Câu nối `used_by_join_request` chạy sau cùng, vì id của đơn chỉ có
    //    sau khi chèn. Khoảng giữa hai câu ấy được canh bằng một ràng buộc
    //    HOÃN TỚI COMMIT (`trg_guarantee_invite_use_complete`, migration 031):
    //    đốt link mà không để lại đơn thì COMMIT hỏng.
    let reason = null;
    let created = null;
    let referrerId = null;
    let inviteId = null;
    {
      // SAVEPOINT: trigger fn_guarantee_quota RAISE khi hết hạn mức, và một
      // ngoại lệ chưa bắt sẽ huỷ CẢ giao dịch — kéo theo việc tiêu thụ
      // otp_token và dòng nhật ký từ chối. Khi đó nhánh "hết hạn mức" để lại
      // dấu vết khác hẳn hai nhánh kia (vé còn dùng được, không có dòng log),
      // tức ba nhánh lại phân biệt được — chỉ khác là qua trạng thái chứ
      // không qua câu chữ. Giao dịch lồng của knex là SAVEPOINT: nó cuộn lại
      // đúng câu INSERT hỏng, giao dịch ngoài sống tiếp và vẫn commit được.
      try {
        await trx.transaction(async (sp) => {
          // Token thô KHÔNG đi xuống CSDL, chỉ băm của nó. Hàm tra hàng, khoá
          // hàng, đánh dấu đã dùng, và RAISE đúng lý do nếu link không dùng được.
          const { rows: [claim] } = await sp.raw(`SELECT * FROM guarantee_invite_claim(?, ?)`, [
            hashInviteToken(inviteToken),
            communityId,
          ]);
          inviteId = claim.invite_id;
          referrerId = claim.invite_referrer_id;

          const { rows: [row] } = await sp.raw(
            `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status, step)
             VALUES (?, ?::jsonb, ?, 'pending', 2)
             RETURNING id, step`,
            [
              communityId,
              JSON.stringify({
                full_name: fullName,
                birth_year: birthYear,
                area_id: areaId,
                terms_accepted_at: new Date().toISOString(),
              }),
              referrerId,
            ]
          );

          // Số điện thoại thô và băm mật khẩu KHÔNG nằm trong applicant_data
          // nữa (Ruling T8-f, migration 009a). applicant_data là cột jsonb mà
          // app_role có SELECT, nên để chúng ở đó là dựng sẵn một đường rò chỉ
          // cần một route viết ẩu là mở — cùng đường rò mà member_contacts đã
          // bỏ công bịt ở tầng CSDL. join_request_secrets bị REVOKE ALL rồi chỉ
          // cấp lại INSERT: câu này ghi được, nhưng không câu SQL nào của
          // app_role đọc lại được. Đường đọc duy nhất là join_secret_consume(),
          // và người gọi hợp lệ duy nhất là approve().
          await sp.raw(
            `INSERT INTO join_request_secrets (join_request_id, community_id, phone, password_hash)
             VALUES (?, ?, ?, ?)`,
            [row.id, communityId, phone, passwordHash]
          );
          await sp.raw(
            `UPDATE guarantee_invites SET used_by_join_request = ?
              WHERE id = ? AND community_id = ?`,
            [row.id, claim.invite_id, communityId]
          );
          created = row;
        });
      } catch (err) {
        const code = inviteFailure(err);
        if (!code) throw err;
        reason = code.toLowerCase();
      }
    }

    if (reason) {
      // Từ chối phải để lại dấu. Đăng ký là đường CÔNG KHAI nên không có
      // actor, và errorHandler chỉ gọi logDenied khi req.actor tồn tại — nếu
      // không ghi ở đây thì một người dò hàng trăm uuid không để lại gì cả.
      // detail chỉ có định danh giả (HMAC), uuid và mã lý do; lý do THẬT được
      // ghi lại dù người nộp đơn chỉ nhận được một câu chung.
      // TOKEN KHÔNG BAO GIỜ VÀO NHẬT KÝ — kể cả băm của nó. Băm là chuỗi 64
      // hex, đúng hình dạng "định danh giả" mà `assertSafeDetail` cho qua, nên
      // chỉ có luật ở đây ngăn nó lọt vào. `invite_id` thì được: nó là khoá của
      // một hàng, không mở được cửa nào.
      await auditLog(trx, {
        communityId, actorId: null, action: 'join_request.denied',
        detail: {
          phone_hash: phoneHash,
          reason,
          ...(inviteId ? { invite_id: inviteId } : {}),
          ...(referrerId ? { referrer_id: referrerId } : {}),
        },
      });
      return { ok: false, reason };
    }

    await auditLog(trx, {
      communityId, actorId: null, action: 'join_request.created',
      targetType: 'join_request', targetId: created.id,
      detail: { referrer_id: referrerId, step: created.step },
    });
    return { ok: true, joinRequestId: created.id, step: created.step };
  });

  // Ném SAU khi giao dịch đã commit (bẫy mục 3): nếu ném bên trong, rollback
  // xoá luôn dòng join_request.denied vừa ghi VÀ trả lại otp_token đã tiêu.
  if (!result.ok) {
    // Dựng lại AppError từ chính bảng ánh xạ của CSDL: một mã, một câu, khai ở
    // đúng một chỗ (`core/errors.js`), và `t23-error-map` canh việc câu ấy có
    // mặt cả ở trình duyệt.
    throw (
      mapPgError(new Error(result.reason.toUpperCase())) ??
      new AppError('INTERNAL', 'Lỗi hệ thống.', { status: 500 })
    );
  }
  return { join_request_id: result.joinRequestId, step: result.step };
}

// ---------------------------------------------------------------------------
// Đăng nhập bằng mật khẩu — chính, không phải OTP.
// ---------------------------------------------------------------------------

// Băm giả cố định: khi không tìm thấy người, vẫn tốn đúng chừng ấy thời gian
// so khớp argon2. Bỏ bước này thì thời gian phản hồi tự nó tiết lộ số/email
// nào đã là thành viên (timing side-channel dò danh sách thành viên).
const DUMMY_HASH = await argon2.hash('khong-bao-gio-trung-khop');

const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

function signAccessToken(member) {
  return jwt.sign({ sub: member.id, cid: member.community_id, typ: 'access' }, config.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function newRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function issueTokens(trx, member, familyId) {
  const raw = newRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await trx.raw(
    `INSERT INTO refresh_tokens (community_id, member_id, token_hash, family_id, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [member.community_id, member.id, hashToken(raw), familyId, expiresAt]
  );
  // Đăng nhập thành công không throw sau đó — ghi trong CÙNG giao dịch với
  // INSERT refresh_tokens là an toàn (cả hai cùng commit, hoặc không cái nào
  // commit nếu có lỗi CSDL thật).
  await auditLog(trx, {
    communityId: member.community_id,
    actorId: member.id,
    action: 'auth.login',
    detail: {},
  });
  // Soát xét độc lập Task 9 (Important): đây là bản `fullName` — cùng lỗi quy
  // ước camelCase-lọt-ra-vỏ-HTTP mà otp/verify (`otpToken`) và refresh
  // (`refreshToken`) đã mắc và được sửa, nhưng chỗ này lọt lại vì bị xác nhận
  // chỉ bằng `curl` chọn ba route, không phải cả bốn. Xác nhận bằng `curl` thật
  // (`POST /auth/login`): trước khi sửa, thân trả về có
  // `"member":{"id":"...","fullName":"...","status":"..."}`. tests/t21-http-shape.test.js
  // canh lại bằng một khẳng định chung (mọi khoá JSON phải khớp
  // /^[a-z0-9_]+$/, đệ quy) thay vì chỉ khẳng định đúng bốn khoá của hôm nay —
  // lưới đó bắt được cả lỗi cùng họ ở route chưa viết.
  return {
    access: signAccessToken(member),
    refresh: raw,
    member: { id: member.id, full_name: member.full_name, status: member.status },
  };
}

export async function login({ communityId, identifier, password }) {
  // auth_lookup (migration 008) là hàm SECURITY DEFINER hẹp — đường DUY NHẤT
  // để tra cứu qua số điện thoại, vì member_contacts bị REVOKE ALL khỏi
  // app_role (migration 005). Đây KHÔNG phải giao dịch (chỉ một SELECT qua
  // hàm), nên gọi thẳng bằng knex, không cần withActor().
  const { rows: [m] } = await knex.raw(`SELECT * FROM auth_lookup(?, ?)`, [communityId, identifier]);

  // Luôn chạy đúng MỘT lần so khớp argon2, dù tìm thấy người hay không — xem
  // giải thích DUMMY_HASH ở trên.
  const ok = await argon2.verify(m?.password_hash ?? DUMMY_HASH, password).catch(() => false);

  if (!m || !ok || m.status !== 'member') {
    // Ghi nhận lượt từ chối trong một giao dịch RIÊNG, TỰ COMMIT trước khi
    // throw — giống hệt lý do logDenied() mở giao dịch riêng (core/audit.js):
    // nếu gộp chung với throw thì exception sẽ rollback luôn dòng audit vừa
    // ghi (bẫy mục 3, xem chú thích dài ở verifyOtp phía trên).
    await withActor(null, (trx) =>
      auditLog(trx, {
        communityId,
        actorId: null,
        action: 'auth.login.denied',
        detail: { identifier_hash: hashPhone(identifier) },
      })
    );
    // MỘT thông báo, MỘT mã lỗi cho mọi nguyên nhân (không tìm thấy người,
    // sai mật khẩu, hay tìm thấy nhưng chưa là 'member') — không giúp kẻ dò
    // phân biệt được số nào đã là thành viên.
    throw new AppError('INVALID_CREDENTIALS', 'Số điện thoại/email hoặc mật khẩu không đúng.', { status: 401 });
  }

  return withActor(m.id, (trx) => issueTokens(trx, m, crypto.randomUUID()));
}

// ---------------------------------------------------------------------------
// Refresh token xoay vòng: mỗi lần dùng, token cũ bị revoke và một token mới
// cùng family_id được phát ra (replaced_by trỏ sang token mới). Nếu một
// token ĐÃ bị revoke lại được đưa lên lần nữa (revoked_at khác null) — đó là
// dấu hiệu bị đánh cắp/tái sử dụng — thu hồi NGAY CẢ HỌ token đó, không chỉ
// một cái, để chặn kẻ tấn công dùng bất kỳ token nào khác còn sống trong họ.
// ---------------------------------------------------------------------------
export async function refresh({ refreshToken }) {
  const hash = hashToken(refreshToken);

  const result = await withActor(null, async (trx) => {
    const { rows: [row] } = await trx.raw(`SELECT * FROM refresh_tokens WHERE token_hash = ? FOR UPDATE`, [hash]);
    if (!row) return { ok: false, reason: 'not_found' };

    if (row.revoked_at) {
      await trx.raw(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = ? AND revoked_at IS NULL`, [
        row.family_id,
      ]);
      // Đóng dấu người thực hiện NGAY TẠI ĐÂY, không phải ở đầu giao dịch:
      // trước khi tra `refresh_tokens` ta chưa biết vé này của ai, nên
      // `withActor(null)` là lựa chọn đúng lúc mở giao dịch. Nhưng dòng nhật ký
      // ngay dưới nêu đích danh `row.member_id`, và từ migration 029
      // `trg_audit_actor_guard` không cho `app_role` nêu tên một người mà giao
      // dịch không đóng dấu — chính là luật "ô *_id ghi lại MỘT CÁI TÊN, không
      // ghi lại MỘT HÀNH ĐỘNG của người mang tên đó" (docs/RANG-BUOC.md mục 2).
      // Đặt dấu để CSDL và dòng nhật ký nói cùng một điều.
      await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [row.member_id]);
      await auditLog(trx, {
        communityId: row.community_id,
        actorId: row.member_id,
        action: 'auth.refresh.reuse_detected',
        detail: { family_id: row.family_id },
      });
      return { ok: false, reason: 'reuse_detected' };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    const { rows: [m] } = await trx.raw(`SELECT id, community_id, status, full_name FROM members WHERE id = ?`, [
      row.member_id,
    ]);
    if (!m || m.status !== 'member') return { ok: false, reason: 'member_gone' };

    const raw = newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const { rows: [next] } = await trx.raw(
      `INSERT INTO refresh_tokens (community_id, member_id, token_hash, family_id, expires_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [row.community_id, row.member_id, hashToken(raw), row.family_id, expiresAt]
    );
    await trx.raw(`UPDATE refresh_tokens SET revoked_at = now(), replaced_by = ? WHERE id = ?`, [next.id, row.id]);

    return { ok: true, access: signAccessToken(m), refresh: raw };
  });

  if (!result.ok) {
    throw new AppError('INVALID_REFRESH', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.', { status: 401 });
  }
  return { access: result.access, refresh: result.refresh };
}
