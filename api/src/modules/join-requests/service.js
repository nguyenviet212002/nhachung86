import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';

// ---------------------------------------------------------------------------
// applicant_data chứa dữ liệu cá nhân THÔ của người chưa phải thành viên: số
// điện thoại (đặc tả mục 5.3 dòng 855 đòi approve đọc "số từ applicant_data"
// để gọi contact_upsert) và băm mật khẩu (không có bảng nào khác giữ hộ trước
// khi hàng members ra đời).
//
// Cả kiến trúc bỏ công tách member_contacts ra khỏi members rồi REVOKE ALL để
// một route viết ẩu không làm lộ số điện thoại. Nếu /join-requests trả nguyên
// applicant_data thì công đó đổ sông — chỉ khác là lộ qua đơn thay vì qua hồ
// sơ. Vì vậy đây là DANH SÁCH CHO PHÉP, không phải danh sách cấm: thêm khóa
// mới vào applicant_data về sau sẽ mặc định KHÔNG lộ ra, thay vì mặc định lộ
// cho tới khi có người nhớ ra phải cấm nó (bài học vòng sửa 2 của Task 3).
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
 * CHƯA LÀM — ranh giới với Task 9 (phán quyết R2 của đề bài Task 8).
 *
 * approve() tạo hàng `members`, và hàng đó chỉ hợp lệ khi trigger
 * trg_member_bootstrap (spec mục 4.7, migration 012 — Task 9) đã tồn tại để
 * sinh hộp liên hệ rỗng, tám mức riêng tư mặc định và cạnh bảo lãnh; đồng thời
 * bước 2 của đặc tả (dòng 855) gọi contact_upsert, cũng là hàm của migration
 * 012. Viết nửa vời ở đây nghĩa là để Task 9 đoán xem phần nào đã đúng — nên
 * chỗ này ném lỗi rõ ràng thay vì im lặng làm sai.
 */
export async function approve() {
  throw new AppError('NOT_IMPLEMENTED', 'Chức năng duyệt đơn chưa được bật.', { status: 501 });
}
