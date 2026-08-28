import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy báo cáo này.', { status: 404 });

// Bảng thật (migration 022_ops.js) KHÔNG có cột "ai báo cáo" — chỉ
// target_type/target_id/reason/status/decided_by/decided_at. Đúng hình dạng
// một hàng đợi kiểm duyệt: ai cũng gắn cờ được, nhưng không ai theo dõi được
// gắn cờ bởi ai (tránh trả đũa người báo cáo) — hành động vẫn vào audit_log
// như mọi ghi khác, chỉ không có mặt trên CHÍNH hàng moderation_queue.
//
// lookupTarget() dùng CHUNG cho cả tạo (xác nhận đối tượng có thật, cùng
// khuôn assertSubject của complaints) lẫn liệt kê (đường dẫn + nhãn hiển thị
// cho Admin xem ảnh đang bị báo cáo là ảnh của bài nào).
const TARGET_QUERY = {
  // Ảnh việc: GET /jobs trả images[].id = files.id (xem jobs/service.js JOIN_LIST
  // — json_build_object('id', f.id, ...)), KHÔNG PHẢI job_need_images.id — đó
  // cũng chính là id mà xoá-ảnh-của-chính-mình (jobs/service.js#removeImage)
  // dùng làm khoá. target_id ở đây vì vậy là files.id, để khớp với cái duy
  // nhất mà giao diện thực sự cầm trong tay lúc hiện ảnh.
  job_photo: {
    sql: `SELECT f.id AS file_id, jn.id AS parent_id, jn.title AS parent_title
            FROM job_need_images jni
            JOIN job_needs jn ON jn.id = jni.job_need_id AND jn.community_id = jni.community_id
            JOIN files f ON f.id = jni.file_id
           WHERE jni.file_id = ? AND jni.community_id = ?`,
    photoUrl: (r) => (r.file_id ? `/files/${r.file_id}` : null),
    remove: (trx, communityId, targetId) =>
      trx.raw(`DELETE FROM job_need_images WHERE file_id = ? AND community_id = ?`, [targetId, communityId]),
  },
  capability_photo: {
    sql: `SELECT cp.url, c.id AS parent_id, c.title AS parent_title
            FROM capability_photos cp
            JOIN capabilities c ON c.id = cp.capability_id AND c.community_id = cp.community_id
           WHERE cp.id = ? AND cp.community_id = ?`,
    photoUrl: (r) => r.url,
    remove: (trx, communityId, targetId) =>
      trx.raw(`DELETE FROM capability_photos WHERE id = ? AND community_id = ?`, [targetId, communityId]),
  },
  aid_photo: {
    sql: `SELECT ap.url, ar.id AS parent_id, ar.title AS parent_title
            FROM aid_request_photos ap
            JOIN aid_requests ar ON ar.id = ap.aid_request_id AND ar.community_id = ap.community_id
           WHERE ap.id = ? AND ap.community_id = ?`,
    photoUrl: (r) => r.url,
    remove: (trx, communityId, targetId) =>
      trx.raw(`DELETE FROM aid_request_photos WHERE id = ? AND community_id = ?`, [targetId, communityId]),
  },
  activity_photo: {
    // target_id CHÍNH LÀ id của activities — không có bảng ảnh riêng cho
    // hoạt động, chỉ một cột image_url trên hàng của nó.
    sql: `SELECT id AS parent_id, title AS parent_title, image_url
            FROM activities WHERE id = ? AND community_id = ? AND image_url IS NOT NULL`,
    photoUrl: (r) => r.image_url,
    remove: (trx, communityId, targetId) =>
      trx.raw(`UPDATE activities SET image_url = NULL, updated_at = now() WHERE id = ? AND community_id = ?`, [targetId, communityId]),
  },
};

async function lookupTarget(trx, communityId, targetType, targetId) {
  const q = TARGET_QUERY[targetType];
  const { rows: [row] } = await trx.raw(q.sql, [targetId, communityId]);
  if (!row) return null;
  return { parentId: row.parent_id, parentTitle: row.parent_title, photoUrl: q.photoUrl(row) };
}

export async function create({ actor, input }) {
  return withActor(actor.id, async (trx) => {
    const target = await lookupTarget(trx, actor.communityId, input.target_type, input.target_id);
    if (!target) throw new AppError('VALIDATION_FAILED', 'Không tìm thấy ảnh này.', { status: 422 });

    const { rows: [existing] } = await trx.raw(
      `SELECT id FROM moderation_queue WHERE community_id = ? AND target_type = ? AND target_id = ? AND status = 'open'`,
      [actor.communityId, input.target_type, input.target_id]
    );
    if (existing) {
      throw new AppError('VALIDATION_FAILED', 'Ảnh này đã có người báo cáo, đang chờ Ban điều hành xử lý.', { status: 422 });
    }

    const { rows: [row] } = await trx.raw(
      `INSERT INTO moderation_queue (community_id, target_type, target_id, reason)
       VALUES (?, ?, ?, ?) RETURNING *`,
      [actor.communityId, input.target_type, input.target_id, input.reason]
    );
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'moderation.reported', targetType: input.target_type, targetId: input.target_id,
      detail: { queue_id: row.id },
    });
    return row;
  });
}

// Chỉ approver/content_ops gọi được (chặn ở routes.js) — hàng đợi xử lý,
// không lọc theo người tạo (bảng còn không có cột đó).
export async function list({ actor, status, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT * FROM moderation_queue
        WHERE community_id = ? AND (?::text IS NULL OR status = ?)
        ORDER BY (status = 'open') DESC, created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, status ?? null, status ?? null, limit, offset]
    );
    const data = [];
    for (const row of rows) {
      const target = await lookupTarget(trx, actor.communityId, row.target_type, row.target_id);
      data.push({
        ...row,
        photo_url: target ? target.photoUrl : null,
        parent_id: target ? target.parentId : null,
        parent_title: target ? target.parentTitle : null,
      });
    }
    const { rows: [count] } = await trx.raw(
      `SELECT count(*)::int AS total FROM moderation_queue WHERE community_id = ? AND (?::text IS NULL OR status = ?)`,
      [actor.communityId, status ?? null, status ?? null]
    );
    return { data, meta: { page, limit, total: count.total } };
  });
}

// status='approved' nghĩa là "báo cáo đúng, gỡ ảnh" — xoá/ẩn ảnh THẬT trong
// CÙNG giao dịch với việc đóng hàng đợi, không phải hai bước tách rời (nếu
// tách, một request chết giữa chừng có thể để lại "đã duyệt" mà ảnh còn nguyên).
// status='rejected' nghĩa là "báo cáo sai/không đủ căn cứ" — không đụng ảnh.
export async function decide({ actor, id, status }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE moderation_queue SET status = ?, decided_by = ?, decided_at = now()
        WHERE id = ? AND community_id = ? AND status = 'open'
        RETURNING *`,
      [status, actor.id, id, actor.communityId]
    );
    if (!row) throw NOT_FOUND();

    if (status === 'approved') {
      await TARGET_QUERY[row.target_type].remove(trx, actor.communityId, row.target_id);
    }

    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'moderation.decided', targetType: row.target_type, targetId: row.target_id,
      detail: { status },
    });
    return row;
  });
}
