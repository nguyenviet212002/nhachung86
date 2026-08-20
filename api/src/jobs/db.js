import knexLib from 'knex';
import { config } from '../config/index.js';

let pool = null;

/**
 * Kết nối riêng của tác vụ định kỳ — CHỦ SỞ HỮU, không phải `app_role`.
 *
 * Nói rõ vì sao, vì đây là chỗ dễ bị coi là "tiện tay":
 *
 *  * `fn_trust_recount` (migration 023) và `fn_audit_actor_guard` (029) đều mở
 *    sẵn một nhánh cho "không có người thực hiện, nhưng là chủ bảng". Chú thích
 *    của chính `fn_audit_actor_guard` gọi tên nhánh đó: *"chỉ chủ bảng
 *    (migration, psql của người vận hành, TÁC VỤ ĐỊNH KỲ) mới được nêu đích
 *    danh một người"*. Tác vụ định kỳ là hệ thống, không phải một con người —
 *    và mượn tên một thành viên để đóng dấu sẽ là ghi vào nhật ký rằng người ấy
 *    đã làm một việc mà họ không hề làm. Đó đúng là cái mà `docs/RANG-BUOC.md`
 *    mục 2 gọi là "ô ghi lại MỘT CÁI TÊN chứ không ghi lại MỘT HÀNH ĐỘNG".
 *  * `fn_audit_new_partition` tạo bảng, mà `app_role` không có CREATE trên
 *    schema. Không có đường nào khác.
 *
 * ĐÁNH ĐỔI, ghi ra để người sau cân lại chứ không giấu: tiến trình `api` vì
 * vậy giữ một pool có quyền chủ sở hữu trong suốt thời gian chạy. Nó KHÔNG
 * thêm bí mật nào vào container — `MIGRATION_DATABASE_URL` đã có sẵn ở đó từ
 * Task 1 để chạy migration lúc khởi động. Nhưng một lỗi tiêm SQL ở tầng route
 * sẽ nguy hiểm hơn nếu nó chạm được pool này. Vì vậy pool này KHÔNG BAO GIỜ
 * được truyền vào `modules/`; nó chỉ tồn tại trong `src/jobs/`. Cách tách triệt
 * để hơn là dựng tác vụ định kỳ thành một container riêng — đáng làm nếu về
 * sau `api` chạy nhiều bản sao.
 */
export function jobsKnex() {
  if (!pool) {
    pool = knexLib({
      client: 'pg',
      connection: config.MIGRATION_DATABASE_URL,
      pool: { min: 0, max: 2 },
    });
  }
  return pool;
}

export async function closeJobsKnex() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.destroy();
  }
}
