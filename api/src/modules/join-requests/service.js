import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';

// ---------------------------------------------------------------------------
// Từ migration 009a (Ruling T8-f), số điện thoại thô và băm mật khẩu KHÔNG còn
// nằm trong applicant_data — chúng ở join_request_secrets, bảng mà app_role
// không có quyền đọc. Đó mới là ràng buộc của CSDL; danh sách dưới đây là lớp
// thứ hai, và nó vẫn cần thiết: applicant_data vẫn là cột jsonb tự do mà một
// task sau có thể nhét thêm bất cứ thứ gì vào (email, ghi chú, ảnh giấy tờ...).
//
// Vì vậy đây là DANH SÁCH CHO PHÉP, không phải danh sách cấm: khoá mới thêm
// vào applicant_data về sau mặc định KHÔNG lộ ra, thay vì mặc định lộ cho tới
// khi có người nhớ ra phải cấm nó (bài học vòng sửa 2 của Task 3).
const APPLICANT_PUBLIC_FIELDS = ['full_name', 'birth_year', 'area_id'];

export function publicApplicantData(data) {
  const out = {};
  for (const key of APPLICANT_PUBLIC_FIELDS) out[key] = data?.[key] ?? null;
  return out;
}

function toRow(r) {
  return {
    id: r.id,
    status: r.status,
    step: r.step,
    referrer_id: r.referrer_id,
    member_id: r.member_id,
    applicant: publicApplicantData(r.applicant_data),
    met_on: r.met_on,
    met_confirmed_at: r.met_confirmed_at,
    reject_reason_code: r.reject_reason_code,
    created_at: r.created_at,
  };
}

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy đơn gia nhập này.', { status: 404 });
const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg, { status: 403 });

function isApprover(actor) {
  return actor.roles.includes('approver');
}

// Mọi truy vấn lọc community_id. Task 7 mất một vòng sửa vì bốn câu quên đúng
// chỗ này — actor.communityId đến từ JWT, không từ tham số đường dẫn.
async function loadForActor(trx, actor, id) {
  const { rows: [r] } = await trx.raw(`SELECT * FROM join_requests WHERE id = ? AND community_id = ?`, [
    id,
    actor.communityId,
  ]);
  if (!r) throw NOT_FOUND();
  return r;
}

