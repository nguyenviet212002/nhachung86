// Kết quả Luyện Thế (Hạ/Trung/Cao cấp) trước đây chỉ phát qua sự kiện SSE
// `luyen_the_done` (publishToGame) — không ai đang mở kết nối lúc job nền
// xong thì dữ liệu mất vĩnh viễn, vì đây là job chạy nền không ai chắc đang
// xem màn hình. Thêm cột để lưu lại, đọc qua GET /sessions/:id như mọi
// trường khác (route đó đã SELECT * nên không cần sửa gì thêm ở đó).
export async function up(knex) {
  await knex.raw(`ALTER TABLE co_the_sessions ADD COLUMN luyen_the_result jsonb;`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE co_the_sessions DROP COLUMN IF EXISTS luyen_the_result;`);
}
