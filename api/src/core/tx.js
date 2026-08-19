import { knex } from '../db/knex.js';

/**
 * Đường DUY NHẤT để mở giao dịch. Không gọi knex.transaction() ở nơi khác.
 * SET LOCAL tự hết hiệu lực khi giao dịch đóng nên không rò sang kết nối khác trong pool.
 *
 * Lệch khỏi brief có chủ đích: cú pháp `SET LOCAL app.actor_id = ?` trong brief
 * không chạy được — PostgreSQL không cho tham số hóa vế giá trị của lệnh SET
 * (lỗi 42601 "syntax error at or near $1", đã xác nhận bằng test T18 đỏ đúng
 * lý do). Dùng hàm set_config(name, value, is_local) thay thế: is_local=true
 * cho đúng ngữ nghĩa SET LOCAL (tự hết hiệu lực khi giao dịch đóng), và vì đây
 * là lời gọi hàm bình thường nên tham số hóa được — không nối chuỗi SQL.
 */
export async function withActor(actorId, fn) {
  return knex.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [actorId ?? '']);
    return fn(trx);
  });
}
