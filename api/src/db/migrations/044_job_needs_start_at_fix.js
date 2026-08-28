// 041_job_need_details.js đã khai báo ADD COLUMN start_at timestamptz trong
// cùng một ALTER TABLE với start_note/close_at/... nhưng cột thực tế trong DB
// lại thiếu start_at (dò bằng \d job_needs xác nhận: có start_note, close_at,
// KHÔNG có start_at) — trong khi jobs/service.js (SELECT ở list()/get()) đã
// dùng j.start_at, gây lỗi 500 "column j.start_at does not exist" cho MỌI
// request GET /jobs. Vì knex_migrations đã ghi 041 là "đã chạy" (theo tên
// file, không theo nội dung) nên sửa lại 041 không tự chạy lại được — phải
// thêm cột còn thiếu qua migration mới, idempotent bằng IF NOT EXISTS.
export async function up(knex) {
  await knex.raw(`ALTER TABLE job_needs ADD COLUMN IF NOT EXISTS start_at timestamptz;`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE job_needs DROP COLUMN IF EXISTS start_at;`);
}
