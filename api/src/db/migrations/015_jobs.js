// Việc làm và hợp tác — spec mục 11 dòng `015_jobs`, và mục 4.2 (ba chữ ký mở
// kênh).
//
// !!! ĐỌC TRƯỚC KHI SỬA TỆP NÀY !!!
// -------------------------------------------------------------------------
// Tệp này CREATE OR REPLACE lại `contact_read`. CREATE OR REPLACE ghi đè TOÀN
// BỘ thân hàm. Bản ở migration 012a vá một lỗ RÒ DỮ LIỆU CÁ NHÂN CHÉO CỘNG
// ĐỒNG có thật, đã tái hiện được (Ruling T10-a): người ở cộng đồng A đọc được
// số điện thoại thật của người ở cộng đồng B, vì hàm gốc đọc community_id của
// người BỊ XEM mà không bao giờ so với cộng đồng của người XEM. Lỗ đó nằm
// trong một hàm SECURITY DEFINER nên REVOKE ALL trên member_contacts KHÔNG đỡ
// được.
//
// Bỏ sót hai câu kiểm cộng đồng dưới đây ⇒ bản vá bị xoá TRONG IM LẶNG, không
// lỗi, không cảnh báo. `api/tests/t13-contact-read-survives.test.js` là cái
// chốt canh riêng việc đó: nó chạy sau khi MỌI migration đã áp, dựng hai cộng
// đồng, và đỏ ngay nếu hai câu ấy biến mất.
// -------------------------------------------------------------------------
//
// BA CHỮ KÝ MỞ KÊNH (mục 4.2). `intro_three_consents` là ràng buộc CHECK —
// phần dễ. Phần khó là số điện thoại không nằm ở chỗ API lỡ tay đọc được, và
// điều đó đã xong từ migration 005 (member_contacts bị REVOKE ALL). Cái tệp
// này thêm vào là NHÁNH THỨ HAI của "on_consent": một lời giới thiệu đã mở
// kênh cũng là một sự đồng ý — nó chỉ khác ở chỗ sự đồng ý đó do BA người
// cùng ký chứ không phải một đơn xin quyền tay đôi.
//
// Nhánh mới KHÔNG viết lại luật cơ sở. Trạng thái nền vẫn do fn_privacy_state
// (migration 012b) quyết — cùng hàm mà contactStates() và bộ lọc danh bạ gọi.
// Nếu chép lại luật ở đây thì tám trường lại có hai bản luật, đúng điều
// migration 012b vừa dẹp.

