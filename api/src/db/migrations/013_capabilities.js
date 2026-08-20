// Năng lực — cái mà một người khai là mình làm được, và BẰNG CHỨNG cho lời
// khai đó (spec mục 11, dòng `013_capabilities`).
//
// Ba bảng: capabilities (lời khai), capability_photos (ảnh minh hoạ),
// capability_evidence (nối lời khai với bản ghi việc đã có đủ chữ ký).
//
// `capabilities.price` LÀ NHÀ của field_key 'price' trong privacy_settings.
// Trước Task 13 mức riêng tư đó không có dữ liệu nào để canh; nay nó có. Chưa
// có endpoint năng lực (giai đoạn 2–6), nên chỗ duy nhất phải nhớ khi dựng
// endpoint đó là: đọc `price` qua fn_privacy_state như mọi trường khác, đừng
// trả thẳng cột. Ghi ở đây vì đây là nơi người viết endpoint sẽ nhìn vào.
//
// RÀNG BUỘC ĐÁNG GIÁ NHẤT của tệp này là fn_capability_evidence_valid: bằng
// chứng phải là việc mà CHÍNH CHỦ năng lực có tham gia VÀ đã tự xác nhận.
// Thiếu nó, "bằng chứng" chỉ là một khoá ngoại trỏ tới việc của người khác —
// tôi khai tôi biết ốp lát và dẫn chứng công trình của anh hàng xóm. Nguyên
// tắc 2 (không có gì thành sự thật nếu chỉ một bên nói) áp vào đây nghĩa là:
// bằng chứng phải là một việc mà người kia đã ký tên vào.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE capabilities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      member_id uuid NOT NULL,
      title text NOT NULL,
      description text,
      category text,
      -- giá là VĂN BẢN chứ không phải số: "theo m2, báo sau khi xem", "thoả
      -- thuận", "95.000/m2" đều là câu trả lời thật của người làm nghề. Ép
      -- thành numeric là ép người ta khai một con số họ chưa biết.
      price text,
      years_experience int CHECK (years_experience IS NULL OR years_experience >= 0),
      status text NOT NULL DEFAULT 'published'
        CHECK (status IN ('draft','published','hidden')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT cap_id_cid UNIQUE (id, community_id),
      -- Khoá ngoại GHÉP: CSDL tự chặn năng lực gắn cho người ở cộng đồng khác.
      -- Lỗi "quên lọc community_id" đã lặp sáu lần trong dự án; dùng khoá ghép
      -- là cách duy nhất khiến chỗ quên trở thành lỗi lúc ghi thay vì một
      -- đường rò im lặng.
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_cap_member ON capabilities (member_id) WHERE status = 'published';
    CREATE INDEX idx_cap_dir ON capabilities (community_id, category, status);

    CREATE TABLE capability_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      capability_id uuid NOT NULL,
      url text NOT NULL,
      caption text,
      sort_order int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (capability_id, community_id) REFERENCES capabilities (id, community_id) ON DELETE CASCADE
    );
    CREATE INDEX idx_cap_photos ON capability_photos (capability_id, sort_order);

    CREATE TABLE capability_evidence (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      capability_id uuid NOT NULL,
      work_record_id uuid NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (capability_id, work_record_id),
      FOREIGN KEY (capability_id, community_id)  REFERENCES capabilities (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (work_record_id, community_id) REFERENCES work_records (id, community_id)
    );
    CREATE INDEX idx_cap_evidence_wr ON capability_evidence (work_record_id);
  `);

  await knex.raw(`
    CREATE FUNCTION fn_capability_evidence_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_owner uuid;
    BEGIN
      SELECT member_id INTO v_owner FROM capabilities
       WHERE id = NEW.capability_id AND community_id = NEW.community_id;
      IF v_owner IS NULL THEN
        RAISE EXCEPTION 'NO_CAPABILITY';        -- khoá ngoại đã chặn, nhưng đừng đoán
      END IF;

      IF NOT EXISTS (SELECT 1 FROM work_participants p
                      WHERE p.work_record_id = NEW.work_record_id
                        AND p.community_id = NEW.community_id
                        AND p.member_id = v_owner) THEN
        RAISE EXCEPTION 'EVIDENCE_NOT_PARTICIPANT'
          USING DETAIL = 'chỉ được dẫn chứng việc mà chính mình có tham gia';
      END IF;

      -- ...và việc đó phải có chữ ký CỦA CHÍNH NGƯỜI ẤY. Có tên trong danh sách
      -- người tham gia là điều người tạo bản ghi việc tự điền; chữ ký thì không.
      IF NOT EXISTS (SELECT 1 FROM work_confirmations c
                      WHERE c.work_record_id = NEW.work_record_id
                        AND c.member_id = v_owner) THEN
        RAISE EXCEPTION 'EVIDENCE_NOT_CONFIRMED'
          USING DETAIL = 'việc dẫn làm bằng chứng phải được chính mình xác nhận trước';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_capability_evidence_valid
      BEFORE INSERT OR UPDATE ON capability_evidence
      FOR EACH ROW EXECUTE FUNCTION fn_capability_evidence_valid();
  `);

  // ALTER DEFAULT PRIVILEGES (migration 002) đã cấp đủ bốn quyền lúc CREATE
  // TABLE. Ba bảng này thuộc dòng "Còn lại: đủ bốn quyền" của bảng mục 4.8 —
  // người ta sửa và xoá được lời khai năng lực của chính mình. Khẳng định lại
  // cho tường minh thay vì im lặng dựa vào mặc định (tinh thần Ruling C10).
  await knex.raw(`
    REVOKE ALL ON capabilities FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON capabilities TO ??;
    REVOKE ALL ON capability_photos FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON capability_photos TO ??;
    REVOKE ALL ON capability_evidence FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON capability_evidence TO ??;
  `, [user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_capability_evidence_valid ON capability_evidence;
    DROP FUNCTION IF EXISTS fn_capability_evidence_valid();
    DROP TABLE IF EXISTS capability_evidence;
    DROP TABLE IF EXISTS capability_photos;
    DROP TABLE IF EXISTS capabilities;
  `);
}
