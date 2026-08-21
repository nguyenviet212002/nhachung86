// Hợp đồng dữ liệu cho API năng lực/việc làm. Một thành viên chỉ được tạo một
// kết nối ứng tuyển cho mỗi nhu cầu; nếu muốn ứng tuyển lại phải rút lượt cũ.
export async function up(knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX conn_one_worker_per_job
      ON connections (job_need_id, worker_id)
      WHERE job_need_id IS NOT NULL;
  `);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS conn_one_worker_per_job;`);
}