const CONTACT_READ = `
    CREATE OR REPLACE FUNCTION contact_read(p_target uuid, p_field text) RETURNS contact_result
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_viewer uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_state text; v_ok boolean := false; v_reason text; v_cid uuid; v_viewer_cid uuid;
      v_out contact_result;
    BEGIN
      IF v_viewer IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      -- Danh sách trắng KIỂM TRƯỚC khi p_field được dùng trong format('%I')
      -- bên dưới — đây là chỗ duy nhất trong hệ thống nối tên cột động vào SQL.
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;
      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      -- ========================================================================
      -- HAI CÂU KIỂM CỘNG ĐỒNG CỦA MIGRATION 012a — GIỮ NGUYÊN, KHÔNG ĐƯỢC BỎ.
      -- IS DISTINCT FROM (không phải <>) để người xem không tồn tại — v_viewer_cid
      -- là NULL — cũng rơi vào nhánh từ chối thay vì lọt qua vì NULL <> x là NULL.
      -- RAISE 'NO_TARGET' (không phải một mã riêng) vì đặc tả mục 5.3 đòi
      -- "không tồn tại" và "khác cộng đồng" phải không phân biệt được từ ngoài;
      -- hai thông điệp khác nhau chính là công cụ dò danh sách thành viên.
      SELECT community_id INTO v_viewer_cid FROM members WHERE id = v_viewer;
      IF v_viewer_cid IS DISTINCT FROM v_cid THEN RAISE EXCEPTION 'NO_TARGET'; END IF;
      -- ========================================================================

      -- Luật nền: MỘT nguồn sự thật cho cả tám trường (migration 012b).
      v_state := fn_privacy_state(v_viewer, p_target, p_field);

      IF v_state IN ('self','visible') THEN
        v_ok := true;
      ELSIF v_state = 'closed' THEN
        v_reason := 'CLOSED';
      ELSE
        v_reason := 'NEEDS_CONSENT';
      END IF;

      -- NHÁNH MỚI Ở 015 — mục 4.2: một lời giới thiệu đã MỞ KÊNH cũng cho phép
      -- đọc, nhưng chỉ giữa đúng hai đầu của kênh đó (người đăng tin và ứng
      -- viên), chỉ khi channel_opened_at đã đặt, và chỉ trong cùng cộng đồng.
      -- channel_opened_at chỉ đặt được khi ĐỦ BA chữ ký — ràng buộc
      -- intro_three_consents ở dưới ép điều đó, nên ở đây không phải kiểm lại
      -- ba cột consent_* (kiểm lại là dựng bản sao thứ hai của cùng một luật).
      --
      -- Vì sao KHÔNG mở khi mức là 'closed': đóng hẳn là câu trả lời của chính
      -- chủ hồ sơ cho MỌI người, còn ba chữ ký chỉ thay được cho bước "xin
      -- phép" của mức on_consent. Một lời giới thiệu không lấn quyền được người
      -- đã nói không.
      IF NOT v_ok AND v_reason = 'NEEDS_CONSENT' THEN
        v_ok := EXISTS (
          SELECT 1 FROM introductions i
           WHERE i.community_id = v_cid
             AND i.channel_opened_at IS NOT NULL
             AND ((i.poster_id = v_viewer AND i.candidate_id = p_target)
               OR (i.candidate_id = v_viewer AND i.poster_id = p_target)));
        IF v_ok THEN v_reason := NULL; END IF;
      END IF;

      IF v_ok THEN
        EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
          INTO v_out.value USING p_target;
        v_out.allowed := true;
      ELSE
        v_out.allowed := false; v_out.reason := v_reason;   -- KHÔNG RAISE (bẫy 1)
      END IF;

      -- detail CHỈ chứa tên trường và mã lý do — KHÔNG BAO GIỜ giá trị liên hệ.
      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_viewer,
              CASE WHEN v_ok THEN 'contact.read' ELSE 'contact.denied' END,
              'member', p_target,
              jsonb_build_object('field', p_field, 'reason', coalesce(v_reason, 'ok')));
      RETURN v_out;
    END $fn$;
`;

