import crypto from 'node:crypto';
import argon2 from 'argon2';
import { withActor } from './tx.js';
import { AppError } from './errors.js';
import { log as auditLog } from './audit.js';

// ===========================================================================
// KHUNG HAI NGƯỜI KÝ — đặc tả mục 7.
//
// Ba luật của mục 7.2 đã được ép ở tầng CSDL từ migration 022
// (`fn_pending_signature_valid`, `trg_pending_two_signatures`,
// `trg_pending_sig_guard`), và migration 027/028 bịt thêm bốn cửa nữa. Tệp này
// là tầng ứng dụng: nó KHÔNG phải nơi giữ luật, nó là nơi cho người dùng một
// câu trả lời tử tế trước khi CSDL phải nói bằng `RAISE EXCEPTION`.
//
// Vì vậy MỌI kiểm tra ở đây đều có bản sao ở CSDL, và không kiểm tra nào ở đây
// là lớp duy nhất. Gỡ hết tệp này ra thì hệ thống vẫn không thi hành được một
// hành động thiếu chữ ký — chỉ là thông điệp lỗi xấu đi.
// ===========================================================================

// Bản đồ vai KHÔNG được chép lại ở đây. Migration 022 dựng
// `fn_pending_action_role()` với đúng lý do ấy: "hai bản đồ giống nhau đặt ở
// hai chỗ là hai bản đồ sẽ khác nhau". Hỏi CSDL.
async function roleFor(trx, actionKey) {
  const { rows: [r] } = await trx.raw(`SELECT fn_pending_action_role(?) AS role`, [actionKey]);
  return r?.role ?? null;
}

// ---------------------------------------------------------------------------
// Băm nội dung + ẢNH CHỤP dữ liệu liên quan (đặc tả mục 7.3).
//
// HAI SAI LỆCH CÓ CHỦ ĐÍCH so với mã mẫu kế hoạch Task 14 Step 2:
//
// (1) `JSON.stringify(payload)` KHÔNG ổn định qua một vòng `jsonb`. Người tạo
//     băm từ object JavaScript (thứ tự khoá theo lúc gõ); người ký thứ hai băm
//     lại từ `pending_actions.payload` đọc ra từ CSDL, mà PostgreSQL lưu
//     `jsonb` với thứ tự khoá do NÓ chọn (theo độ dài rồi theo byte). Hai
//     chuỗi khác nhau ⇒ băm khác nhau ⇒ MỌI hành động đều thành `stale` ở chữ
//     ký thứ hai, kể cả khi không có gì đổi. Bản vá: chuẩn hoá — sắp khoá đệ
//     quy trước khi băm.
//
// (2) Bảng tra cứu của kế hoạch có đúng năm khoá và `SNAPSHOT[actionKey](...)`
//     không có nhánh dự phòng, nên `community.config_change` (khoá thứ sáu,
//     thêm ở lượt này theo `docs/RANG-BUOC.md` #22) làm nó chết bằng
//     `TypeError`. Một bản đồ tra cứu không có nhánh mặc định thì mọi khoá
//     thêm về sau đều làm nó chết — đây là lỗi hình dạng, không phải lỗi
//     thiếu một dòng.
// ---------------------------------------------------------------------------
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  // Date PHẢI đứng trước nhánh object, nếu không cả cơ chế chống "dữ liệu đổi
  // giữa hai chữ ký" thành RỖNG RUỘT. `typeof new Date() === 'object'`, mà
  // `Object.keys(date)` là mảng RỖNG — nên mọi ảnh chụp `updated_at` bị nén
  // thành `{}`, hai lần băm luôn bằng nhau, và không thay đổi nào bị phát hiện.
  // Bài kiểm `community.config_change` vẫn xanh vì `config` là object thường,
  // nên nó CHE mất lỗi này. Đây đúng khuôn "canh triệu chứng, không canh nguồn"
  // ở docs/SOAT-KIEM-THU.md: một cái lưới trông đúng mà không bắt gì.
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

