import { communities, logJob } from './lib.js';

/**
 * Hằng ngày — dọn `join_request_secrets` của những đơn BỊ TỪ CHỐI.
 *
 * MÓN NỢ TASK 9, ghi trong progress.md: *"dọn join_request_secrets của đơn bị
 * từ chối chưa ai làm — cần khung tác vụ định kỳ. Giao cho task nhận vòng đời
 * dữ liệu."* Đây là task ấy.
 *
 * Bảng này giữ SỐ ĐIỆN THOẠI THÔ và băm mật khẩu của người CHƯA phải thành
 * viên (migration 009a). Với một đơn đã duyệt, `join_secret_consume()` xoá hàng
 * ngay trong giao dịch duyệt — số điện thoại chuyển vào `member_contacts`, nơi
 * có ba mức riêng tư canh giữ. Với một đơn BỊ TỪ CHỐI thì không có bước ấy, và
 * cho tới hôm nay hàng đó nằm lại vĩnh viễn: dữ liệu cá nhân của một người
 * không phải thành viên, giữ mãi, không phục vụ mục đích nào.
 *
 * Đặc tả mục 10 (Nghị định 13): dữ liệu cá nhân chỉ được lưu chừng nào còn mục
 * đích. Đơn bị từ chối thì mục đích đã hết — và hết HẲN, vì
 * `fn_join_request_frozen` (migration 027) cấm sửa lại `reject_reason_code`
 * một khi đã ghi, tức không có đường quay lại.
 *
 * SỐ NGÀY ÂN HẠN là một CHÍNH SÁCH, nên nó nằm trong `communities.config` chứ
 * không viết cứng ở đây, và mặc định 7 ngày chỉ là giá trị dự phòng khi khoá
 * vắng mặt. Bảy ngày để một quyết định từ chối nhầm còn kịp được nói lại bằng
 * miệng; ai muốn nghiêm hơn thì đặt 0 và hàng bị xoá ngay đêm đó. Con số này
 * cần người chủ trì cộng đồng chốt — đã ghi trong báo cáo.
 *
 * `DELETE` chứ không phải bia mộ: bia mộ (mục 10 tầng 1) dành cho `members`, nơi
 * việc của người khác trỏ tới. Ở đây không có gì trỏ tới, và giữ lại một hàng
 * rỗng cũng chẳng để làm gì.
 */
export const key = 'privacy.purge_join_secrets';
export const schedule = { hour: 3, minute: 45 };

const DEFAULT_GRACE_DAYS = 7;

export async function run(trx) {
  const out = { purged: 0 };

  for (const cid of await communities(trx)) {
    const { rows: [{ grace }] } = await trx.raw(
      `SELECT coalesce((config->>'rejected_secret_grace_days')::int, ?) AS grace
         FROM communities WHERE id = ?`,
      [DEFAULT_GRACE_DAYS, cid]
    );

    // Lọc `community_id` ở CẢ HAI đầu của phép nối. Khoá ngoại ghép
    // `jrs_request_same_community` đã bảo đảm điều đó, nhưng luật của dự án là
    // mọi truy vấn lọc `community_id` — lỗi quên đúng chỗ này đã lặp bảy lần.
    const res = await trx.raw(
      `DELETE FROM join_request_secrets s
        USING join_requests r
        WHERE s.join_request_id = r.id
          AND s.community_id = ?
          AND r.community_id = ?
          AND r.status = 'rejected'
          AND r.updated_at <= now() - (? || ' days')::interval`,
      [cid, cid, grace]
    );

    const n = res.rowCount ?? 0;
    out.purged += n;

    if (n) {
      // `detail` chỉ có SỐ ĐẾM và số ngày — không một mã đơn nào, và tuyệt đối
      // không một chữ số nào của thứ vừa bị xoá.
      await logJob(trx, {
        communityId: cid,
        action: 'job.purge_join_secrets',
        detail: { purged: n, grace_days: grace },
      });
    }
  }
  return out;
}
