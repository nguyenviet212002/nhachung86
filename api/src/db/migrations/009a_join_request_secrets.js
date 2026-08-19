// Tách số điện thoại thô và băm mật khẩu ra khỏi join_requests.applicant_data.
//
// VIỆC THỪA KẾ TỪ TASK 8 (Ruling T8-f). applicant_data là cột jsonb mà app_role
// có SELECT, và cho tới trước migration này nó chứa số điện thoại thô cùng băm
// mật khẩu của người CHƯA phải thành viên. Cả kiến trúc bỏ công tách
// member_contacts ra khỏi members rồi REVOKE ALL (migration 005) để một route
// viết ẩu không làm lộ số điện thoại — nhưng một route mới chỉ cần
// `SELECT applicant_data FROM join_requests` rồi trả thẳng là đổ hết công đó,
// chỉ khác là lộ qua ĐƠN thay vì qua HỒ SƠ. Task 8 đã bịt bằng danh sách cho
// phép ở tầng service (publicApplicantData), nhưng đó là LỜI HỨA CỦA ỨNG DỤNG,
// không phải ràng buộc của CSDL — đúng thứ mà nguyên tắc "ép ở tầng dữ liệu"
// sinh ra để khỏi phải tin.
//
// VÌ SAO ĐÁNH SỐ 009a CHỨ KHÔNG PHẢI 013: bảng này là phần bổ sung cho chính
// join_requests (009) và không phụ thuộc gì ở 010–012, nên đặt tên để nó chạy
// ngay sau bảng mà nó sửa. Mọi số đã hẹn trước ở mục 11 đặc tả (013_capabilities,
// 014_signals, …) giữ nguyên, không cái nào phải dịch. Đã kiểm knex xử lý
// migration chèn giữa: validateMigrationList() ở
// node_modules/knex/lib/migrations/migrate/Migrator.js:728 chỉ báo lỗi khi có
// tệp ĐÃ CHẠY mà nay biến mất, không hề đòi tệp mới phải xếp sau tệp cũ — nên
// một CSDL đã chạy tới 010 vẫn nhận được 009a ở lần migrate tiếp theo.
//
// VÌ SAO KHÔNG PHẢI "REVOKE ALL rồi thêm hàm SECURITY DEFINER để ghi":
// đề bài nói REVOKE ALL, và ở ĐƯỜNG ĐỌC thì đúng là như vậy. Nhưng đường GHI
// thì cấp thẳng INSERT lại AN TOÀN HƠN một hàm SECURITY DEFINER:
//   * Tính chất bảo mật cần có là "app_role không ĐỌC được" — GRANT INSERT
//     (không SELECT, không UPDATE, không DELETE) giữ nguyên tính chất đó, và
//     bài test t16 chứng minh bằng `SELECT` thẳng bị từ chối.
//   * /auth/register là đường CÔNG KHAI, chạy withActor(null) — một hàm ghi
//     SECURITY DEFINER phục vụ nó sẽ phải chấp nhận "không có người thực hiện",
//     tức là một hàm chạy bằng quyền OWNER mà bất kỳ câu SQL nào của app_role
//     cũng gọi được, không kiểm được gì. Đó là quyền LỚN HƠN chứ không nhỏ hơn
//     GRANT INSERT trần.
//   * Không SELECT nghĩa là không UPDATE/DELETE có điều kiện, và PRIMARY KEY
//     làm mỗi đơn chỉ ghi được đúng một lần: app_role ghi được vào đây nhưng
//     không sửa lại, không đọc lại, không xoá.
// Đường ĐỌC vẫn là hàm hẹp join_secret_consume() dưới đây, đúng khuôn
// contact_read/contact_upsert.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    -- Đích cho khóa ngoại GHÉP (join_request_id, community_id) bên dưới. Cùng
    -- lý do với members_id_cid ở migration 004: với khóa ngoại đơn cột, một
    -- hàng bí mật của cộng đồng B trỏ được sang đơn của cộng đồng A.
    ALTER TABLE join_requests ADD CONSTRAINT jr_id_cid UNIQUE (id, community_id);

    CREATE TABLE join_request_secrets (
      join_request_id uuid PRIMARY KEY,
      community_id uuid NOT NULL REFERENCES communities(id),
      -- Số điện thoại thô: chỉ tồn tại từ lúc nộp đơn tới lúc duyệt, rồi được
      -- chuyển vào member_contacts (nơi có đủ 3 mức riêng tư canh giữ) và xoá
      -- khỏi đây. Không có bảng nào khác giữ hộ được vì hàng members chưa ra đời.
      phone text NOT NULL,
      -- Băm argon2 của mật khẩu người nộp đơn chọn. members.password_hash chỉ
      -- ra đời lúc duyệt, nên giữa hai mốc đó không chỗ nào khác chứa được.
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT jrs_request_same_community
        FOREIGN KEY (join_request_id, community_id)
        REFERENCES join_requests (id, community_id) ON DELETE CASCADE
    );
  `);

  // Dời dữ liệu của các đơn đã có. jsonb_typeof(x->'k') thay cho toán tử
  // `applicant_data ? 'k'`: dấu ? là ký tự placeholder của knex, và
  // positionBindings() quét nó VÔ ĐIỀU KIỆN trên mọi câu qua knex.raw — cùng
  // cái bẫy đã làm hỏng migration 002 ở Task 2, chỉ khác chỗ nó cắn.
  await knex.raw(`
    INSERT INTO join_request_secrets (join_request_id, community_id, phone, password_hash)
    SELECT id, community_id, applicant_data->>'phone', applicant_data->>'password_hash'
      FROM join_requests
     WHERE jsonb_typeof(applicant_data->'phone') = 'string'
       AND jsonb_typeof(applicant_data->'password_hash') = 'string';

    UPDATE join_requests
       SET applicant_data = applicant_data - 'phone' - 'password_hash'
     WHERE jsonb_typeof(applicant_data->'phone') IS NOT NULL
        OR jsonb_typeof(applicant_data->'password_hash') IS NOT NULL;
  `);

  await knex.raw(`REVOKE ALL ON join_request_secrets FROM ??`, [user]);
  await knex.raw(`GRANT INSERT ON join_request_secrets TO ??`, [user]);

  // ---------------------------------------------------------------------------
  // Đường ĐỌC duy nhất — cùng khuôn contact_read (migration 006).
  //
  // "consume" chứ không phải "read": hàm XOÁ hàng sau khi trả về. Người gọi hợp
  // lệ duy nhất là approve(), và ngay trong cùng giao dịch đó số điện thoại đi
  // vào member_contacts còn băm mật khẩu đi vào members.password_hash — hai chỗ
  // đã có máy móc riêng tư canh giữ. Giữ thêm một bản sao thô ở bảng này sau đó
  // là giữ đúng thứ mà cả kiến trúc đang tránh, và Nghị định 13 (mục 10 đặc tả)
  // nói dữ liệu cá nhân chỉ được lưu chừng nào còn mục đích. Nếu giao dịch
  // approve() hỏng thì rollback trả lại hàng — không mất gì.
  //
  // BA NHÁNH ĐỀU RAISE, khác với contact_read: ở contact_read, "bị từ chối vì
  // mức riêng tư" là HÀNH VI NGƯỜI DÙNG BÌNH THƯỜNG nên phải ghi được nhật ký,
  // mà RAISE thì cuốn luôn dòng nhật ký vừa ghi. Ở đây không có nhánh nào là
  // hành vi người dùng bình thường: người không phải approver không bao giờ tới
  // được hàm này qua API (route đã có requireRole('approver')), nên mọi nhánh
  // hỏng đều là lỗi lập trình hoặc tấn công qua kết nối app_role — đúng loại
  // mà contact_read cũng RAISE (NO_ACTOR/BAD_FIELD/NO_TARGET).
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE TYPE join_secret AS (phone text, password_hash text);

    CREATE FUNCTION join_secret_consume(p_request uuid) RETURNS join_secret
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cid uuid; v_status text; v_out join_secret;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;

      SELECT community_id, status INTO v_cid, v_status
        FROM join_requests WHERE id = p_request;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      -- Vai approver phải là vai TRONG CHÍNH CỘNG ĐỒNG CỦA ĐƠN. member_roles có
      -- cột community_id chính vì việc này; bỏ vế đó thì approver của cộng đồng
      -- B đọc được dữ liệu đăng ký của người nộp đơn ở cộng đồng A (cùng họ với
      -- Ruling T7-a và T8-d).
      IF NOT EXISTS (
        SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.member_id = v_actor AND mr.community_id = v_cid AND r.key = 'approver'
      ) THEN
        RAISE EXCEPTION 'JOIN_SECRET_DENIED'
          USING DETAIL = 'chỉ ban duyệt của chính cộng đồng này đọc được dữ liệu đăng ký';
      END IF;

      -- Cổng trạng thái lặp lại ở tầng CSDL điều mà approve() đã kiểm ở tầng
      -- ứng dụng. Cố ý lặp: nếu người sau viết một route khác gọi thẳng hàm này,
      -- CSDL vẫn chỉ mở đúng vào khoảnh khắc duyệt.
      IF v_status <> 'met_confirmed' THEN
        RAISE EXCEPTION 'JOIN_SECRET_DENIED'
          USING DETAIL = 'đơn không ở trạng thái chờ duyệt';
      END IF;

      DELETE FROM join_request_secrets WHERE join_request_id = p_request
        RETURNING phone, password_hash INTO v_out.phone, v_out.password_hash;
      IF v_out.password_hash IS NULL THEN
        RAISE EXCEPTION 'JOIN_SECRET_MISSING'
          USING DETAIL = 'đơn không có dữ liệu đăng ký kèm theo';
      END IF;

      -- detail chỉ có TÊN TRƯỜNG, không bao giờ giá trị (luật mục 10 đặc tả).
      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'join_request.secret_consumed', 'join_request', p_request,
              jsonb_build_object('fields', jsonb_build_array('phone', 'password_hash')));

      RETURN v_out;
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS join_secret_consume(uuid);
    DROP TYPE IF EXISTS join_secret;
    DROP TABLE IF EXISTS join_request_secrets;
    ALTER TABLE join_requests DROP CONSTRAINT IF EXISTS jr_id_cid;
  `);
}
