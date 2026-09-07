// Toán thuần cho mổ ván ACPL (mục 2.2-2.3 spec Máy đi hộ/Mổ ván). Không I/O —
// không gọi engine, không đọc CSDL — kiểm bằng số bịa được ngay, giống hệt
// tinh thần aiSelect.js.

// Quy điểm engine (đã chuẩn hoá cả trường hợp chiếu bí qua effectiveScore()
// của aiSelect.js) sang tỉ lệ thắng ước lượng. Hệ số 400 là công thức logistic
// tiêu chuẩn cộng đồng cờ hay dùng — RULING trong spec §2.2: nền tảng này
// chưa có đủ ván để tự hiệu chỉnh một đường cong riêng, dùng xấp xỉ này trước,
// hiệu chỉnh lại sau khi có đủ dữ liệu thật.
const WINRATE_SCALE = 400;
export function winRate(effScore) {
  return 1 / (1 + Math.pow(10, -effScore / WINRATE_SCALE));
}

// evals: mảng {effScore}, một phần tử mỗi nước đã đi trong ván, ĐÚNG THỨ TỰ
// đã đi, effScore của mỗi phần tử đã ở góc nhìn của BÊN VỪA ĐI nước đó (engine
// luôn chấm theo góc nhìn bên sắp đi tại thế cờ được hỏi — xem service.js
// analyzeGame(), effScore ở đây chính là kết quả hỏi engine TRƯỚC khi áp nước
// đó). Trả về mảng cùng độ dài: mất mát tỉ lệ thắng của từng nước, cũng theo
// góc nhìn bên đã đi nước đó.
//
// Nước cuối cùng của mảng luôn mất mát 0: không có thế kế tiếp để so (ván đã
// dừng ở đó dù vì chiếu bí, xin thua, hết giờ, hay bất kỳ lý do nào) — coi là
// "không đủ dữ liệu để chê" thay vì cố đoán, đúng RULING trong spec §2.3.
export function computeMoveLosses(evals) {
  const losses = [];
  for (let i = 0; i < evals.length; i++) {
    if (i === evals.length - 1) { losses.push(0); continue; }
    const before = evals[i].effScore;
    // Ply kế tiếp là lượt đối phương — effScore của nó đang ở góc nhìn đối
    // phương, đảo dấu để quy về góc nhìn bên vừa đi nước i.
    const afterFromMoverPov = -evals[i + 1].effScore;
    losses.push(winRate(before) - winRate(afterFromMoverPov));
  }
  return losses;
}
