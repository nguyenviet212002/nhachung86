import { communities, logJob } from './lib.js';

/**
 * Hằng ngày — hai lời nhắc.
 *
 * ============================================================================
 * NÓI THẲNG VỀ MỘT CHỖ KHÔNG LÀM ĐÚNG ĐƯỢC.
 * ============================================================================
 * Kế hoạch Task 18 viết: *"nhắc xác minh TRƯỚC 15 NGÀY"*. Câu ấy giả định một
 * xác minh có HẠN. Nhưng bảng `verifications` (migration 018) không có cột hạn
 * nào — chỉ có `verified_at` — và đặc tả gốc không nói ở đâu rằng một lần xác
 * minh sống bao lâu. Đặt ra một hạn (một năm? hai năm?) là ra một quyết định
 * chính sách, và đó là quyết định của người chủ trì cộng đồng, không phải của
 * người viết tác vụ này.
 *
 * Nên ở đây làm NỬA CÒN LẠI, là nửa có dữ liệu để đứng: nhắc những đơn xác
 * minh đã nằm chờ `pending` quá 15 ngày mà chưa ai ngó tới. Đó là cùng con số
 * 15 ngày, cùng mục đích (đừng để một hồ sơ chết dí), và không bịa ra một
 * chính sách chưa ai duyệt. Ghi rõ trong task-17-18-report.md để người dùng
 * quyết; khi có câu trả lời thì chỉ cần thêm một cột hạn và một câu WHERE.
 * ============================================================================
 *
 * Lời nhắc thứ hai theo đúng kế hoạch: sau 30 ngày im lặng, nhắc cập nhật
 * trạng thái nhận việc (`connections`).
 *
 * LỜI NHẮC ĐI ĐÂU: hôm nay chỉ tới `audit_log`, dưới dạng SỐ ĐẾM. Giai đoạn 1
 * không có bảng thông báo, không có kênh gửi (adapter OTP là `console`), nên
 * chỗ trung thực nhất để một lời nhắc đậu lại là nhật ký — và bảng điều khiển
 * vận hành đọc được từ đó. KHÔNG ghi danh sách tên người vào `detail`: luật mục
 * 10 cấm, và `assertSafeDetail` sẽ ném lỗi nếu ai đó thử.
 */
export const key = 'ops.reminders';
export const schedule = { hour: 7, minute: 0 };

const VERIFY_STALE_DAYS = 15;
const CONNECTION_SILENT_DAYS = 30;

export async function run(trx) {
  const out = { verifications_stale: 0, connections_silent: 0 };

  for (const cid of await communities(trx)) {
    const { rows: [v] } = await trx.raw(
      `SELECT count(*)::int AS n FROM verifications
        WHERE community_id = ? AND status = 'pending'
          AND created_at <= now() - (? || ' days')::interval`,
      [cid, VERIFY_STALE_DAYS]
    );

    const { rows: [c] } = await trx.raw(
      `SELECT count(*)::int AS n FROM connections
        WHERE community_id = ?
          AND status NOT IN ('done', 'failed')
          AND updated_at <= now() - (? || ' days')::interval`,
      [cid, CONNECTION_SILENT_DAYS]
    );

    out.verifications_stale += v.n;
    out.connections_silent += c.n;

    if (v.n || c.n) {
      await logJob(trx, {
        communityId: cid,
        action: 'job.reminders',
        detail: {
          verifications_stale: v.n,
          connections_silent: c.n,
          verify_days: VERIFY_STALE_DAYS,
          connection_days: CONNECTION_SILENT_DAYS,
        },
      });
    }
  }
  return out;
}