export async function list({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT * FROM join_requests
        WHERE community_id = ? AND (?::text IS NULL OR status = ?::text)
        ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, status ?? null, status ?? null, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM join_requests
        WHERE community_id = ? AND (?::text IS NULL OR status = ?::text)`,
      [actor.communityId, status ?? null, status ?? null]
    );

    // MỘT dòng nhật ký cho cả trang, không phải một dòng mỗi đơn — cùng quy
    // ước với member.list (đặc tả dòng 838): duyệt danh sách là hành vi bình
    // thường, chỉ cần đếm được ai duyệt bao nhiêu lần.
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'join_request.list',
      detail: { count: rows.length, status: status ?? 'all', page },
    });

    return { data: rows.map(toRow), meta: { page, limit, total } };
  });
}

export async function getById({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const r = await loadForActor(trx, actor, id);
    // Đặc tả dòng 845: approver HOẶC chính người bảo lãnh của đơn đó. Không
    // phải "bất kỳ ai có vai member".
    if (!isApprover(actor) && r.referrer_id !== actor.id) {
      throw FORBIDDEN('Chỉ ban duyệt và người bảo lãnh của đơn này xem được.');
    }
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'join_request.view',
      targetType: 'join_request',
      targetId: r.id,
      detail: { status: r.status },
    });
    return toRow(r);
  });
}

export async function confirmMet({ actor, id, metOn, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const r = await loadForActor(trx, actor, id);

    // Nguyên tắc 1 ở dạng cụ thể nhất: CHỈ người bảo lãnh của ĐƠN NÀY. Một
    // người có vai 'member' bất kỳ, kể cả approver, cũng không xác nhận hộ
    // được — lời khai "tôi đã gặp người này" chỉ có nghĩa khi nó đến từ đúng
    // người đã đứng ra bảo lãnh.
    //
    // Ném thẳng ở đây an toàn: tới thời điểm này giao dịch chưa ghi gì cả, nên
    // rollback không xoá mất dòng nhật ký nào. Dòng "từ chối" do errorHandler
    // ghi trong một giao dịch RIÊNG mở SAU khi giao dịch này đã rollback xong
    // (core/audit.js: logDenied) — đó là lý do nó sống sót.
    if (r.referrer_id !== actor.id) {
      throw FORBIDDEN('Chỉ người bảo lãnh của đơn này mới xác nhận đã gặp mặt được.');
    }
    if (r.status !== 'pending') {
      return { ok: false, status: r.status };
    }

    const { rows: [updated] } = await trx.raw(
      `UPDATE join_requests
          SET status = 'met_confirmed', met_on = ?::date, met_confirmed_at = now(),
              met_confirmed_by = ?, met_note = ?, step = greatest(step, 3), updated_at = now()
        WHERE id = ? AND community_id = ?
        RETURNING *`,
      [metOn, actor.id, note, id, actor.communityId]
    );

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'join_request.met_confirmed',
      targetType: 'join_request',
      targetId: id,
      // Không bao giờ ghi nội dung note vào nhật ký: note là văn bản tự do,
      // nơi người ta hay viết cả số điện thoại lẫn địa chỉ.
      //
      // met_on cũng KHÔNG vào detail, và không phải vì tôi ngại: assertSafeDetail
      // (core/audit.js, luật 2) từ chối mọi chuỗi chỉ gồm chữ số và dấu phân
      // cách có từ 7 chữ số trở lên — '2026-08-01' có 8. Đây là hệ quả trực
      // tiếp của Ruling T4-d (ngưỡng nâng từ 6 lên 7 để '2026-08' lọt qua);
      // ngày đầy đủ dạng ISO thì không lọt. Kết quả đúng chứ không phải lỗi:
      // ngày tháng không phải định danh nghiệp vụ, và met_on đã nằm trong cột
      // của chính hàng mà target_id trỏ tới. Ghi ra đây để task sau không mất
      // một vòng gỡ rối cho cùng một câu 500.
      detail: { note_length: note.length },
    });

    return { ok: true, row: updated };
  });

  if (!result.ok) {
    throw new AppError('INVALID_STATE', 'Đơn này không ở trạng thái chờ xác nhận gặp mặt.', { status: 409 });
  }
  return { status: result.row.status };
}

export async function reject({ actor, id, reasonCode, note }) {
  const result = await withActor(actor.id, async (trx) => {
    const r = await loadForActor(trx, actor, id);
    if (r.status === 'approved' || r.status === 'rejected') {
      return { ok: false };
    }

    const { rows: [updated] } = await trx.raw(
      `UPDATE join_requests
          SET status = 'rejected', reject_reason_code = ?, note = ?, updated_at = now()
        WHERE id = ? AND community_id = ?
        RETURNING *`,
      [reasonCode, note, id, actor.communityId]
    );

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'join_request.rejected',
      targetType: 'join_request',
      targetId: id,
      // reason_code ĐƯỢC ghi vào detail (đặc tả dòng 850): chỉ
      // 'referrer_misrepresented' mới đốt suất bảo lãnh vĩnh viễn, nên nó phải
      // tra lại được từ nhật ký chứ không chỉ từ cột hiện thời của đơn.
      detail: { reason_code: reasonCode, previous_status: r.status },
    });

    return { ok: true, row: updated };
  });

  if (!result.ok) {
    throw new AppError('INVALID_STATE', 'Đơn này đã được quyết định rồi.', { status: 409 });
  }
  return { status: result.row.status };
}

/**
 * Duyệt đơn — MỘT giao dịch, và service chỉ làm đúng bốn việc (đặc tả mục 5,
 * phần "Gia nhập"):
 *
 *   1. INSERT INTO members
 *   2. SELECT contact_upsert(<member_id>, 'phone', <số của người nộp đơn>)
 *   3. UPDATE join_requests
 *   4. audit.log
 *
 * SERVICE KHÔNG CHẠM member_contacts VÀ KHÔNG CHẠM member_relations. Hai bảng
 * đó nằm ngoài quyền của app_role (migration 005 và 012) — nếu mã dưới đây lỡ
 * chạm vào, CSDL trả `permission denied` chứ không im lặng làm sai. Hộp liên hệ
 * rỗng, tám mức riêng tư mặc định và cạnh guarantee do trg_member_bootstrap
 * sinh ngay sau bước 1.
 *
 * Thứ tự bước 1 → bước 3 KHÔNG phải chuyện tuỳ nghi: trg_member_status_gate là
 * CONSTRAINT TRIGGER hoãn tới COMMIT (migration 010), nó tra join_requests theo
 * member_id. Ghi hàng members trước rồi mới nối đơn — kiểm tra chạy lúc COMMIT
 * khi cả hai đã có mặt. Đổi sang kiểm ngay lúc ghi thì luồng hợp lệ cũng chết.
 */
export async function approve({ actor, id, note }) {
  return withActor(actor.id, async (trx) => {
    // FOR UPDATE: hai approver bấm duyệt cùng lúc thì người thứ hai đợi, rồi
    // đọc lại status='approved' và dừng ở cổng bên dưới. Không có FOR UPDATE
    // thì cả hai cùng thấy một đơn đang chờ và cùng tạo một hàng members.
    const { rows: [jr] } = await trx.raw(
      `SELECT * FROM join_requests WHERE id = ? AND community_id = ? FOR UPDATE`,
      [id, actor.communityId]
    );
    // Ném thẳng trong giao dịch an toàn ở hai chỗ này: chưa ghi gì cả nên
    // rollback không xoá mất dòng nhật ký nào (bẫy 1). Dòng "từ chối" do
    // errorHandler ghi bằng giao dịch RIÊNG mở sau khi giao dịch này đã cuộn.
    if (!jr) throw NOT_FOUND();
    if (!['pending', 'met_confirmed'].includes(jr.status)) {
      throw new AppError('INVALID_STATE', 'Đơn này không còn ở trạng thái có thể duyệt.', { status: 422 });
    }

    const d = jr.applicant_data;

    // Số điện thoại và băm mật khẩu KHÔNG còn nằm trong applicant_data
    // (Ruling T8-f, migration 009a) — chúng ở join_request_secrets, bảng mà
    // app_role không có một quyền đọc nào. Hàm SECURITY DEFINER dưới đây tự
    // kiểm actor là approver CỦA CHÍNH CỘNG ĐỒNG NÀY, tự kiểm đơn đang ở
    // 'pending' hoặc 'met_confirmed', tự ghi nhật ký, rồi XOÁ hàng bí mật: từ đây trở đi số
    // điện thoại chỉ còn tồn tại ở member_contacts, nơi có ba mức riêng tư canh.
    const { rows: [secret] } = await trx.raw(`SELECT * FROM join_secret_consume(?)`, [id]);

    // 1. Chỉ tạo hàng members.
    const { rows: [m] } = await trx.raw(
      `INSERT INTO members (community_id, full_name, birth_year, email, area_id,
                            referrer_id, password_hash, status, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'member', now()) RETURNING id`,
      [
        actor.communityId, d.full_name, d.birth_year, d.email ?? null, d.area_id,
        jr.referrer_id, secret.password_hash,
      ]
    );

    // 2. Số điện thoại đi qua hàm SECURITY DEFINER; approver chỉ điền được ô
    //    còn trống, đúng một lần, và lần đó để lại dòng contact.written.
    await trx.raw(`SELECT contact_upsert(?, 'phone', ?)`, [m.id, secret.phone]);

    // 3. Nối đơn với người vừa tạo. Constraint hoãn kiểm lúc COMMIT rằng đơn
    //    này đã thành approved và referrer khớp với thành viên vừa tạo.
    await trx.raw(
      `UPDATE join_requests
          SET member_id = ?, status = 'approved', approved_by = ?,
              note = coalesce(?, note), updated_at = now()
        WHERE id = ? AND community_id = ?`,
      [m.id, actor.id, note ?? null, id, actor.communityId]
    );

    // 4. Nhật ký, cùng giao dịch.
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'join_request.approved',
      targetType: 'join_request',
      targetId: id,
      detail: { member_id: m.id, referrer_id: jr.referrer_id },
    });

    return { member_id: m.id };
  });
}
