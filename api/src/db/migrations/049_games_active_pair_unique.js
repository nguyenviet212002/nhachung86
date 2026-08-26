// Đóng race hai lời thách đấu đồng thời cho cùng một cặp (Task 4 review
// finding): SELECT-rồi-INSERT ở challenge() không đủ khi hai request chạy
// gần như đồng thời ở READ COMMITTED — cả hai có thể cùng không thấy hàng
// của nhau trước khi cùng INSERT. Chỉ mục duy nhất từng phần này là lưới đỡ
// thật ở tầng CSDL: LEAST/GREATEST chuẩn hoá cặp không phân biệt ai là đỏ/đen,
// WHERE status IN ('pending','active') để một cặp vẫn thách đấu lại được sau
// khi ván trước đã xong (finished).
export async function up(knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX idx_games_active_pair
      ON games (community_id, LEAST(red_member_id, black_member_id), GREATEST(red_member_id, black_member_id))
      WHERE status IN ('pending', 'active');
  `);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_games_active_pair;`);
}
