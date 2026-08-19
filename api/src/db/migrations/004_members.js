// Bảng members — hồ sơ công khai trong nội bộ cộng đồng (họ tên, khu vực,
// nghề nghiệp, tiểu sử, ...). CỐ Ý không có cột liên hệ nào (phone, zalo,
// messenger, address) — những cột đó nằm ở member_contacts (migration 005),
// nơi app_role bị REVOKE ALL. Nhờ vậy một route viết ẩu `SELECT * FROM
// members` không thể làm lộ số điện thoại, vì cột đó không tồn tại ở đây.
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      full_name text NOT NULL,
      birth_year int,
      email text,
      job text,
      area_id uuid REFERENCES areas(id),
      bio text,
      avatar_url text,
      cover_url text,
      status text NOT NULL DEFAULT 'guest' CHECK (status IN ('guest','member','left')),
      work_status text NOT NULL DEFAULT 'available'
        CHECK (work_status IN ('available','by_appointment','paused')),
      joined_at timestamptz,
      referrer_id uuid REFERENCES members(id),
      password_hash text,
      erased_at timestamptz,
      lat double precision, lng double precision,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Đích cho khóa ngoại ghép (member_id, community_id) ở các bảng việc
      -- (Task sau) — CSDL tự bảo đảm mọi người tham gia một bản ghi việc đều
      -- thuộc cùng cộng đồng. Trông thừa vì id đã là khóa chính, nhưng đây là
      -- điều kiện bắt buộc để tạo FOREIGN KEY (member_id, community_id).
      CONSTRAINT members_id_cid UNIQUE (id, community_id),
      -- Sợi bảo lãnh (ai đưa ai vào cộng đồng) không được tự trỏ vào chính
      -- mình.
      CONSTRAINT members_not_self_referrer CHECK (referrer_id IS DISTINCT FROM id)
    );
    CREATE INDEX idx_members_directory ON members (community_id, status, area_id, job);
    CREATE INDEX idx_members_referrer ON members (referrer_id);
    CREATE UNIQUE INDEX idx_members_email ON members (community_id, lower(email)) WHERE email IS NOT NULL;
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS members CASCADE;`);
}
