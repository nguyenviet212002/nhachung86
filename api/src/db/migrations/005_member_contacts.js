// Bảng member_contacts — nơi duy nhất chứa thông tin liên hệ (số điện thoại,
// zalo, messenger, địa chỉ). Luật cứng của nền tảng: số điện thoại và địa chỉ
// của một người chỉ được tiết lộ theo đúng mức riêng tư người đó đặt.
//
// app_role bị REVOKE ALL trên bảng này — kể cả SELECT. Migration 002 đã cấp
// sẵn bốn quyền (SELECT, INSERT, UPDATE, DELETE) cho MỌI bảng owner tạo về
// sau qua ALTER DEFAULT PRIVILEGES, nên nếu bỏ REVOKE ở đây thì bảng nhạy
// cảm nhất hệ thống lại là bảng dễ đọc nhất. Đường duy nhất vào là hàm
// SECURITY DEFINER contact_read / contact_upsert (migration 006, 012) — hàm
// đó tự kiểm quyền theo mức riêng tư và tự ghi nhật ký.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE member_contacts (
      member_id uuid PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
      community_id uuid NOT NULL REFERENCES communities(id),
      phone text, zalo text, messenger text, address text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX idx_contacts_phone ON member_contacts (community_id, phone) WHERE phone IS NOT NULL;
  `);
  // Kể cả SELECT. Đường duy nhất vào là contact_read / contact_upsert (migration 006, 012).
  await knex.raw(`REVOKE ALL ON member_contacts FROM ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS member_contacts;`);
}
