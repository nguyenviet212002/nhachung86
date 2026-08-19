// Ba bảng quyền riêng tư + cửa hông duy nhất vào member_contacts.
//
// member_contacts (migration 005) bị REVOKE ALL khỏi app_role, kể cả SELECT.
// contact_read là con đường duy nhất còn lại: hàm SECURITY DEFINER tự kiểm
// mức riêng tư chủ hồ sơ đặt, tự ghi audit_log, rồi mới trả giá trị.
//
// Bẫy quan trọng nhất — KHÔNG RAISE ở nhánh từ chối: hàm ghi một dòng
// audit_log rồi mới trả kết quả, tất cả trong CÙNG một câu lệnh/giao dịch mà
// caller đang mở qua withActor(). Nếu nhánh "không đủ quyền" RAISE EXCEPTION,
// ngoại lệ đó hủy cả giao dịch — và hủy luôn dòng nhật ký contact.denied vừa
// ghi. Hậu quả: một người dò hồ sơ người khác mười lần, bị từ chối cả mười,
// hệ thống không lưu được lần nào — đúng hành vi cần nhìn thấy nhất lại là
// hành vi biến mất. Vì vậy hàm trả về kiểu có trạng thái contact_result
// (allowed, value, reason); tầng ứng dụng đọc allowed rồi tự dịch thành lỗi
// HTTP. Ba nhánh NO_ACTOR/BAD_FIELD/NO_TARGET vẫn RAISE vì đó là lỗi lập
// trình (tham số sai/gọi ngoài giao dịch có actor), không phải hành vi người
// dùng cần audit.
//
// Thứ tự migration: 006 chạy giữa 005 và 007, tức lúc hàm này được TẠO thì
// bảng audit_log CHƯA TỒN TẠI. Điều đó vẫn an toàn: PostgreSQL chỉ phân giải
// tên bảng bên trong thân hàm plpgsql lúc THỰC THI (validate trễ), không
// phải lúc CREATE FUNCTION — CREATE FUNCTION chỉ kiểm cú pháp. Đã tự kiểm
// bằng cách chạy migration thật (xem báo cáo Task 6): `npx knex migrate:latest`
// từ schema trống chạy 001→007 tuần tự, 006 tạo hàm thành công dù audit_log
// chưa có, và khi 007 tạo xong bảng thì contact_read gọi được ngay — không
// cần dời phần tạo hàm sang migration lớn hơn 007.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE privacy_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      field_key text NOT NULL CHECK (field_key IN
        ('phone','zalo','messenger','address','job','area','price','family')),
      level text NOT NULL CHECK (level IN ('public','on_consent','closed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (member_id, field_key)
    );
    CREATE INDEX idx_privacy_lookup ON privacy_settings (member_id, field_key);

    CREATE TABLE contact_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      requester_id uuid NOT NULL REFERENCES members(id),
      target_id uuid NOT NULL REFERENCES members(id),
      field_key text NOT NULL,
      message text,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cr_not_self CHECK (requester_id <> target_id),
      UNIQUE (requester_id, target_id, field_key)
    );
    CREATE INDEX idx_cr_lookup ON contact_requests (requester_id, target_id, field_key);

    CREATE TABLE profile_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      viewer_id uuid NOT NULL REFERENCES members(id),
      target_id uuid NOT NULL REFERENCES members(id),
      what text NOT NULL,
      viewed_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_pv_target ON profile_views (target_id, viewed_at DESC);
  `);

  // ALTER DEFAULT PRIVILEGES (migration 002) đã tự cấp đủ bốn quyền cho ba
  // bảng trên ngay lúc CREATE TABLE. Ở đây chỉ thu lại đúng phần không muốn:
  //
  // profile_views: người xem KHÔNG được xóa dấu vết mình đã xem — nếu không,
  // màn "Ai đã xem hồ sơ của tôi" chỉ còn lại người quên xóa.
  // contact_requests: đơn đã nộp không được biến mất — DELETE bị thu, nhưng
  // UPDATE (đổi status khi duyệt/từ chối) vẫn cần giữ.
  await knex.raw(`REVOKE UPDATE, DELETE ON profile_views FROM ??`, [user]);
  await knex.raw(`REVOKE DELETE ON contact_requests FROM ??`, [user]);

  // Kiểu trả về có trạng thái — xem giải thích ở đầu file vì sao không RAISE.
  await knex.raw(`
    CREATE TYPE contact_result AS (allowed boolean, value text, reason text);

    CREATE FUNCTION contact_read(p_target uuid, p_field text) RETURNS contact_result
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_viewer uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_level text; v_ok boolean := false; v_reason text; v_cid uuid;
      v_out contact_result;
    BEGIN
      IF v_viewer IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      -- Danh sách trắng KIỂM TRƯỚC khi p_field được dùng trong format('%I')
      -- bên dưới — đây là chỗ duy nhất trong hệ thống nối tên cột động vào SQL.
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;
      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      SELECT level INTO v_level FROM privacy_settings
       WHERE member_id = p_target AND field_key = p_field;
      -- Thiếu cấu hình mặc định là 'closed', không phải 'public' — nghi ngờ
      -- thì đóng, không mở.
      v_level := coalesce(v_level, 'closed');

      IF    v_viewer = p_target THEN v_ok := true;
      ELSIF v_level = 'public'  THEN v_ok := true;
      ELSIF v_level = 'on_consent' THEN
        v_ok := EXISTS (SELECT 1 FROM contact_requests
                         WHERE requester_id = v_viewer AND target_id = p_target
                           AND field_key = p_field AND status = 'approved');
        IF NOT v_ok THEN v_reason := 'NEEDS_CONSENT'; END IF;
      ELSE  v_reason := 'CLOSED';
      END IF;

      -- Nhánh 'on_consent' qua một lời giới thiệu đủ ba chữ ký (introductions)
      -- CHƯA có ở đây — bảng introductions/job_needs thuộc Task 13. Migration
      -- 015 (Task 13) sẽ CREATE OR REPLACE hàm này để thêm nhánh đó vào
      -- ELSIF v_level = 'on_consent' phía trên, không đổi chữ ký hàm.

      IF v_ok THEN
        EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
          INTO v_out.value USING p_target;
        v_out.allowed := true;
      ELSE
        v_out.allowed := false; v_out.reason := v_reason;   -- KHÔNG RAISE
      END IF;

      -- detail CHỈ chứa tên trường và mã lý do — KHÔNG BAO GIỜ giá trị liên hệ.
      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_viewer,
              CASE WHEN v_ok THEN 'contact.read' ELSE 'contact.denied' END,
              'member', p_target,
              jsonb_build_object('field', p_field, 'reason', coalesce(v_reason, 'ok')));
      RETURN v_out;
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS contact_read(uuid, text);
    DROP TYPE IF EXISTS contact_result;
    DROP TABLE IF EXISTS profile_views;
    DROP TABLE IF EXISTS contact_requests;
    DROP TABLE IF EXISTS privacy_settings;
  `);
}
