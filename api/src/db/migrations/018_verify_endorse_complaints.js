// Xác minh, bảo chứng, khiếu nại — spec mục 11 dòng
// `018_verify_endorse_complaints`, mục 4.5 dòng "Bảo chứng đúng 2 người khác
// nhau", và mục 4.8 (chữ ký là bút toán).
//
// ==========================================================================
// CHỖ THỨ HAI CÙNG KHUÔN VỚI LỖ HỔNG QUỸ — và đặc tả đã nói trước ("
// endorsement_signatures dùng cùng khuôn, khác ở `= 2`"), nhưng nói ở dạng một
// câu chứ không phải hai đối tượng SQL. Khuôn đó là:
//
//   ràng buộc đặt trên bảng A KHÔNG CHẠY khi người ta động vào bảng B.
//
// Cụ thể ở đây: một constraint trigger trên `endorsements` kiểm "đúng 2 chữ ký"
// lúc COMMIT sẽ KHÔNG kích hoạt khi giao dịch sau đó chỉ `DELETE FROM
// endorsement_signatures`. Giao dịch 1 ghi bảo chứng kèm 2 chữ ký (qua kiểm),
// giao dịch 2 gỡ một chữ ký — bảo chứng vẫn 'active' với một chữ ký, và không
// có gì kêu lên. Cùng đúng hình dạng Ruling T12-b (work_participants) và lỗ
// hổng quỹ ở mục 4.8.
//
// Nên có HAI trigger, một trên mỗi bảng:
//   trg_endorsement_two_signatures  — trên endorsements
//   trg_endorsement_sig_guard       — trên endorsement_signatures
// cộng với REVOKE UPDATE, DELETE để chặn đường app_role. Trigger chặn cả đường
// owner/psql, REVOKE chặn đường ứng dụng — hai lớp cho một tài sản.
// ==========================================================================
//
// VÌ SAO `= 2` CHỨ KHÔNG `>= 2` (khác trigger quỹ): đặc tả viết "đúng 2 người
// khác nhau". Bảo chứng không phải phép cộng — thêm chữ ký thứ ba không làm nó
// đúng hơn, chỉ làm mờ câu hỏi "ai chịu trách nhiệm". Với quỹ thì `>= 2` hợp lý
// vì bút toán lớn càng nhiều người soi càng tốt.
//
// KHÔNG ĐÒI VAI approver cho người ký: đặc tả mục 4.5 chỉ ghi "đúng 2 người
// khác nhau" và `signer_id <> member_id`. Màn frontend gọi đây là "Bảo chứng
// Ban điều hành", nên đòi vai là hợp lý về nghiệp vụ — nhưng đó là suy diễn,
// và thêm một ràng buộc không có trong đặc tả vào một bảng chưa có endpoint là
// dựng một cánh cửa mà người viết endpoint sẽ đâm vào mà không hiểu vì sao.
// Đã nêu trong task-13-report.md để người chủ trì quyết.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE verifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL,
      kind text NOT NULL CHECK (kind IN ('identity','address','skill','business')),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','verified','rejected')),
      verified_by uuid,
      verified_at timestamptz,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (member_id, kind),
      -- có lúc duyệt thì phải có người duyệt, và ngược lại (cùng khuôn
      -- wr_manual_review ở mục 4.1)
      CONSTRAINT verif_reviewer_pair CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
      CONSTRAINT verif_not_self CHECK (verified_by IS NULL OR verified_by <> member_id),
      FOREIGN KEY (member_id, community_id)   REFERENCES members (id, community_id),
      FOREIGN KEY (verified_by, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE endorsements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','revoked')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT endorse_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE endorsement_signatures (
      endorsement_id uuid NOT NULL,
      signer_id uuid NOT NULL,
      community_id uuid NOT NULL REFERENCES communities(id),
      signed_at timestamptz NOT NULL DEFAULT now(),
      note text,
      PRIMARY KEY (endorsement_id, signer_id),     -- một người không ký hai lần
      FOREIGN KEY (endorsement_id, community_id) REFERENCES endorsements (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (signer_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE complaints (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      reporter_id uuid NOT NULL,
      subject_member_id uuid,
      subject_type text,
      subject_id uuid,
      body text NOT NULL,
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','reviewing','resolved','dismissed')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT complaint_id_cid UNIQUE (id, community_id),
      CONSTRAINT complaint_not_self CHECK (subject_member_id IS NULL OR subject_member_id <> reporter_id),
      FOREIGN KEY (reporter_id, community_id)       REFERENCES members (id, community_id),
      FOREIGN KEY (subject_member_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_complaints_open ON complaints (community_id, created_at DESC) WHERE status IN ('open','reviewing');

    CREATE TABLE complaint_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      complaint_id uuid NOT NULL,
      kind text NOT NULL,
      note text,
      actor_id uuid,
      at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (complaint_id, community_id) REFERENCES complaints (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_complaint_events ON complaint_events (complaint_id, at);
  `);

  // -------------------------------------------------------------------------
  // Người ký không được là chính người được bảo chứng. Đây là ràng buộc LIÊN
  // BẢNG (signer_id ở bảng này, member_id ở bảng kia) nên CHECK không làm được;
  // trigger BEFORE INSERT là công cụ đúng, và nó chạy NGAY chứ không hoãn — sai
  // ở đây là sai hiển nhiên, báo sớm thì thông điệp gắn được vào đúng hàng.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_endorsement_signer_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_subject uuid;
    BEGIN
      SELECT member_id INTO v_subject FROM endorsements
       WHERE id = NEW.endorsement_id AND community_id = NEW.community_id;
      IF v_subject IS NULL THEN RAISE EXCEPTION 'NO_ENDORSEMENT'; END IF;
      IF v_subject = NEW.signer_id THEN
        RAISE EXCEPTION 'ENDORSEMENT_SELF_SIGN'
          USING DETAIL = 'không ai tự bảo chứng cho chính mình';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_endorsement_signer_valid
      BEFORE INSERT OR UPDATE ON endorsement_signatures
      FOR EACH ROW EXECUTE FUNCTION fn_endorsement_signer_valid();
  `);

  // -------------------------------------------------------------------------
  // Lớp 1: trên `endorsements`. Ràng buộc LIÊN HÀNG nên CHECK không làm được,
  // và BEFORE INSERT sai vì lúc ghi bảo chứng chưa có chữ ký nào. Công cụ đúng
  // là constraint trigger hoãn tới COMMIT, khi cả ba đã có mặt.
  //
  // Chỉ ép khi status = 'active': một bản nháp chưa có chữ ký nào là chuyện
  // bình thường. Đây là chỗ tương ứng với `abs(amount) < 1000000` của trigger
  // quỹ — ngưỡng mà dưới nó ràng buộc không có việc gì để làm.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_endorsement_two_signatures() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_n int;
    BEGIN
      IF NEW.status <> 'active' THEN RETURN NULL; END IF;
      SELECT count(DISTINCT s.signer_id) INTO v_n
        FROM endorsement_signatures s
       WHERE s.endorsement_id = NEW.id
         AND s.community_id = NEW.community_id       -- CÙNG cộng đồng
         AND s.signer_id <> NEW.member_id;
      IF v_n <> 2 THEN
        RAISE EXCEPTION 'ENDORSEMENT_NEEDS_TWO_DISTINCT'
          USING DETAIL = format('bảo chứng đang có %s chữ ký hợp lệ, cần đúng 2', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_endorsement_two_signatures
      AFTER INSERT OR UPDATE ON endorsements
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_endorsement_two_signatures();
  `);

  // -------------------------------------------------------------------------
  // Lớp 2: trên CHÍNH bảng chữ ký — xem ghi chú đầu tệp. Không có nó thì lớp 1
  // chỉ canh được lúc bảo chứng được ghi/sửa, còn việc GỠ một chữ ký sau đó
  // không đụng vào bảng `endorsements` nên không trigger nào chạy.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_endorsement_sig_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_e uuid; v_status text; v_subject uuid; v_cid uuid; v_n int;
    BEGIN
      IF TG_OP = 'DELETE' THEN v_e := OLD.endorsement_id; ELSE v_e := NEW.endorsement_id; END IF;

      SELECT status, member_id, community_id INTO v_status, v_subject, v_cid
        FROM endorsements WHERE id = v_e;
      IF v_status IS NULL THEN RETURN NULL; END IF;     -- bảo chứng đã biến mất
      IF v_status <> 'active' THEN RETURN NULL; END IF;

      SELECT count(DISTINCT s.signer_id) INTO v_n
        FROM endorsement_signatures s
       WHERE s.endorsement_id = v_e
         AND s.community_id = v_cid
         AND s.signer_id <> v_subject;
      IF v_n <> 2 THEN
        RAISE EXCEPTION 'ENDORSEMENT_NEEDS_TWO_DISTINCT'
          USING DETAIL = format('bảo chứng còn %s chữ ký hợp lệ, cần đúng 2', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_endorsement_sig_guard
      AFTER INSERT OR UPDATE OR DELETE ON endorsement_signatures
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_endorsement_sig_guard();
  `);

  await knex.raw(`
    REVOKE ALL ON verifications FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON verifications TO ??;
    REVOKE ALL ON endorsements FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON endorsements TO ??;
    -- Bảng mục 4.8: chữ ký không gỡ được.
    REVOKE ALL ON endorsement_signatures FROM ??;
    GRANT SELECT, INSERT ON endorsement_signatures TO ??;
    -- Đơn khiếu nại đã nộp không biến mất (cùng lý do với join_requests).
    REVOKE ALL ON complaints FROM ??;
    GRANT SELECT, INSERT, UPDATE ON complaints TO ??;
    REVOKE ALL ON complaint_events FROM ??;
    GRANT SELECT, INSERT ON complaint_events TO ??;
  `, [user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_endorsement_sig_guard ON endorsement_signatures;
    DROP TRIGGER IF EXISTS trg_endorsement_signer_valid ON endorsement_signatures;
    DROP TRIGGER IF EXISTS trg_endorsement_two_signatures ON endorsements;
    DROP FUNCTION IF EXISTS fn_endorsement_sig_guard();
    DROP FUNCTION IF EXISTS fn_endorsement_two_signatures();
    DROP FUNCTION IF EXISTS fn_endorsement_signer_valid();
    DROP TABLE IF EXISTS complaint_events;
    DROP TABLE IF EXISTS complaints;
    DROP TABLE IF EXISTS endorsement_signatures;
    DROP TABLE IF EXISTS endorsements;
    DROP TABLE IF EXISTS verifications;
  `);
}
