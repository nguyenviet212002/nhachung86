import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { config } from '../../config/index.js';
import { withActor } from '../../core/tx.js';
import { knex } from '../../db/knex.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { otpAdapter } from '../../core/otp/index.js';

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
function newCode() {
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
    const { rows: [lock] } = await trx.raw(
      `SELECT count(*)::int AS n FROM (
         SELECT status FROM otp_challenges
          WHERE phone_hash = ? AND created_at > now() - interval '1 hour'
          ORDER BY created_at DESC LIMIT ?) t
        WHERE status IN ('burned','expired')`,
      [phoneHash, LOCK_AFTER_BURNED]
    );
    if (lock.n >= LOCK_AFTER_BURNED) {
      const { rows: [last] } = await trx.raw(
        `SELECT created_at FROM otp_challenges WHERE phone_hash = ? ORDER BY created_at DESC LIMIT 1`,
        [phoneHash]
      );
      if (last && Date.now() - new Date(last.created_at).getTime() < LOCK_WINDOW_MS) {
        throw new AppError('OTP_LOCKED', 'Số này tạm khóa 15 phút do nhập sai nhiều lần.', { status: 429 });
      }
    }

    await trx.raw(`UPDATE otp_challenges SET status = 'expired' WHERE phone_hash = ? AND status = 'open'`, [
      phoneHash,
    ]);
    const code = newCode();
    await trx.raw(
      `INSERT INTO otp_challenges (community_id, phone_hash, code_hash, purpose)
       VALUES (?, ?, ?, ?)`,
      [communityId, phoneHash, await argon2.hash(code), purpose]
    );
    await otpAdapter().send({ phone, code, purpose });
  });
}

function jwtSignOtp({ phoneHash, purpose }) {
  return jwt.sign({ ph: phoneHash, purpose, typ: 'otp' }, config.JWT_SECRET, { expiresIn: '5m' });
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
        WHERE phone_hash = ? AND purpose = ? AND status = 'open' AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [phoneHash, purpose]
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
    return { ok: true, otpToken: jwtSignOtp({ phoneHash, purpose }) };
  });

  if (!result.ok) {
    // MỘT thông báo duy nhất cho mọi nguyên nhân (không có challenge mở, mã
    // sai, hay vừa bị burned) — không giúp kẻ dò phân biệt được lý do.
    throw new AppError('OTP_INVALID', 'Mã xác minh không đúng hoặc đã hết hạn.', { status: 400 });
  }
  return { otpToken: result.otpToken };
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
  return {
    access: signAccessToken(member),
    refresh: raw,
    member: { id: member.id, fullName: member.full_name, status: member.status },
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