const SNAPSHOT = {
  // Ảnh chụp `updated_at` của người bị nhắm tới: nếu hồ sơ đổi giữa hai chữ
  // ký thì người thứ nhất có thể đang đồng ý với một sự việc không còn nữa.
  'member.terminate': (trx, id) =>
    trx.raw(`SELECT updated_at FROM members WHERE id = ?`, [id]),
  'guarantee.quota_override': (trx, id) =>
    trx.raw(`SELECT updated_at FROM members WHERE id = ?`, [id]),
  'data.delete': (trx, id) =>
    trx.raw(`SELECT updated_at FROM members WHERE id = ?`, [id]),
  // Cấu hình HIỆN THỜI nằm trong ảnh chụp, không chỉ `updated_at`: hai người
  // ký một thay đổi tính TRÊN một cấu hình cụ thể. Nếu ai đó đổi cấu hình
  // giữa hai chữ ký (qua một hành động khác cũng đủ chữ ký), chữ ký thứ hai
  // phải thành `stale` chứ không được ghi đè im lặng.
  'community.config_change': (trx, id) =>
    trx.raw(`SELECT updated_at, config FROM communities WHERE id = ?`, [id]),
};

export async function computePayloadHash(trx, actionKey, payload, targetId) {
  const snap = SNAPSHOT[actionKey] ? await SNAPSHOT[actionKey](trx, targetId) : { rows: [] };
  const material = JSON.stringify(
    canonical({ actionKey, payload: payload ?? {}, targetId: targetId ?? null, snap: snap.rows })
  );
  return crypto.createHash('sha256').update(material).digest('hex');
}

// ---------------------------------------------------------------------------
// Năm hành động của đặc tả mục 7.5 + `community.config_change` của lượt này.
//
// BA hành động CHƯA CÓ NGƯỜI THI HÀNH, và chúng bị từ chối NGAY LÚC TẠO chứ
// không phải lúc ký:
//   * `contacts.export`  — lối vào duy nhất của `contact_read_many`, mà Task 6
//     cố ý chưa viết hàm đó (xem sổ tiến độ: "viết bây giờ nghĩa là để nó
//     không được canh gì");
//   * `backup.restore`   — thuộc Task 18;
//   * `data.delete`      — bia mộ hoá theo mục 10, thuộc task vòng đời dữ liệu.
//
// Vì sao chặn ở lúc TẠO: gom được hai chữ ký cho một việc không chạy được là
// tệ hơn không cho tạo. Hai người đã bỏ công đọc và ký, hệ thống nuốt cả hai
// rồi báo hỏng — và vì thi hành nằm trong cùng giao dịch với chữ ký thứ hai,
// giao dịch cuộn lại và CHỮ KÝ THỨ HAI CŨNG BIẾN MẤT. Người ký sẽ không hiểu
// vì sao chữ ký của mình không ở đâu cả.
// ---------------------------------------------------------------------------
const EXECUTORS = {
  'community.config_change': async (trx, pa) => {
    const { rows: [r] } = await trx.raw(`SELECT fn_community_config_apply(?) AS config`, [pa.id]);
    return { config_keys: Object.keys(r.config ?? {}).sort() };
  },

  'guarantee.quota_override': async (trx, pa) => {
    const extra = Number(pa.payload?.extra_slots ?? 1);
    const months = Number(pa.payload?.valid_months ?? 12);
    const { rows: [ov] } = await trx.raw(
      `INSERT INTO guarantee_quota_overrides
         (community_id, referrer_id, extra_slots, reason, granted_by, valid_until, pending_action_id)
       VALUES (?, ?, ?, ?, ?, now() + (? || ' months')::interval, ?)
       RETURNING id`,
      [pa.community_id, pa.target_id, extra, String(pa.payload?.reason ?? ''), pa.created_by, months, pa.id]
    );
    return { override_id: ov.id, extra_slots: extra };
  },

  'member.terminate': async (trx, pa) => {
    // `left`, không phải xoá. Đặc tả mục 10: hồ sơ người rời thành BIA MỘ —
    // dữ liệu ở lại, tư cách thì hết. `GET /members` mặc định chỉ trả
    // `status='member'` (Ruling T10-d) nên người này rời khỏi danh bạ ngay.
    const { rows } = await trx.raw(
      `UPDATE members SET status = 'left', updated_at = now()
        WHERE id = ? AND community_id = ? AND status <> 'left' RETURNING id`,
      [pa.target_id, pa.community_id]
    );
    return { terminated: rows.length };
  },
};

