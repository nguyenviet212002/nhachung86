// Chọn 1 nước trong danh sách multipv theo cấp máy đi hộ (BAN_CHUAN_CO_TUONG.md
// mục 4: "Engine tìm ba nước hay nhất... Cấp độ khác nhau ở chọn nước nào,
// không ở thời gian"). Thuần hàm — không gọi engine/CSDL — kiểm bằng dữ liệu
// bịa được ngay, không cần Pikafish thật.
const LEVELS = {
  sieu: { topN: 1, threshold: 0 },
  'thong-minh': { topN: 2, threshold: 40 },
  'xuat-sac': { topN: 3, threshold: 120 },
};

// Quy điểm chiếu bí về một thang so được với score_cp: càng ít nước tới chiếu
// bí (mate dương) càng TỐT hơn bất kỳ score_cp nào; càng ít nước tới bị chiếu
// bí (mate âm) càng TỆ hơn bất kỳ score_cp nào. 100_000 đủ lớn để không đụng
// score_cp thật (Pikafish score_cp hiếm khi vượt vài nghìn).
export function effectiveScore(line) {
  if (line.mate == null) return line.score_cp;
  return line.mate > 0 ? 100_000 - line.mate : -100_000 - line.mate;
}

export function selectAiMove(lines, level, rng = Math.random) {
  if (!lines.length) return null;
  const cfg = LEVELS[level];
  if (!cfg) throw new Error(`Cấp máy đi hộ không hợp lệ: ${level}`);
  const sorted = [...lines].sort((a, b) => effectiveScore(b) - effectiveScore(a));
  const bestScore = effectiveScore(sorted[0]);
  const pool = sorted.slice(0, cfg.topN).filter((l) => bestScore - effectiveScore(l) <= cfg.threshold);
  return pool[Math.floor(rng() * pool.length)].move;
}
