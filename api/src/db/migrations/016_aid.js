// Giúp nhau — spec mục 11 dòng `016_aid`, và mục 4.5 dòng "Tự nhận suất,
// không điền hộ".
//
// Năm bảng: aid_requests (lời nhờ), aid_offers (ai ngỏ ý giúp), aid_slots
// (việc được chia thành suất), aid_slot_takers (ai nhận suất nào),
// aid_events (sổ sự kiện của một lời nhờ).
//
// HAI RÀNG BUỘC ĐÁNG KỂ:
//
// 1. `trg_slot_self_only` — fn_self_only('member_id'). KHÔNG nằm ở tệp này mà
//    ở migration 026; xem ghi chú ở đó. (Kế hoạch Task 13 bảo đặt vào 016 và
//    câu đó KHÔNG chạy được: fn_self_only sinh ở 025, tức SAU 016, còn
//    CREATE TRIGGER đòi hàm phải tồn tại ngay lúc chạy.)
//
// 2. `fn_aid_slot_capacity` — một suất có `needed` chỗ thì không nhận quá
//    `needed` người. Đây là bài toán BÓNG MA giống hạn mức bảo lãnh (mục 4.3):
//    đếm hàng chưa tồn tại thì `FOR UPDATE` không khoá được gì. Dùng khoá tư
//    vấn theo từng suất — rẻ, tự nhả khi commit, và chỉ chặn hai người cùng
//    giành đúng một suất chứ không chặn cả hệ thống.
//    Không có nó thì "cần 5 người" là một con số trang trí, và cái hại thật
//    không phải thừa người mà là hai người cùng tin mình đã nhận suất cuối.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE aid_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      requester_id uuid NOT NULL,
      -- người nhờ hộ (mẹ của thành viên, gia đình...) — vẫn phải có một thành
      -- viên đứng tên ở requester_id, nguyên tắc 1: không có lời nhờ vô danh
      on_behalf_of text,
      title text NOT NULL,
      description text,
      area_id uuid REFERENCES areas(id),
      urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
      status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','matched','done','closed','cancelled')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT aid_req_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (requester_id, community_id) REFERENCES members (id, community_id)
    );
    -- spec mục 8.2: "Hàng chờ giúp nhau"
    CREATE INDEX idx_aid_queue ON aid_requests (community_id, urgency, created_at)
      WHERE status = 'queued';

    CREATE TABLE aid_offers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      aid_request_id uuid NOT NULL,
      member_id uuid NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (aid_request_id, member_id),
      FOREIGN KEY (aid_request_id, community_id) REFERENCES aid_requests (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE aid_slots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      aid_request_id uuid NOT NULL,
      title text NOT NULL,
      needed int NOT NULL DEFAULT 1 CHECK (needed > 0),
      starts_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT aid_slot_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (aid_request_id, community_id) REFERENCES aid_requests (id, community_id) ON DELETE CASCADE
    );

    CREATE TABLE aid_slot_takers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      slot_id uuid NOT NULL,
      member_id uuid NOT NULL,
      taken_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (slot_id, member_id),
      FOREIGN KEY (slot_id, community_id) REFERENCES aid_slots (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_aid_taker_member ON aid_slot_takers (member_id);

    CREATE TABLE aid_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      aid_request_id uuid NOT NULL,
      kind text NOT NULL,
      note text,
      actor_id uuid,
      at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (aid_request_id, community_id) REFERENCES aid_requests (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_aid_events ON aid_events (aid_request_id, at);
  `);

  await knex.raw(`
    CREATE FUNCTION fn_aid_slot_capacity() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_needed int; v_n int;
    BEGIN
      -- Khoá tư vấn theo SUẤT, lấy TRƯỚC khi đếm. Đếm rồi mới khoá là đếm một
      -- con số đã cũ; đây đúng là bài toán bóng ma của mục 4.3.
      PERFORM pg_advisory_xact_lock(hashtextextended('aid_slot:' || NEW.slot_id::text, 31));

      SELECT needed INTO v_needed FROM aid_slots
       WHERE id = NEW.slot_id AND community_id = NEW.community_id;
      IF v_needed IS NULL THEN RAISE EXCEPTION 'NO_AID_SLOT'; END IF;

      SELECT count(*) INTO v_n FROM aid_slot_takers
       WHERE slot_id = NEW.slot_id AND member_id <> NEW.member_id;
      IF v_n + 1 > v_needed THEN
        RAISE EXCEPTION 'AID_SLOT_FULL'
          USING DETAIL = format('suất này cần %s người và đã đủ', v_needed);
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_aid_slot_capacity BEFORE INSERT ON aid_slot_takers
      FOR EACH ROW EXECUTE FUNCTION fn_aid_slot_capacity();
  `);

  await knex.raw(`
    REVOKE ALL ON aid_requests FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON aid_requests TO ??;
    REVOKE ALL ON aid_offers FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON aid_offers TO ??;
    REVOKE ALL ON aid_slots FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON aid_slots TO ??;
    REVOKE ALL ON aid_slot_takers FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON aid_slot_takers TO ??;
    REVOKE ALL ON aid_events FROM ??;
    GRANT SELECT, INSERT ON aid_events TO ??;
  `, [user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_aid_slot_capacity ON aid_slot_takers;
    DROP FUNCTION IF EXISTS fn_aid_slot_capacity();
    DROP TABLE IF EXISTS aid_events;
    DROP TABLE IF EXISTS aid_slot_takers;
    DROP TABLE IF EXISTS aid_slots;
    DROP TABLE IF EXISTS aid_offers;
    DROP TABLE IF EXISTS aid_requests;
  `);
}