export const EXECUTABLE_ACTION_KEYS = Object.keys(EXECUTORS);

// ---------------------------------------------------------------------------
export async function create({ actor, actionKey, targetType = null, targetId = null, payload = {}, ip = null }) {
  if (!EXECUTORS[actionKey]) {
    throw new AppError(
      'ACTION_NOT_AVAILABLE',
      'Việc này chưa có phần thi hành nên chưa mở để ký. Xem ghi chú ở core/twoPerson.js.',
      { status: 422 }
    );
  }

  return withActor(actor.id, async (trx) => {
    const role = await roleFor(trx, actionKey);
    if (!role || !actor.roles.includes(role)) {
      throw new AppError('FORBIDDEN', 'Bạn không có vai được đề xuất việc này.', { status: 403 });
    }
    // Người tạo LÀ chữ ký thứ nhất (mục 7.2 bước 1), nên luật "người ký không
    // được là đối tượng" áp cho họ ngay từ đây. CSDL cũng chặn
    // (`SIGNER_IS_TARGET`); ở đây chỉ để câu lỗi tử tế hơn.
    if (targetType === 'member' && targetId === actor.id) {
      throw new AppError('SIGNER_IS_TARGET', 'Không ai đề xuất một việc nhắm vào chính mình.', { status: 403 });
    }
    if (targetType === 'member') {
      const { rows } = await trx.raw(`SELECT 1 FROM members WHERE id = ? AND community_id = ?`, [
        targetId, actor.communityId,
      ]);
      if (!rows.length) throw new AppError('NOT_FOUND', 'Không tìm thấy người này.', { status: 404 });
    }
    if (actionKey === 'community.config_change') {
      // Đối tượng của một thay đổi cấu hình LÀ cộng đồng của người đề xuất —
      // không nhận từ client, để không ai đề xuất đổi luật của cộng đồng khác.
      targetType = 'community';
      targetId = actor.communityId;
      if (!payload || typeof payload.config !== 'object' || payload.config === null || Array.isArray(payload.config)) {
        throw new AppError('VALIDATION_FAILED', 'Thay đổi cấu hình phải kèm toàn bộ cấu hình mới.', {
          status: 400, fields: { 'payload.config': 'phải là một object' },
        });
      }
    }

    const hash = await computePayloadHash(trx, actionKey, payload, targetId);

    const { rows: [pa] } = await trx.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
       VALUES (?, ?, ?, ?, ?::jsonb, ?, ?)
       RETURNING id, expires_at`,
      [actor.communityId, actionKey, targetType, targetId, JSON.stringify(payload ?? {}), hash, actor.id]
    );

    await trx.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign, ip)
       VALUES (?, ?, ?, ?, ?)`,
      [pa.id, actor.id, actor.communityId, hash, ip]
    );

    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'pending_action.created', targetType: 'pending_action', targetId: pa.id,
      detail: { action_key: actionKey, target_id: targetId },
    });

    return { id: pa.id, expires_at: pa.expires_at, signatures: 1, status: 'pending' };
  });
}

