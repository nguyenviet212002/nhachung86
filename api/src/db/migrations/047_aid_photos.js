// "Giúp nhau" (aid_requests) chưa có cách đính ảnh — người nhờ giúp không tả
// được bằng ảnh ("cây đổ đè lối đi", "máy phát bị hỏng chỗ nào") mà chỉ có chữ.
// Mượn nguyên mẫu capability_photos (013_capabilities.js): 1 bảng ảnh riêng,
// KHÔNG dùng cơ chế files.attached_type chung (đó là danh sách trắng chỉ cho
// member_avatar/member_cover — thêm loại thứ ba vào đó phải tự viết luật riêng
// tư của nó, xem ghi chú trong files/service.js) — ownership của ảnh vẫn xác
// nhận qua files.owner_id lúc gắn (giống capability_photos), không qua
// attached_type.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE aid_request_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      aid_request_id uuid NOT NULL,
      url text NOT NULL,
      caption text,
      sort_order int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (aid_request_id, community_id) REFERENCES aid_requests (id, community_id) ON DELETE CASCADE
    );
    CREATE INDEX idx_aid_photos ON aid_request_photos (aid_request_id, sort_order);
  `);

  await knex.raw(`
    REVOKE ALL ON aid_request_photos FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON aid_request_photos TO ??;
  `, [user, user]);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS aid_request_photos;`);
}
