import { communities, logJob } from './lib.js';

/**
 * Hằng giờ — đánh dấu `pending_actions` quá hạn và đóng tín hiệu quá hạn trả lời.
 *
 * Hai việc gộp một tác vụ vì chúng cùng một hình dạng: một cái hẹn đã trôi qua
 * mà không ai bấm nút nào.
 *
 * VÌ SAO `pending_actions` QUÁ HẠN PHẢI ĐƯỢC ĐÁNH DẤU, chứ không để yên và lọc
 * bằng `expires_at > now()` ở chỗ đọc: đặc tả mục 7.2 nói hành động hết hạn thì
 * chữ ký cũ không còn giá trị. Nếu trạng thái không đổi thì hàng ấy vẫn là
 * 'pending' mãi mãi, và mỗi chỗ đọc phải tự nhớ thêm vế `AND expires_at >
 * now()`. Một luật mà mọi chỗ đọc phải tự nhớ là một luật sẽ bị quên đúng một
 * lần — và lần đó là lần một chữ ký của năm ngoái mở được một cánh cửa hôm nay.
 * (`fn_community_config_guard` ở migration 028 CÓ kiểm `expires_at > now()`,
 * nên cửa đó đang được canh; tác vụ này làm cho luật ấy đúng ở MỌI cửa, kể cả
 * những cửa chưa ai viết.)
 *
 * KHÔNG đụng hành động đã `executed`: một việc đã làm thì không "hết hạn" được.
 */
export const key = 'ops.overdue';
export const schedule = { hour: null, minute: 5 };

export async function run(trx) {
  const out = { actions_expired: 0, signals_closed: 0 };

  for (const cid of await communities(trx)) {
    const expired = await trx.raw(
      `UPDATE pending_actions
          SET status = 'expired'
        WHERE community_id = ? AND status = 'pending' AND expires_at <= now()`,
      [cid]
    );

    // Tín hiệu quá hạn trả lời chuyển sang 'closed', KHÔNG phải 'cancelled':
    // 'cancelled' là người tạo rút lại, 'closed' là hết hạn trả lời. Hai câu
    // chuyện khác nhau, và trộn chúng là làm mất thông tin ngay tại chỗ ghi.
    const closed = await trx.raw(
      `UPDATE signals
          SET status = 'closed', updated_at = now()
        WHERE community_id = ?
          AND status IN ('open', 'converging')
          AND respond_by IS NOT NULL
          AND respond_by <= now()`,
      [cid]
    );

    const a = expired.rowCount ?? 0;
    const s = closed.rowCount ?? 0;
    out.actions_expired += a;
    out.signals_closed += s;

    // Chỉ ghi nhật ký khi CÓ VIỆC XẢY RA. Tác vụ này chạy 24 lần một ngày; ghi
    // vô điều kiện là mỗi năm thêm gần chín nghìn dòng nói "không có gì" vào
    // đúng bảng mà đặc tả mục 9 đã gọi tên là bảng lớn nhất hệ thống.
    if (a || s) {
      await logJob(trx, {
        communityId: cid,
        action: 'job.overdue',
        detail: { actions_expired: a, signals_closed: s },
      });
    }
  }
  return out;
}
