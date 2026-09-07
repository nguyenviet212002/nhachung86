// Cột lưu kết quả mổ ván ACPL (mục 2.4 spec). eval_before_cp/eval_before_mate
// là điểm engine tốt nhất TẠI THẾ CỜ TRƯỚC nước đó, theo góc nhìn bên sắp đi
// (NULL cho tới khi phân tích chạy xong). win_loss là mất mát tỉ lệ thắng của
// riêng nước đó (mục 2.2). red_avg_loss/black_avg_loss/analyzed_at là bản tóm
// tắt trên games — đọc nhanh cho hồ sơ đối thủ, khỏi AVG() lại mỗi lần.
// analyzed_at NULL nghĩa là "chưa mổ xong" (job đang chạy hoặc chưa chạy),
// KHÔNG phải lỗi — UI (dự án con 3) tự hiện "Đang mổ ván…" cho trường hợp này.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE game_moves ADD COLUMN eval_before_cp int;
    ALTER TABLE game_moves ADD COLUMN eval_before_mate int;
    ALTER TABLE game_moves ADD COLUMN win_loss real;

    ALTER TABLE games ADD COLUMN red_avg_loss real;
    ALTER TABLE games ADD COLUMN black_avg_loss real;
    ALTER TABLE games ADD COLUMN analyzed_at timestamptz;
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE games DROP COLUMN analyzed_at;
    ALTER TABLE games DROP COLUMN black_avg_loss;
    ALTER TABLE games DROP COLUMN red_avg_loss;

    ALTER TABLE game_moves DROP COLUMN win_loss;
    ALTER TABLE game_moves DROP COLUMN eval_before_mate;
    ALTER TABLE game_moves DROP COLUMN eval_before_cp;
  `);
}
