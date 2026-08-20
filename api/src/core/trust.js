// Bậc uy tín — spec mục 8.3.
//
// MỘT NGUỒN SỰ THẬT, CHIA HAI TẦNG:
//   * CSDL (member_trust_stats, fn_trust_recount ở migration 023) giữ CON SỐ THÔ.
//   * Tệp này giữ NGƯỠNG BẬC.
// Không nơi nào lặp lại logic của nơi kia. Vì vậy ở đây KHÔNG có một câu SQL
// nào, và trong migration 023 không có một tên bậc nào. Muốn đổi ngưỡng thì sửa
// đúng một chỗ: mảng ngay dưới đây; không phải viết migration, không phải rà
// xem còn chỗ nào chép lại con số 5/20/50/100.
//
// KHÔNG dùng để XẾP THỨ TỰ — spec mục 8.3 và mục 9. Bậc uy tín trả lời câu hỏi
// "người này đã làm bao nhiêu việc được cộng đồng xác nhận", không phải "ai hơn
// ai". Danh bạ xếp theo tên. Vì vậy tệp này cố ý KHÔNG xuất một hàm so sánh,
// một `rank()`, hay một thứ tự nào; bài t12-trust canh cả mã nguồn lẫn thứ tự
// thật của GET /members.

// Xếp TĂNG DẦN theo `min` — cùng thứ tự với spec mục 8.3, và cũng là thứ tự
// hiển thị trên hồ sơ ("Mầm → Kim Cương").
const TIERS = Object.freeze([
  Object.freeze({ key: 'mam', label: 'Mầm', min: 0 }),
  Object.freeze({ key: 'dong', label: 'Đồng', min: 5 }),
  Object.freeze({ key: 'bac', label: 'Bạc', min: 20 }),
  Object.freeze({ key: 'vang', label: 'Vàng', min: 50 }),
  Object.freeze({ key: 'kim_cuong', label: 'Kim Cương', min: 100 }),
]);

/**
 * Bậc của một người theo SỐ VIỆC ĐÃ ĐỦ XÁC NHẬN (member_trust_stats.confirmed_works).
 *
 * Đường vào DUY NHẤT. Không có hàm nào khác nhận số việc rồi trả ra bậc, và
 * không route nào được tự so `>= 20`.
 *
 * Đầu vào bẩn (null, undefined, chuỗi, NaN, số âm) rơi về bậc thấp nhất chứ
 * không ném lỗi: `confirmed_works` đến từ một cột int NOT NULL DEFAULT 0, nên
 * mọi giá trị lạ ở đây nghĩa là chỗ gọi đang truyền nhầm thứ — và một hồ sơ
 * hiện nhầm bậc THẤP thì vô hại, còn ném lỗi thì làm hỏng cả trang hồ sơ.
 */
export function tierOf(confirmedWorks) {
  const n = Number(confirmedWorks ?? 0);
  if (!Number.isFinite(n)) return TIERS[0];
  let found = TIERS[0];
  for (const t of TIERS) if (n >= t.min) found = t;
  return found;
}

export { TIERS };
