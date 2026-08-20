// Hoạt động — spec mục 11 dòng `017_activities`, và mục 4.5 dòng "Hoạt động
// dùng quỹ khi còn món chưa tổng kết ⇒ SUMMARY_REQUIRED".
//
// Năm bảng: activities, activity_participants, activity_needs,
// activity_summaries, activity_photos.
//
// LUẬT ĐÁNG GIÁ NHẤT: không mở hoạt động dùng quỹ mới khi còn hoạt động dùng
// quỹ CŨ ĐÃ XONG mà chưa có bản tổng kết. Đây không phải luật kế toán mà là
// luật về lòng tin: tiền của Hội đi ra mà không ai kể lại đã tiêu vào đâu thì
// lần quyên góp sau người ta sẽ nhớ. Ép ở tầng CSDL vì đây đúng loại việc mà
// tầng ứng dụng sẽ "tạm bỏ qua cho kịp buổi họp".
//
// Chỉ tính hoạt động ĐÃ KẾT THÚC (status='done' hoặc ends_at đã qua) — hoạt
// động đang diễn ra thì chưa có gì để tổng kết, chặn nó là chặn nhầm.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      title text NOT NULL,
      description text,
      area_id uuid REFERENCES areas(id),
      category text,
      starts_at timestamptz,
      ends_at timestamptz,
      uses_fund boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','open','running','done','cancelled')),
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT act_id_cid UNIQUE (id, community_id),
      CONSTRAINT act_time_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
      FOREIGN KEY (created_by, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_act_list ON activities (community_id, starts_at DESC);

    CREATE TABLE activity_participants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      activity_id uuid NOT NULL,
      member_id uuid NOT NULL,
      role text NOT NULL DEFAULT 'participant' CHECK (role IN ('organizer','participant')),
      joined_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (activity_id, member_id),
      FOREIGN KEY (activity_id, community_id) REFERENCES activities (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE activity_needs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      activity_id uuid NOT NULL,
      title text NOT NULL,
      kind text NOT NULL DEFAULT 'nguoi' CHECK (kind IN ('nguoi','vat_tu','tien','khac')),
      needed int NOT NULL DEFAULT 1 CHECK (needed > 0),
      filled int NOT NULL DEFAULT 0 CHECK (filled >= 0),
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT act_need_not_over CHECK (filled <= needed),
      FOREIGN KEY (activity_id, community_id) REFERENCES activities (id, community_id) ON DELETE CASCADE
    );

    -- MỘT hoạt động MỘT bản tổng kết (activity_id là khoá duy nhất) — không có
    -- chỗ cho hai bản "gần đúng" cùng tồn tại.
    CREATE TABLE activity_summaries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      activity_id uuid NOT NULL UNIQUE,
      body text NOT NULL,
      total_spent numeric(14,2),
      submitted_by uuid NOT NULL,
      submitted_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (activity_id, community_id) REFERENCES activities (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (submitted_by, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE activity_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      activity_id uuid NOT NULL,
      url text NOT NULL,
      caption text,
      sort_order int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (activity_id, community_id) REFERENCES activities (id, community_id) ON DELETE CASCADE
    );
  `);

  // Chỉ mục riêng phần đỡ đúng câu truy vấn của trigger (spec mục 9, điểm 5).
  await knex.raw(`
    CREATE INDEX idx_act_fund_open ON activities (community_id)
      WHERE uses_fund AND status <> 'cancelled';
  `);

  await knex.raw(`
    CREATE FUNCTION fn_activity_summary_required() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_stuck text;
    BEGIN
      IF NOT NEW.uses_fund THEN RETURN NEW; END IF;
      -- Trên UPDATE chỉ kiểm khi hoạt động VỪA chuyển sang dùng quỹ; nếu không
      -- thì mọi lần sửa tiêu đề của một hoạt động cũ cũng bị chặn, và luật trở
      -- thành thứ người ta tìm cách đi vòng.
      IF TG_OP = 'UPDATE' AND OLD.uses_fund THEN RETURN NEW; END IF;

      SELECT a.title INTO v_stuck
        FROM activities a
       WHERE a.community_id = NEW.community_id
         AND a.id <> NEW.id
         AND a.uses_fund
         AND a.status <> 'cancelled'
         AND (a.status = 'done' OR (a.ends_at IS NOT NULL AND a.ends_at < now()))
         AND NOT EXISTS (SELECT 1 FROM activity_summaries s WHERE s.activity_id = a.id)
       ORDER BY a.ends_at NULLS LAST
       LIMIT 1;

      IF v_stuck IS NOT NULL THEN
        RAISE EXCEPTION 'SUMMARY_REQUIRED'
          USING DETAIL = 'còn hoạt động dùng quỹ đã xong mà chưa có bản tổng kết';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_activity_summary_required
      BEFORE INSERT OR UPDATE ON activities
      FOR EACH ROW EXECUTE FUNCTION fn_activity_summary_required();
  `);

  await knex.raw(`
    REVOKE ALL ON activities FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON activities TO ??;
    REVOKE ALL ON activity_participants FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON activity_participants TO ??;
    REVOKE ALL ON activity_needs FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON activity_needs TO ??;
    REVOKE ALL ON activity_photos FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON activity_photos TO ??;
    -- Bản tổng kết không xoá được: xoá nó là mở lại đúng cánh cửa
    -- SUMMARY_REQUIRED vừa đóng.
    REVOKE ALL ON activity_summaries FROM ??;
    GRANT SELECT, INSERT, UPDATE ON activity_summaries TO ??;
  `, [user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_activity_summary_required ON activities;
    DROP FUNCTION IF EXISTS fn_activity_summary_required();
    DROP TABLE IF EXISTS activity_photos;
    DROP TABLE IF EXISTS activity_summaries;
    DROP TABLE IF EXISTS activity_needs;
    DROP TABLE IF EXISTS activity_participants;
    DROP TABLE IF EXISTS activities;
  `);
}
