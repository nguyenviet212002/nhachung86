// Vận hành — spec mục 11 dòng `022_ops`: `permissions`, `pending_actions`,
// `backups`, `restore_tests`, `moderation_queue`. (`roles` và `member_roles` đã
// tạo ở migration 008 theo Ruling C7 — middleware/auth.js của Task 7 truy vấn
// chúng, nên chúng không thể chờ tới đây.)
//
// Khung hai người ký (spec mục 7) được DỰNG ở đây nhưng chưa có endpoint —
// Task 14 làm phần đó. Nghĩa là mọi ràng buộc phải nằm ở tầng CSDL: cái duy
// nhất còn canh khi chưa ai viết service.
//
// CHỖ THỨ TƯ CÙNG KHUÔN "bảng A / bảng B". Cùng lập luận với quỹ (mục 4.8),
// endorsement_signatures (018), memory_photo_people (019): một constraint
// trigger trên `pending_actions` kiểm "đủ hai chữ ký" sẽ không chạy khi ai đó
// XOÁ một hàng `pending_action_signatures` của một hành động ĐÃ THI HÀNH. Với
// `contacts.export` hay `member.terminate` thì đó là xoá bằng chứng ai đã đồng
// ý cho một việc không thể hoàn tác.
//
// BA LUẬT CỦA MỤC 7.2 được ép ở đây thay vì chờ Task 14 viết `if`:
//   * người ký thứ hai phải khác người tạo (PRIMARY KEY đã chặn ký hai lần,
//     nhưng người TẠO cũng là một chữ ký nên phải nói rõ);
//   * người ký KHÔNG được là đối tượng của hành động (mục 7.2: không ai đồng ý
//     chấm dứt tư cách của chính mình, cũng không ai tự ký nới hạn mức cho mình);
//   * người ký phải mang đúng vai mà `action_key` đòi (bảng mục 7.5).
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    -- permissions / role_permissions là BẢNG GỐC dùng chung, không có
    -- community_id — cùng ngoại lệ đã tuyên cho \`roles\` ở migration 008: đây là
    -- hằng số của nền tảng chứ không phải dữ liệu CỦA một cộng đồng.
    CREATE TABLE permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text NOT NULL UNIQUE,
      name text NOT NULL,
      description text
    );

    CREATE TABLE role_permissions (
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE pending_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      action_key text NOT NULL CHECK (action_key IN (
        'data.delete', 'contacts.export', 'backup.restore',
        'member.terminate', 'guarantee.quota_override')),
      target_type text,
      target_id uuid,
      payload jsonb NOT NULL,
      payload_hash text NOT NULL,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','executed','expired','cancelled','stale')),
      executed_at timestamptz,
      result jsonb,
      CONSTRAINT pa_id_cid UNIQUE (id, community_id),
      CONSTRAINT pa_executed_pair CHECK ((status = 'executed') = (executed_at IS NOT NULL)),
      FOREIGN KEY (created_by, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_pa_pending ON pending_actions (community_id, expires_at) WHERE status = 'pending';

    CREATE TABLE pending_action_signatures (
      pending_action_id uuid NOT NULL,
      signer_id uuid NOT NULL,
      community_id uuid NOT NULL REFERENCES communities(id),
      signed_at timestamptz NOT NULL DEFAULT now(),
      payload_hash_at_sign text NOT NULL,
      ip inet,
      PRIMARY KEY (pending_action_id, signer_id),   -- một người không ký hai lần
      FOREIGN KEY (pending_action_id, community_id) REFERENCES pending_actions (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (signer_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE backups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      kind text NOT NULL CHECK (kind IN ('full','incremental','wal')),
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz,
      size_bytes bigint,
      ok boolean,
      location text,
      note text,
      CONSTRAINT backup_id_cid UNIQUE (id, community_id)
    );

    CREATE TABLE restore_tests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      backup_id uuid,
      ran_at timestamptz NOT NULL DEFAULT now(),
      ok boolean NOT NULL,
      note text,
      FOREIGN KEY (backup_id, community_id) REFERENCES backups (id, community_id)
    );

    CREATE TABLE moderation_queue (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      target_type text NOT NULL,
      target_id uuid NOT NULL,
      reason text,
      status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','approved','rejected')),
      created_at timestamptz NOT NULL DEFAULT now(),
      decided_by uuid,
      decided_at timestamptz,
      CONSTRAINT modq_decided_pair CHECK ((decided_by IS NULL) = (decided_at IS NULL)),
      FOREIGN KEY (decided_by, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_modq_open ON moderation_queue (community_id, created_at) WHERE status = 'open';
  `);

  await knex.raw(`
    -- Bảng mục 7.5 dưới dạng một hàm, để cả trigger lẫn Task 14 dùng CHUNG một
    -- bản đồ. Hai bản đồ giống nhau đặt ở hai chỗ là hai bản đồ sẽ khác nhau.
    CREATE FUNCTION fn_pending_action_role(p_action_key text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $fn$
      SELECT CASE p_action_key
               WHEN 'data.delete'              THEN 'approver'
               WHEN 'contacts.export'          THEN 'tech'
               WHEN 'backup.restore'           THEN 'tech'
               WHEN 'member.terminate'         THEN 'approver'
               WHEN 'guarantee.quota_override' THEN 'approver'
             END;
    $fn$;

    CREATE FUNCTION fn_pending_signature_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_action text; v_target_type text; v_target uuid; v_cid uuid; v_role text;
    BEGIN
      SELECT action_key, target_type, target_id, community_id
        INTO v_action, v_target_type, v_target, v_cid
        FROM pending_actions WHERE id = NEW.pending_action_id;
      IF v_action IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;

      -- Mục 7.2: người ký không được là ĐỐI TƯỢNG của hành động.
      IF v_target_type = 'member' AND v_target = NEW.signer_id THEN
        RAISE EXCEPTION 'SIGNER_IS_TARGET'
          USING DETAIL = 'không ai ký cho một hành động nhắm vào chính mình';
      END IF;

      -- Mục 7.5: vai mà action_key đòi hỏi, TRONG CHÍNH cộng đồng đó.
      v_role := fn_pending_action_role(v_action);
      IF NOT EXISTS (SELECT 1 FROM member_roles mr
                       JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = NEW.signer_id
                        AND mr.community_id = v_cid
                        AND r.key = v_role) THEN
        RAISE EXCEPTION 'SIGNER_ROLE_REQUIRED'
          USING DETAIL = format('hành động này cần người ký mang vai %s', v_role);
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_pending_signature_valid
      BEFORE INSERT OR UPDATE ON pending_action_signatures
      FOR EACH ROW EXECUTE FUNCTION fn_pending_signature_valid();
  `);

  await knex.raw(`
    -- MỘT định nghĩa của "đủ chữ ký", dùng chung cho hai trigger dưới.
    CREATE FUNCTION fn_pending_action_signatures(p_action uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT s.signer_id)::int
        FROM pending_action_signatures s
        JOIN pending_actions a ON a.id = s.pending_action_id
       WHERE s.pending_action_id = p_action
         AND s.community_id = a.community_id;
    $fn$;

    CREATE FUNCTION fn_pending_two_signatures() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_n int;
    BEGIN
      IF NEW.status <> 'executed' THEN RETURN NULL; END IF;
      v_n := fn_pending_action_signatures(NEW.id);
      IF v_n < 2 THEN
        RAISE EXCEPTION 'TWO_SIGNATURES_REQUIRED'
          USING DETAIL = format('hành động mới có %s chữ ký', v_n);
      END IF;
      -- Người tạo LÀ người ký thứ nhất (mục 7.2 bước 1), nên phải có chữ ký của
      -- họ; và ít nhất một chữ ký KHÁC họ. Kiểm cả hai vế thay vì tin vào việc
      -- service nhớ ghi hàng đầu tiên.
      IF NOT EXISTS (SELECT 1 FROM pending_action_signatures s
                      WHERE s.pending_action_id = NEW.id AND s.signer_id = NEW.created_by) THEN
        RAISE EXCEPTION 'CREATOR_SIGNATURE_MISSING'
          USING DETAIL = 'người tạo là người ký thứ nhất, không phải một bước riêng';
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_pending_two_signatures
      AFTER INSERT OR UPDATE ON pending_actions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_pending_two_signatures();

    -- Lớp thứ hai, trên CHÍNH bảng chữ ký — xem ghi chú đầu tệp.
    CREATE FUNCTION fn_pending_sig_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_action uuid; v_status text; v_n int;
    BEGIN
      IF TG_OP = 'DELETE' THEN v_action := OLD.pending_action_id;
                         ELSE v_action := NEW.pending_action_id; END IF;

      SELECT status INTO v_status FROM pending_actions WHERE id = v_action;
      IF v_status IS NULL THEN RETURN NULL; END IF;
      IF v_status <> 'executed' THEN RETURN NULL; END IF;

      v_n := fn_pending_action_signatures(v_action);
      IF v_n < 2 THEN
        RAISE EXCEPTION 'TWO_SIGNATURES_REQUIRED'
          USING DETAIL = format('hành động đã thi hành còn %s chữ ký', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_pending_sig_guard
      AFTER INSERT OR UPDATE OR DELETE ON pending_action_signatures
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_pending_sig_guard();
  `);

  await knex.raw(`
    REVOKE ALL ON permissions FROM ??;
    GRANT SELECT ON permissions TO ??;
    REVOKE ALL ON role_permissions FROM ??;
    GRANT SELECT ON role_permissions TO ??;
    REVOKE ALL ON pending_actions FROM ??;
    GRANT SELECT, INSERT, UPDATE ON pending_actions TO ??;
    -- Bảng mục 4.8: chữ ký không gỡ được.
    REVOKE ALL ON pending_action_signatures FROM ??;
    GRANT SELECT, INSERT ON pending_action_signatures TO ??;
    -- Bảng mục 4.8: ghi nhận việc đã xảy ra.
    REVOKE ALL ON backups FROM ??;
    GRANT SELECT, INSERT ON backups TO ??;
    REVOKE ALL ON restore_tests FROM ??;
    GRANT SELECT, INSERT ON restore_tests TO ??;
    REVOKE ALL ON moderation_queue FROM ??;
    GRANT SELECT, INSERT, UPDATE ON moderation_queue TO ??;
  `, [user, user, user, user, user, user, user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_pending_sig_guard ON pending_action_signatures;
    DROP TRIGGER IF EXISTS trg_pending_signature_valid ON pending_action_signatures;
    DROP TRIGGER IF EXISTS trg_pending_two_signatures ON pending_actions;
    DROP FUNCTION IF EXISTS fn_pending_sig_guard();
    DROP FUNCTION IF EXISTS fn_pending_two_signatures();
    DROP FUNCTION IF EXISTS fn_pending_action_signatures(uuid);
    DROP FUNCTION IF EXISTS fn_pending_signature_valid();
    DROP FUNCTION IF EXISTS fn_pending_action_role(text);
    DROP TABLE IF EXISTS moderation_queue;
    DROP TABLE IF EXISTS restore_tests;
    DROP TABLE IF EXISTS backups;
    DROP TABLE IF EXISTS pending_action_signatures;
    DROP TABLE IF EXISTS pending_actions;
    DROP TABLE IF EXISTS role_permissions;
    DROP TABLE IF EXISTS permissions;
  `);
}