export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE job_needs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      poster_id uuid NOT NULL,
      title text NOT NULL,
      description text,
      terms text,
      area_id uuid REFERENCES areas(id),
      job_type text NOT NULL DEFAULT 'thoi_vu'
        CHECK (job_type IN ('dai_han','thoi_vu','hop_tac','hoc_nghe')),
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','closed','filled','cancelled')),
      close_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT job_need_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (poster_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_job_needs_open ON job_needs (community_id, created_at DESC) WHERE status = 'open';

    -- Hồ sơ sẵn sàng nhận việc: MỘT người MỘT hồ sơ (khoá chính là member_id),
    -- không phải một danh sách bản nháp để người ta rải khắp nơi.
    CREATE TABLE ready_profiles (
      member_id uuid PRIMARY KEY,
      community_id uuid NOT NULL REFERENCES communities(id),
      headline text,
      availability text,
      area_id uuid REFERENCES areas(id),
      note text,
      status text NOT NULL DEFAULT 'ready'
        CHECK (status IN ('ready','by_appointment','paused')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ready_id_cid UNIQUE (member_id, community_id),
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id) ON DELETE CASCADE
    );

    CREATE TABLE introductions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      job_need_id uuid,
      introducer_id uuid NOT NULL,
      candidate_id uuid NOT NULL,
      poster_id uuid NOT NULL,
      note text,
      consent_introducer boolean NOT NULL DEFAULT false,
      consent_candidate  boolean NOT NULL DEFAULT false,
      consent_poster     boolean NOT NULL DEFAULT false,
      channel_opened_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT intro_id_cid UNIQUE (id, community_id),
      -- Ba vai phải là ba người khác nhau ở hai vế quan trọng: người được giới
      -- thiệu không tự giới thiệu mình, và không giới thiệu mình cho chính mình.
      CONSTRAINT intro_distinct_candidate CHECK (candidate_id <> introducer_id
                                            AND candidate_id <> poster_id),
      -- spec mục 4.2 nguyên văn
      CONSTRAINT intro_three_consents CHECK (
        channel_opened_at IS NULL
        OR (consent_introducer AND consent_candidate AND consent_poster)),
      FOREIGN KEY (job_need_id, community_id)   REFERENCES job_needs (id, community_id),
      FOREIGN KEY (introducer_id, community_id) REFERENCES members (id, community_id),
      FOREIGN KEY (candidate_id, community_id)  REFERENCES members (id, community_id),
      FOREIGN KEY (poster_id, community_id)     REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_intro_channel ON introductions (community_id, poster_id, candidate_id)
      WHERE channel_opened_at IS NOT NULL;

    CREATE TABLE connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      job_need_id uuid,
      introduction_id uuid,
      poster_id uuid NOT NULL,
      worker_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'contacted'
        CHECK (status IN ('contacted','agreed','working','done','failed')),
      work_record_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conn_id_cid UNIQUE (id, community_id),
      CONSTRAINT conn_not_self CHECK (poster_id <> worker_id),
      FOREIGN KEY (job_need_id, community_id)     REFERENCES job_needs (id, community_id),
      FOREIGN KEY (introduction_id, community_id) REFERENCES introductions (id, community_id),
      FOREIGN KEY (poster_id, community_id)       REFERENCES members (id, community_id),
      FOREIGN KEY (worker_id, community_id)       REFERENCES members (id, community_id),
      FOREIGN KEY (work_record_id, community_id)  REFERENCES work_records (id, community_id)
    );

    -- Sổ sự kiện: chỉ thêm, không sửa, không xoá (bảng mục 4.8).
    CREATE TABLE connection_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      connection_id uuid NOT NULL,
      kind text NOT NULL,
      note text,
      actor_id uuid,
      at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (connection_id, community_id) REFERENCES connections (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_conn_events ON connection_events (connection_id, at);
  `);

  await knex.raw(CONTACT_READ);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO ??`, [user]);

  await knex.raw(`
    REVOKE ALL ON job_needs FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON job_needs TO ??;
    REVOKE ALL ON ready_profiles FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ready_profiles TO ??;
    REVOKE ALL ON introductions FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON introductions TO ??;
    REVOKE ALL ON connections FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON connections TO ??;
    REVOKE ALL ON connection_events FROM ??;
    GRANT SELECT, INSERT ON connection_events TO ??;
  `, [user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS connection_events;
    DROP TABLE IF EXISTS connections;
    DROP TABLE IF EXISTS introductions;
    DROP TABLE IF EXISTS ready_profiles;
    DROP TABLE IF EXISTS job_needs;
  `);
  // KHÔNG khôi phục thân contact_read của 012a ở đây: down() của 015 chạy
  // trước down() của 012a trong mọi thứ tự hợp lệ, và bản 015 vẫn chạy đúng
  // khi bảng introductions không còn (plpgsql phân giải tên trễ, nhưng nhánh
  // EXISTS sẽ lỗi lúc chạy). Thay vào đó dựng lại đúng bản 012a — nguyên văn,
  // không có nhánh introductions.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION contact_read(p_target uuid, p_field text) RETURNS contact_result
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_viewer uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_level text; v_ok boolean := false; v_reason text; v_cid uuid; v_viewer_cid uuid;
      v_out contact_result;
    BEGIN
      IF v_viewer IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;
      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      SELECT community_id INTO v_viewer_cid FROM members WHERE id = v_viewer;
      IF v_viewer_cid IS DISTINCT FROM v_cid THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      SELECT level INTO v_level FROM privacy_settings
       WHERE member_id = p_target AND field_key = p_field;
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

      IF v_ok THEN
        EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
          INTO v_out.value USING p_target;
        v_out.allowed := true;
      ELSE
        v_out.allowed := false; v_out.reason := v_reason;
      END IF;

      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_viewer,
              CASE WHEN v_ok THEN 'contact.read' ELSE 'contact.denied' END,
              'member', p_target,
              jsonb_build_object('field', p_field, 'reason', coalesce(v_reason, 'ok')));
      RETURN v_out;
    END $fn$;
  `);
}
