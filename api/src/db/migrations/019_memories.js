// Ký ức — spec mục 11 dòng `019_memories`, mục 2 (#5), mục 4.5 dòng "Ảnh ký ức
// chỉ approved khi tất cả đồng ý".
//
// Vì sao có `memory_photo_people` (spec mục 2, #5): bản gốc đặt `memory_consents`
// ở mức KÝ ỨC còn `memory_photos.excluded_reason` ở mức ẢNH — hai mức khác nhau
// cho cùng một câu hỏi "người này có đồng ý xuất hiện không". Sự đồng ý gắn với
// TỪNG TẤM ẢNH: đồng ý cho ảnh chụp buổi lễ không phải là đồng ý cho tấm chụp
// lúc mình đang khóc.
//
// ==========================================================================
// CHỖ THỨ BA CÙNG KHUÔN "ràng buộc trên bảng A không chạy khi động vào bảng B"
// — và chỗ này KHÔNG có trong đặc tả, tôi tìm ra khi rà theo yêu cầu của đề bài.
//
// Đặc tả chỉ nói "Trigger dò memory_photo_people" — tức một trigger trên
// `memory_photos`. Trigger đó chạy khi ảnh được đặt 'approved'. Nhưng sau đó:
//   * một người ĐỔI Ý (consent 'yes' -> 'no'), hoặc
//   * ai đó gắn thêm một người vào tấm ảnh đã duyệt, hoặc
//   * ai đó XOÁ hàng đồng ý của một người
// đều không đụng vào `memory_photos`, nên không trigger nào chạy, và tấm ảnh
// vẫn ở trạng thái 'approved'. Đúng cùng khuôn với lỗ hổng quỹ (mục 4.8),
// Ruling T12-b (work_participants), và endorsement_signatures (migration 018).
//
// Nặng hơn hai chỗ kia ở một điểm: quyền rút lại sự đồng ý là quyền mà cả mục
// 10 (Nghị định 13) dựa vào. Một cái nút "tôi rút lại" không làm tấm ảnh biến
// khỏi trang là đúng loại nút mà việc thừa kế (a) của task này vừa đi bịt.
//
// Nên có HAI trigger:
//   trg_memory_photo_consent   — trên memory_photos      (ngay, BEFORE)
//   trg_memory_photo_ppl_guard — trên memory_photo_people (hoãn tới COMMIT)
// Cái thứ hai hoãn để một giao dịch còn kịp gắn người rồi mới duyệt ảnh; cái
// thứ nhất chạy ngay để thông điệp lỗi gắn được vào đúng hàng ảnh.
// ==========================================================================
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      title text NOT NULL,
      body text,
      happened_on date,
      activity_id uuid,
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','pending','approved','hidden')),
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT mem_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (created_by, community_id)  REFERENCES members (id, community_id),
      FOREIGN KEY (activity_id, community_id) REFERENCES activities (id, community_id)
    );
    CREATE INDEX idx_memories_time ON memories (community_id, happened_on DESC);

    -- Lịch sử phiên bản: chỉ thêm, không sửa, không xoá (bảng mục 4.8).
    CREATE TABLE memory_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      memory_id uuid NOT NULL,
      version int NOT NULL CHECK (version > 0),
      title text,
      body text,
      edited_by uuid NOT NULL,
      edited_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (memory_id, version),
      FOREIGN KEY (memory_id, community_id) REFERENCES memories (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (edited_by, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE memory_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      memory_id uuid NOT NULL,
      url text NOT NULL,
      caption text,
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','excluded')),
      excluded_reason text,
      sort_order int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT mem_photo_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (memory_id, community_id) REFERENCES memories (id, community_id) ON DELETE CASCADE
    );

    -- Sự đồng ý ở mức TỪNG TẤM ẢNH (spec mục 2, #5).
    CREATE TABLE memory_photo_people (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      photo_id uuid NOT NULL,
      member_id uuid NOT NULL,
      -- 'no_reply' là mặc định, và nó KHÔNG phải đồng ý — im lặng không bao giờ
      -- là sự cho phép (spec mục 4.5).
      consent text NOT NULL DEFAULT 'no_reply' CHECK (consent IN ('yes','no','no_reply')),
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (photo_id, member_id),
      FOREIGN KEY (photo_id, community_id)  REFERENCES memory_photos (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_photo_people_member ON memory_photo_people (member_id);

    -- Sự đồng ý ở mức KÝ ỨC (câu chuyện có nhắc tên mình).
    CREATE TABLE memory_consents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      memory_id uuid NOT NULL,
      member_id uuid NOT NULL,
      consent text NOT NULL DEFAULT 'no_reply' CHECK (consent IN ('yes','no','no_reply')),
      decided_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (memory_id, member_id),
      FOREIGN KEY (memory_id, community_id) REFERENCES memories (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
  `);

  await knex.raw(`
    -- Hàm dùng chung cho cả hai trigger: MỘT câu trả lời cho câu hỏi "tấm ảnh
    -- này đã đủ đồng ý chưa". Hai trigger gọi cùng một hàm nên không có hai
    -- định nghĩa của "đủ" để trôi dạt khỏi nhau.
    CREATE FUNCTION fn_photo_consent_missing(p_photo uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(*)::int FROM memory_photo_people
       WHERE photo_id = p_photo AND consent <> 'yes';
    $fn$;

    CREATE FUNCTION fn_memory_photo_consent() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_missing int;
    BEGIN
      IF NEW.status <> 'approved' THEN RETURN NEW; END IF;
      v_missing := fn_photo_consent_missing(NEW.id);
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'PHOTO_CONSENT_INCOMPLETE'
          USING DETAIL = format('còn %s người trong ảnh chưa đồng ý', v_missing);
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_memory_photo_consent
      BEFORE INSERT OR UPDATE ON memory_photos
      FOR EACH ROW EXECUTE FUNCTION fn_memory_photo_consent();
  `);

  await knex.raw(`
    -- Lớp thứ hai — xem ghi chú đầu tệp. Hoãn tới COMMIT để một giao dịch còn
    -- gắn được người vào ảnh đang chờ duyệt; sai thì hỏng ở COMMIT.
    CREATE FUNCTION fn_memory_photo_people_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_photo uuid; v_status text; v_missing int;
    BEGIN
      IF TG_OP = 'DELETE' THEN v_photo := OLD.photo_id; ELSE v_photo := NEW.photo_id; END IF;

      SELECT status INTO v_status FROM memory_photos WHERE id = v_photo;
      IF v_status IS NULL THEN RETURN NULL; END IF;      -- ảnh đã biến mất
      IF v_status <> 'approved' THEN RETURN NULL; END IF;

      v_missing := fn_photo_consent_missing(v_photo);
      IF v_missing > 0 THEN
        RAISE EXCEPTION 'PHOTO_CONSENT_INCOMPLETE'
          USING DETAIL = format('ảnh đã duyệt nhưng còn %s người chưa đồng ý', v_missing);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_memory_photo_ppl_guard
      AFTER INSERT OR UPDATE OR DELETE ON memory_photo_people
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_memory_photo_people_guard();
  `);

  await knex.raw(`
    REVOKE ALL ON memories FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON memories TO ??;
    REVOKE ALL ON memory_photos FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON memory_photos TO ??;
    REVOKE ALL ON memory_photo_people FROM ??;
    -- Không DELETE: gỡ hàng của một người là cách xoá tiếng "không" của họ.
    -- Đổi ý thì UPDATE consent, đó mới là đường đúng và nó để lại dấu.
    GRANT SELECT, INSERT, UPDATE ON memory_photo_people TO ??;
    -- Bảng mục 4.8: đổi ý được, xoá thì không.
    REVOKE ALL ON memory_consents FROM ??;
    GRANT SELECT, INSERT, UPDATE ON memory_consents TO ??;
    -- Bảng mục 4.8: lịch sử phiên bản.
    REVOKE ALL ON memory_versions FROM ??;
    GRANT SELECT, INSERT ON memory_versions TO ??;
  `, [user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_memory_photo_ppl_guard ON memory_photo_people;
    DROP TRIGGER IF EXISTS trg_memory_photo_consent ON memory_photos;
    DROP FUNCTION IF EXISTS fn_memory_photo_people_guard();
    DROP FUNCTION IF EXISTS fn_memory_photo_consent();
    DROP FUNCTION IF EXISTS fn_photo_consent_missing(uuid);
    DROP TABLE IF EXISTS memory_consents;
    DROP TABLE IF EXISTS memory_photo_people;
    DROP TABLE IF EXISTS memory_photos;
    DROP TABLE IF EXISTS memory_versions;
    DROP TABLE IF EXISTS memories;
  `);
}
