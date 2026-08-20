import { communities, logJob } from './lib.js';

/**
 * Hằng ngày — tạo phân mảnh `audit_log` của THÁNG SAU.
 *
 * Đây là tác vụ có hậu quả nặng nhất nếu quên: `audit_log` phân mảnh theo
 * khoảng `at`, và một hàng rơi ra ngoài mọi phân mảnh thì `INSERT` **thất bại**
 * (`no partition of relation "audit_log" found for row`). Nghĩa là 00:00 ngày
 * đầu tháng, MỌI hành động ghi nhật ký của hệ thống chết cùng lúc — mà gần như
 * mọi hành động đều ghi nhật ký. Không phải một lỗi giảm chất lượng; là một lỗi
 * dừng hệ thống, đúng vào một thời điểm biết trước.
 *
 * Vì vậy nó chạy HẰNG NGÀY chứ không phải mỗi tháng một lần, và tạo trước cả
 * tháng sau lẫn tháng sau nữa. `fn_audit_new_partition` tự bỏ qua nếu phân mảnh
 * đã có, nên chạy thừa ba mươi lần không tốn gì. Một tác vụ hằng tháng có đúng
 * một cơ hội mỗi tháng; nếu cơ hội ấy rơi vào lúc máy chủ đang tắt thì không có
 * lần thứ hai.
 */
export const key = 'audit.partition';
export const schedule = { hour: 2, minute: 0 };

export async function run(trx) {
  const out = { created: 0 };

  const { rows: before } = await trx.raw(
    `SELECT relname FROM pg_class WHERE relname LIKE 'audit_log_%'`
  );
  const had = new Set(before.map((r) => r.relname));

  for (const months of [1, 2]) {
    await trx.raw(
      `SELECT fn_audit_new_partition((date_trunc('month', now()) + (? || ' months')::interval)::date)`,
      [months]
    );
  }

  const { rows: after } = await trx.raw(
    `SELECT relname FROM pg_class WHERE relname LIKE 'audit_log_%'`
  );
  const created = after.map((r) => r.relname).filter((n) => !had.has(n));
  out.created = created.length;

  if (created.length) {
    // Ghi cho MỘT cộng đồng bất kỳ thì sai — phân mảnh là chuyện của cả máy
    // chủ, không của riêng cộng đồng nào. Nhưng `audit_log.community_id` là
    // NOT NULL, nên dòng này phải đậu vào một cộng đồng. Ghi cho TẤT CẢ: mỗi
    // cộng đồng đều có quyền thấy trong nhật ký của mình rằng chỗ chứa nhật ký
    // tháng sau đã sẵn sàng.
    for (const cid of await communities(trx)) {
      await logJob(trx, {
        communityId: cid,
        action: 'job.audit_partition',
        detail: { created: created.length, names: created },
      });
    }
  }
  return out;
}
