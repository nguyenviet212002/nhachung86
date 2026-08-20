/**
 * Phần chung của các tác vụ định kỳ.
 *
 * BA LUẬT, và cả ba đều rút từ những chỗ dự án này đã trượt trước đây:
 *
 *  1. MỘT TÁC VỤ CHẠY TRONG MỘT GIAO DỊCH, và dòng `audit_log` của nó nằm
 *     TRONG chính giao dịch ấy. Nếu tác vụ ném lỗi thì cả việc lẫn dòng nhật ký
 *     cùng cuộn lại — đúng như mong muốn ở đây, vì ta không muốn nhật ký nói
 *     "đã dọn 12 hàng" trong khi 12 hàng ấy còn nguyên. (Khác với `logDenied`:
 *     ở đó dòng "bị từ chối" PHẢI sống sót qua rollback, nên nó mở giao dịch
 *     riêng. Hai tình huống ngược nhau, hai cách làm ngược nhau.)
 *
 *  2. KHÔNG MƯỢN TÊN AI. `actor_id = NULL`. Tác vụ định kỳ là hệ thống. Đóng
 *     dấu tên một thành viên vào việc mà họ không làm là làm hỏng đúng thứ
 *     `audit_log` sinh ra để giữ.
 *
 *  3. KHOÁ TƯ VẤN THEO TÁC VỤ. Nếu một ngày `api` chạy hai bản sao thì hai bản
 *     cùng thức dậy lúc 03:15. `pg_try_advisory_xact_lock` cho đúng một bản
 *     chạy và bản kia bỏ lượt — rẻ hơn nhiều so với dựng một hàng đợi, và tự
 *     nhả khi giao dịch đóng.
 */

import { assertSafeDetail } from '../core/audit.js';

/** Mọi cộng đồng trên máy chủ này. Tác vụ chạy cho từng cộng đồng, không gộp. */
export async function communities(trx) {
  const { rows } = await trx.raw(`SELECT id FROM communities ORDER BY created_at`);
  return rows.map((r) => r.id);
}

/**
 * Ghi kết quả một tác vụ vào nhật ký. `detail` đi qua đúng bộ lọc mà
 * `core/audit.js` dùng cho mọi dòng khác — tác vụ định kỳ không được miễn luật
 * mục 10 chỉ vì nó không có người dùng nào đứng sau.
 */
export async function logJob(trx, { communityId, action, detail }) {
  const safe = assertSafeDetail(detail);
  await trx.raw(
    `INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
     VALUES (?, NULL, ?, 'community', ?, ?::jsonb)`,
    [communityId, action, communityId, JSON.stringify(safe)]
  );
}

/**
 * Chạy `fn` trong một giao dịch, dưới một khoá tư vấn mang tên tác vụ.
 * Trả `null` nếu không lấy được khoá (một tiến trình khác đang chạy tác vụ này).
 */
export async function withJobLock(knex, key, fn) {
  return knex.transaction(async (trx) => {
    const { rows: [{ got }] } = await trx.raw(
      `SELECT pg_try_advisory_xact_lock(hashtextextended(?, 77)) AS got`, ['job:' + key]
    );
    if (!got) return null;
    return fn(trx);
  });
}
