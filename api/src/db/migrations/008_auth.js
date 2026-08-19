// Xác thực — OTP có chặn dò, đăng nhập bằng mật khẩu, JWT với refresh token
// xoay vòng. Ba bảng nghiệp vụ (refresh_tokens, otp_challenges) + hai bảng
// vai trò (roles, member_roles, tạo sớm ở đây vì middleware/auth.js task này
// cần chúng — phần permissions để Task 16/022_ops) + một hàm SECURITY
// DEFINER hẹp (auth_lookup) để login tra cứu mà không phải JOIN thẳng sang
// member_contacts (bảng đó bị REVOKE ALL từ migration 005 — JOIN thẳng sẽ
// chết với "permission denied for table member_contacts").
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      family_id uuid NOT NULL,
      issued_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      replaced_by uuid REFERENCES refresh_tokens(id)
    );
    CREATE INDEX idx_rt_member ON refresh_tokens (member_id) WHERE revoked_at IS NULL;
    -- Xoay vòng cần tra "cả họ token này còn sống không" khi phát hiện tái sử
    -- dụng một token đã bị thay thế (dấu hiệu bị đánh cắp) — chỉ mục theo
    -- family_id để việc REVOKE cả họ không phải quét toàn bảng.
    CREATE INDEX idx_rt_family ON refresh_tokens (family_id);

    CREATE TABLE otp_challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      phone_hash text NOT NULL,
      code_hash text NOT NULL,
      purpose text NOT NULL CHECK (purpose IN ('register','reset')),
      attempts int NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','used','burned','expired')),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_otp_phone ON otp_challenges (phone_hash, created_at DESC);
  `);

  // roles: LỆCH CÓ CHỦ ĐÍCH khỏi luật toàn cục "mọi bảng có community_id" —
  // đây là 5 hằng số nền tảng (guest, member, content_ops, approver, tech),
  // được gieo đúng một lần NGAY TRONG migration này, TRƯỚC KHI bất kỳ dòng
  // communities nào tồn tại (schema trống → 001..008 chạy tuần tự, chưa ai
  // gọi INSERT INTO communities). Nếu roles.community_id NOT NULL thì bước
  // gieo dưới đây không có giá trị hợp lệ nào để điền — phải chờ tới khi có
  // community đầu tiên, trái với yêu cầu brief "seed 5 vai ngay trong 008".
  // communities là bảng gốc duy nhất khác cũng không có cột này, cùng một lý
  // do: nó LÀ cái các bảng khác trỏ tới, không phải dữ liệu CỦA một cộng
  // đồng. Toàn bộ chỗ dùng `roles` trong spec thiết kế (fn_fund_two_approvers,
  // contact_upsert, ...) cũng JOIN qua r.key mà không lọc theo community_id —
  // khớp với việc coi roles là bảng gốc dùng chung.
  //
  // member_roles NGƯỢC LẠI có community_id: đây là dữ liệu gán vai cho một
  // người CỤ THỂ trong một cộng đồng cụ thể, đúng tinh thần luật toàn cục.
  // Khóa ngoại ghép (member_id, community_id) → members (id, community_id)
  // dùng lại UNIQUE members_id_cid mà migration 004 đã để sẵn cho việc này —
  // CSDL tự chặn gán vai cho một người ở một community khác community của họ.
  await knex.raw(`
    CREATE TABLE roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      name text NOT NULL
    );

    CREATE TABLE member_roles (
      member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      community_id uuid NOT NULL REFERENCES communities(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (member_id, role_id),
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_member_roles_role ON member_roles (role_id);

    INSERT INTO roles (key, name) VALUES
      ('guest', 'Khách'),
      ('member', 'Thành viên'),
      ('content_ops', 'Biên tập nội dung'),
      ('approver', 'Người duyệt'),
      ('tech', 'Kỹ thuật');
  `);

  // auth_lookup: SECURITY DEFINER hẹp — đây là điểm brief Task 7 SAI mà đề
  // bài đã cảnh báo trước: đoạn mẫu "login" gốc JOIN thẳng
  // `members m LEFT JOIN member_contacts c` bằng app_role sẽ chết với
  // "permission denied for table member_contacts" (migration 005 REVOKE ALL,
  // kể cả SELECT). Hàm này chạy bằng quyền của người tạo nó (owner), tự JOIN
  // được, nhưng chỉ TRẢ VỀ bốn cột đủ để xác thực — KHÔNG bao giờ trả số
  // điện thoại ra ngoài hàm.
  //
  // Lệch nhỏ so với SQL mẫu trong brief: thêm cột full_name (nằm ở bảng
  // members công khai, app_role vốn đã SELECT được thẳng nếu biết id — không
  // phải dữ liệu nhạy cảm mới) để authService.login() có gì trả về trong
  // `member.fullName` mà không phải truy vấn thêm lần hai.
  await knex.raw(`
    CREATE FUNCTION auth_lookup(p_community uuid, p_identifier text)
    RETURNS TABLE (id uuid, community_id uuid, password_hash text, status text, full_name text)
    LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
      SELECT m.id, m.community_id, m.password_hash, m.status, m.full_name
        FROM members m LEFT JOIN member_contacts c ON c.member_id = m.id
       WHERE m.community_id = p_community
         AND (lower(m.email) = lower(p_identifier) OR c.phone = p_identifier)
       LIMIT 1;
    $$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION auth_lookup(uuid, text) TO ??`, [user]);

  // ALTER DEFAULT PRIVILEGES (migration 002) đã tự cấp đủ bốn quyền cho bốn
  // bảng trên ngay lúc CREATE TABLE. Thu lại đúng phần không muốn:
  //
  // refresh_tokens/otp_challenges: vòng đời chỉ cần SELECT/INSERT/UPDATE
  // (revoked_at, replaced_by, attempts, status) — không có luồng nghiệp vụ
  // nào cần DELETE, và giữ lại dòng cũ (thay vì xoá) là bằng chứng cho điều
  // tra sau này (ai đã cố dò OTP, chuỗi xoay vòng token nào đã bị thay thế).
  //
  // roles/member_roles: chỉ SELECT cho app_role. `roles` là 5 hằng số nền
  // tảng, việc mở rộng thuộc Task 16 (permissions, migration 022_ops).
  // `member_roles` là việc GÁN vai — hành động nhạy cảm cần đi qua một hàm
  // SECURITY DEFINER hẹp giống contact_upsert (dự kiến ở luồng duyệt thành
  // viên, migration 012 theo lộ trình spec), không phải ghi thẳng bằng
  // app_role. Task 7 không tạo luồng gán vai nào — khoá lại theo đúng tinh
  // thần "nghi ngờ thì đóng" cho tới khi có hàm đó.
  await knex.raw(`
    REVOKE ALL ON refresh_tokens FROM ??;
    GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO ??;
    REVOKE ALL ON otp_challenges FROM ??;
    GRANT SELECT, INSERT, UPDATE ON otp_challenges TO ??;
    REVOKE ALL ON roles FROM ??;
    GRANT SELECT ON roles TO ??;
    REVOKE ALL ON member_roles FROM ??;
    GRANT SELECT ON member_roles TO ??;
  `, [user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS auth_lookup(uuid, text);
    DROP TABLE IF EXISTS member_roles;
    DROP TABLE IF EXISTS roles;
    DROP TABLE IF EXISTS otp_challenges;
    DROP TABLE IF EXISTS refresh_tokens;
  `);
}
