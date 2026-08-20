// Tín hiệu — spec mục 11 dòng `014_signals`: 5 bảng + view `v_signal_recipients`.
//
// VÌ SAO LÀ VIEW CHỨ KHÔNG PHẢI MỘT CỘT DO TRIGGER DUY TRÌ (spec mục 2, #6).
// Bản đặc tả gốc có cả `signal_recipients.response` lẫn bảng `signal_responses`
// — hai chỗ lưu CÙNG MỘT sự việc. `GENERATED ALWAYS AS` không cứu được vì nó
// chỉ tính trên các cột cùng hàng. Còn cột do trigger duy trì thì TRÔI DẠT
// TRONG IM LẶNG: xoá một hàng signal_responses mà quên trigger AFTER DELETE là
// hai bên lệch nhau, và không ai biết bên nào đúng. View không có bản sao nào
// để lệch — nó tính lại mỗi lần đọc.
//
// NGUYÊN TẮC 1 (không có gì ẩn danh) ở tệp này có ba đối tượng SQL, không phải
// một dòng trong tài liệu:
//   * signal_forwards.from_member_id NOT NULL + CHECK (from <> to): không có
//     chuyển tiếp không tên, và không ai chuyển tiếp cho chính mình để đẩy số.
//   * trg_forward_self_only: người chuyển tiếp phải LÀ người đang đăng nhập.
//     Đây là chỗ đặc tả chỉ ghi "NOT NULL + FK" — NOT NULL bắt được cột trống,
//     KHÔNG bắt được việc điền tên người khác vào đó. Chuyển tiếp là NHẬN
//     TRÁCH NHIỆM ("tên anh Tuấn đi kèm"), nên gán trách nhiệm đó cho người
//     khác là đúng thứ nguyên tắc 1 cấm.
//   * FK (signal_id, from_member_id) -> signal_recipients: chỉ người ĐÃ NHẬN
//     tín hiệu mới chuyển tiếp được nó. Người ngoài không bơm tín hiệu đi tiếp.
// và REVOKE UPDATE, DELETE: chuyển tiếp không rút lại được (bảng mục 4.8).
//
// signal_responses cũng dùng fn_self_only: không ai trả lời thay ai. Và khoá
// ngoại ghép (signal_id, responder_id) -> signal_recipients bảo đảm chỉ người
// nhận mới trả lời được — cùng khuôn với work_confirmations_wr_member_fkey ở
// mục 4.1.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE signals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      code text,
      created_by uuid NOT NULL,
      type text NOT NULL CHECK (type IN
        ('giup_gap','can_nang_luc','keu_goi','tim_nguoi','chia_se_co_hoi')),
      title text NOT NULL,
      body text,
      area_id uuid REFERENCES areas(id),
      urgent boolean NOT NULL DEFAULT false,
      ask text,
      respond_by timestamptz,
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','converging','closed','done','cancelled')),
      work_record_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sig_id_cid UNIQUE (id, community_id),
      UNIQUE (community_id, code),
      FOREIGN KEY (created_by, community_id) REFERENCES members (id, community_id),
      FOREIGN KEY (work_record_id, community_id) REFERENCES work_records (id, community_id)
    );
    CREATE INDEX idx_signals_open ON signals (community_id, created_at DESC) WHERE status = 'open';

    CREATE TABLE signal_recipients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      signal_id uuid NOT NULL,
      member_id uuid NOT NULL,
      -- vì sao người này nhận được tín hiệu; màn "Hộp tín hiệu" hiện nguyên
      -- văn cho người nhận đọc, đó là điều làm nó khác một cái thông báo hàng loạt
      reason text,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      -- KHÔNG có cột "response" ở đây — xem ghi chú đầu tệp.
      CONSTRAINT sig_rcpt_unique UNIQUE (signal_id, member_id),
      FOREIGN KEY (signal_id, community_id) REFERENCES signals (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
    -- spec mục 8.2: "Hộp tín hiệu chưa đọc"
    CREATE INDEX idx_sig_unread ON signal_recipients (member_id) WHERE read_at IS NULL;

    CREATE TABLE signal_responses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      signal_id uuid NOT NULL,
      responder_id uuid NOT NULL,
      ability text NOT NULL CHECK (ability IN ('accept','partial','refer','refuse')),
      note text,
      responded_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (signal_id, responder_id),
      -- chỉ NGƯỜI NHẬN mới trả lời được, và chỉ trả lời đúng tín hiệu mình nhận
      CONSTRAINT sig_resp_recipient_fkey FOREIGN KEY (signal_id, responder_id)
        REFERENCES signal_recipients (signal_id, member_id) ON DELETE CASCADE,
      FOREIGN KEY (responder_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE signal_forwards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      signal_id uuid NOT NULL,
      from_member_id uuid NOT NULL,
      to_member_id uuid NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT sig_fwd_not_self CHECK (from_member_id <> to_member_id),
      UNIQUE (signal_id, to_member_id),
      CONSTRAINT sig_fwd_from_recipient_fkey FOREIGN KEY (signal_id, from_member_id)
        REFERENCES signal_recipients (signal_id, member_id),
      FOREIGN KEY (to_member_id, community_id) REFERENCES members (id, community_id)
    );

    -- Phương án hội tụ: khi tín hiệu đã có phản hồi, mỗi người nhận việc nêu
    -- một phương án; cộng đồng chọn MỘT.
    CREATE TABLE signal_options (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      signal_id uuid NOT NULL,
      member_id uuid NOT NULL,
      summary text NOT NULL,
      start_on date,
      price_note text,
      chosen boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (signal_id, member_id),
      FOREIGN KEY (signal_id, community_id) REFERENCES signals (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
    -- Nhiều nhất MỘT phương án được chọn cho mỗi tín hiệu. Đây là ràng buộc
    -- liên hàng mà chỉ mục một phần làm được, nên không cần trigger.
    CREATE UNIQUE INDEX idx_sig_one_chosen ON signal_options (signal_id) WHERE chosen;
  `);

  // View thay cho cột trùng lặp (spec mục 2, #6).
  await knex.raw(`
    CREATE VIEW v_signal_recipients AS
    SELECT r.id, r.community_id, r.signal_id, r.member_id, r.reason, r.read_at, r.created_at,
           resp.ability AS response, resp.responded_at, resp.note AS response_note
      FROM signal_recipients r
      LEFT JOIN signal_responses resp
        ON resp.signal_id = r.signal_id AND resp.responder_id = r.member_id;
  `);

  await knex.raw(`
    -- Chuyển tiếp SINH RA một điểm nhận mới. Viết ở CSDL chứ không ở service
    -- vì v_signal_recipients là nguồn sự thật của "ai đang giữ tín hiệu này":
    -- để service nhớ chèn hai bảng là để nó có ngày quên một bảng.
    CREATE FUNCTION fn_signal_forward_recipient() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      INSERT INTO signal_recipients (community_id, signal_id, member_id, reason)
      VALUES (NEW.community_id, NEW.signal_id, NEW.to_member_id,
              format('nhận qua chuyển tiếp của %s', NEW.from_member_id))
      ON CONFLICT (signal_id, member_id) DO NOTHING;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_signal_forward_recipient AFTER INSERT ON signal_forwards
      FOR EACH ROW EXECUTE FUNCTION fn_signal_forward_recipient();
  `);

  // Hai trigger fn_self_only cho signal_responses và signal_forwards KHÔNG nằm
  // ở đây mà ở migration 026 — xem ghi chú đầu tệp 026. Lý do ngắn gọn:
  // fn_self_only được tạo ở 025, tức SAU tệp này, và CREATE TRIGGER đòi hàm
  // phải TỒN TẠI ngay lúc chạy (khác thân plpgsql, vốn phân giải tên trễ).


  await knex.raw(`
    REVOKE ALL ON signals FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON signals TO ??;
    REVOKE ALL ON signal_recipients FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON signal_recipients TO ??;
    REVOKE ALL ON signal_responses FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON signal_responses TO ??;
    REVOKE ALL ON signal_options FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON signal_options TO ??;
    -- Bảng mục 4.8: chuyển tiếp là NHẬN TRÁCH NHIỆM, không rút lại.
    REVOKE ALL ON signal_forwards FROM ??;
    GRANT SELECT, INSERT ON signal_forwards TO ??;
    REVOKE ALL ON v_signal_recipients FROM ??;
    GRANT SELECT ON v_signal_recipients TO ??;
  `, [user, user, user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_sig_fwd_self_only ON signal_forwards;
    DROP TRIGGER IF EXISTS trg_sig_resp_self_only ON signal_responses;
    DROP TRIGGER IF EXISTS trg_signal_forward_recipient ON signal_forwards;
    DROP FUNCTION IF EXISTS fn_signal_forward_recipient();
    DROP VIEW IF EXISTS v_signal_recipients;
    DROP TABLE IF EXISTS signal_options;
    DROP TABLE IF EXISTS signal_forwards;
    DROP TABLE IF EXISTS signal_responses;
    DROP TABLE IF EXISTS signal_recipients;
    DROP TABLE IF EXISTS signals;
  `);
}
