import knexLib from 'knex';

/**
 * Kết nối của dữ liệu mẫu — CHỦ SỞ HỮU, không phải `app_role`. Nói rõ vì sao,
 * để lần sau không ai "sửa cho nhất quán":
 *
 *   * `communities` và `member_roles` chỉ cấp SELECT cho `app_role` (migration
 *     022/024). Gieo cộng đồng đầu tiên và gán vai đầu tiên là việc của NGƯỜI
 *     VẬN HÀNH, cùng loại với chạy migration — không phải việc của ứng dụng.
 *     Nếu `app_role` làm được thì một route viết ẩu cũng làm được.
 *   * Đây KHÔNG phải đường vòng qua ràng buộc: seed vẫn đóng dấu người thực
 *     hiện (`app.actor_id`) trước mọi lệnh ghi, vẫn đi qua đủ 54 trigger, vẫn
 *     phải xin `contact_upsert` để điền số điện thoại. Không có một dòng
 *     `DISABLE TRIGGER` nào trong thư mục này.
 *
 * Dùng MIGRATION_DATABASE_URL vì đó chính là chuỗi kết nối chủ sở hữu mà
 * container `api` đã có sẵn để chạy migration lúc khởi động.
 */
export function seedKnex() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Thiếu MIGRATION_DATABASE_URL — dữ liệu mẫu chạy bằng kết nối chủ sở hữu, xem chú thích đầu tệp.'
    );
  }
  return knexLib({ client: 'pg', connection: url, pool: { min: 1, max: 4 } });
}