// ---------------------------------------------------------------------------
export async function sign({ actor, id, password, ip = null }) {
  // BẪY 1 (đề bài, và mã mẫu kế hoạch Task 14 Step 3 mắc đúng nó): nhánh
  // `stale` ghi `status='stale'` + một dòng `audit_log` RỒI `throw` trong CÙNG
  // giao dịch. Ngoại lệ cuộn cả giao dịch ⇒ trạng thái không đổi VÀ dòng nhật
  // ký biến mất, tức "dữ liệu đã đổi giữa hai chữ ký" thành một sự kiện không
  // để lại dấu vết nào. Giao dịch dưới đây LUÔN commit và trả `{ok, reason}`;
  // ngoại lệ ném SAU khi commit — đúng khuôn `verifyOtp`/`register` đã dùng.
  const result = await withActor(actor.id, async (trx) => {
    const { rows: [pa] } = await trx.raw(
      `SELECT * FROM pending_actions WHERE id = ? AND community_id = ? FOR UPDATE`,
      [id, actor.communityId]
    );
    if (!pa) throw new AppError('NOT_FOUND', 'Không tìm thấy việc chờ ký.', { status: 404 });

    // 1. Hạn kiểm NGAY LÚC KÝ, không trông vào tác vụ dọn dẹp chạy đúng giờ.
    if (pa.status !== 'pending' || new Date(pa.expires_at) <= new Date()) {
      throw new AppError('PENDING_ACTION_EXPIRED', 'Việc này đã quá hạn hoặc không còn chờ ký, phải tạo lại.', {
        status: 409,
      });
    }
    // 2. Người tạo là chữ ký thứ nhất — họ không ký lần hai.
    if (pa.created_by === actor.id) {
      throw new AppError('NEEDS_SECOND_PERSON', 'Cần một người thứ hai ký.', { status: 409 });
    }
    // 3. Vai.
    const role = await roleFor(trx, pa.action_key);
    if (!role || !actor.roles.includes(role)) {
      throw new AppError('SIGNER_ROLE_REQUIRED', 'Bạn không có vai được ký duyệt việc này.', { status: 403 });
    }
    // 4. Người ký không được là đối tượng.
    if (pa.target_type === 'member' && pa.target_id === actor.id) {
      throw new AppError('SIGNER_IS_TARGET', 'Không ai ký một việc nhắm vào chính mình.', { status: 403 });
    }
    // 5. Nhập lại mật khẩu — mục 7.4 gọi đây là lớp hiệu quả nhất chống một
    //    phiên bị bỏ quên trên máy chung, và đó là lý do nó nằm trong schema.
    const { rows: [me] } = await trx.raw(`SELECT password_hash FROM members WHERE id = ? AND community_id = ?`, [
      actor.id, actor.communityId,
    ]);
    const ok = me?.password_hash
      ? await argon2.verify(me.password_hash, password).catch(() => false)
      : false;
    if (!ok) throw new AppError('REAUTH_FAILED', 'Mật khẩu không đúng.', { status: 401 });

    // 6. Dữ liệu liên quan có đổi kể từ chữ ký ĐẦU không?
    //
    //    So với `payload_hash_at_sign` CỦA CHỮ KÝ ĐẦU, không phải với
    //    `pending_actions.payload_hash`. Mã mẫu kế hoạch làm vế thứ hai, và nó
    //    là một phép so RỖNG: nó tính lại băm TỪ `pa.payload` rồi so với
    //    `pa.payload_hash` — sửa `payload` thì cả hai vế cùng đổi. Đúng cửa
    //    #15 của docs/RANG-BUOC.md ("ký nội dung X, thi hành nội dung Y") mà
    //    migration 027 đã bịt ở tầng CSDL; tầng ứng dụng không được là một lớp
    //    rỗng phía trên nó.
    const { rows: [first] } = await trx.raw(
      `SELECT payload_hash_at_sign FROM pending_action_signatures
        WHERE pending_action_id = ? AND signer_id = ?`,
      [id, pa.created_by]
    );
    if (!first) {
      throw new AppError('CREATOR_SIGNATURE_MISSING', 'Người đề xuất chưa ký việc này.', { status: 422 });
    }
    const now = await computePayloadHash(trx, pa.action_key, pa.payload, pa.target_id);
    if (now !== first.payload_hash_at_sign || now !== pa.payload_hash) {
      await trx.raw(`UPDATE pending_actions SET status = 'stale' WHERE id = ? AND community_id = ?`, [
        id, actor.communityId,
      ]);
      await auditLog(trx, {
        communityId: actor.communityId, actorId: actor.id,
        action: 'pending_action.stale', targetType: 'pending_action', targetId: id,
        detail: { action_key: pa.action_key },
      });
      return { ok: false, reason: 'stale' };
    }

    await trx.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign, ip)
       VALUES (?, ?, ?, ?, ?)`,
      [id, actor.id, actor.communityId, now, ip]
    );

    // Đếm bằng CHÍNH hàm CSDL mà hai trigger dùng — không đếm lại bằng một câu
    // SQL riêng ở đây. Hai định nghĩa của "đủ chữ ký" là hai định nghĩa sẽ
    // trôi dạt khỏi nhau.
    const { rows: [{ n }] } = await trx.raw(`SELECT fn_pending_action_signatures(?) AS n`, [id]);
    if (n < 2) {
      await auditLog(trx, {
        communityId: actor.communityId, actorId: actor.id,
        action: 'pending_action.signed', targetType: 'pending_action', targetId: id,
        detail: { action_key: pa.action_key, signatures: n },
      });
      return { ok: true, status: 'pending', signatures: n };
    }

    // Thi hành TRONG CÙNG giao dịch với chữ ký thứ hai (mục 7.2 bước 3):
    // không có trạng thái "đã ký nhưng chưa chạy".
    const execResult = await EXECUTORS[pa.action_key](trx, pa);
    await trx.raw(
      `UPDATE pending_actions SET status = 'executed', executed_at = now(), result = ?::jsonb
        WHERE id = ? AND community_id = ?`,
      [JSON.stringify(execResult ?? {}), id, actor.communityId]
    );
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'pending_action.executed', targetType: 'pending_action', targetId: id,
      detail: { action_key: pa.action_key, signatures: n },
    });
    return { ok: true, status: 'executed', signatures: n, result: execResult ?? {} };
  });

  if (!result.ok) {
    throw new AppError(
      'PENDING_ACTION_STALE',
      'Dữ liệu liên quan đã thay đổi kể từ chữ ký đầu. Hãy tạo lại việc này và ký lại từ đầu.',
      { status: 409 }
    );
  }
  return result.status === 'executed'
    ? { status: 'executed', signatures: result.signatures, result: result.result }
    : { status: 'pending', signatures: result.signatures };
}

// ---------------------------------------------------------------------------
export async function cancel({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [pa] } = await trx.raw(
      `SELECT * FROM pending_actions WHERE id = ? AND community_id = ? FOR UPDATE`,
      [id, actor.communityId]
    );
    if (!pa) throw new AppError('NOT_FOUND', 'Không tìm thấy việc chờ ký.', { status: 404 });
    // Bảng mục 5.3: "người tạo". Không phải approver bất kỳ — huỷ đề xuất của
    // người khác là quyết định thay họ.
    if (pa.created_by !== actor.id) {
      throw new AppError('FORBIDDEN', 'Chỉ người đề xuất mới huỷ được việc này.', { status: 403 });
    }
    if (pa.status !== 'pending') {
      throw new AppError('INVALID_STATE', 'Việc này không còn ở trạng thái chờ ký.', { status: 409 });
    }
    await trx.raw(`UPDATE pending_actions SET status = 'cancelled' WHERE id = ? AND community_id = ?`, [
      id, actor.communityId,
    ]);
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'pending_action.cancelled', targetType: 'pending_action', targetId: id,
      detail: { action_key: pa.action_key },
    });
    return { status: 'cancelled' };
  });
}

// ---------------------------------------------------------------------------
export async function list({ actor, status = null, page = 1, limit = 20 }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT a.id, a.action_key, a.target_type, a.target_id, a.status, a.created_by,
              a.created_at, a.expires_at, a.executed_at,
              (SELECT count(*)::int FROM pending_action_signatures s
                WHERE s.pending_action_id = a.id AND s.community_id = a.community_id) AS signatures,
              fn_pending_action_signatures(a.id) AS valid_signatures
         FROM pending_actions a
        WHERE a.community_id = ? AND (?::text IS NULL OR a.status = ?::text)
        ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, status, status, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM pending_actions
        WHERE community_id = ? AND (?::text IS NULL OR status = ?::text)`,
      [actor.communityId, status, status]
    );
    // Bảng mục 5.3 ghi `—` ở cột Log cho GET /ops/pending-actions: xem danh
    // sách việc chờ là hành vi bình thường của người trực, không phải sự kiện.
    // `payload` KHÔNG ra tới client ở đây: với `data.delete`/`member.terminate`
    // nó là hồ sơ của một người cụ thể, và danh sách là chỗ nhiều mắt nhất.
    return { data: rows, meta: { page, limit, total } };
  });
}
