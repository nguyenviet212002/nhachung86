// Nhật ký kiểm toán — phần nhạy cảm nhất của giai đoạn 1.
//
// Chuỗi băm bất biến: mỗi dòng lưu prev_hash = hash của dòng liền trước (theo
// community_id), và hash = sha256(prev_hash|actor|action|target|at). Băm PHẢI
// tính trong CSDL bằng trigger (fn_audit_chain) — ứng dụng không bao giờ có cơ
// hội tính sai hay tính hộ.
//
// Bảng chỉ-thêm: sau REVOKE ALL + GRANT SELECT, INSERT bên dưới, app_role
// (vai ứng dụng dùng để chạy server) không còn quyền UPDATE/DELETE trên
// audit_log/audit_chain_head — kể cả owner của bảng vẫn là nhachung_owner
// (vai chạy migration), nên lệnh REVOKE này có ý nghĩa thật: nếu ứng dụng
// chạy bằng chính chủ sở hữu bảng, REVOKE vô nghĩa vì chủ sở hữu tự cấp lại
// được bất cứ lúc nào.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE TABLE audit_log (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      seq bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
      community_id uuid NOT NULL REFERENCES communities(id),
      actor_id uuid,
      action text NOT NULL,
      target_type text,
      target_id uuid,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip inet,
      at timestamptz NOT NULL DEFAULT clock_timestamp(),
      prev_hash text,
      hash text,
      PRIMARY KEY (id, at)
    ) PARTITION BY RANGE (at);

    CREATE TABLE audit_chain_head (
      community_id uuid PRIMARY KEY REFERENCES communities(id),
      seq bigint, hash text
    );

    CREATE FUNCTION fn_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_prev text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || NEW.community_id::text, 7));
      SELECT hash INTO v_prev FROM audit_chain_head WHERE community_id = NEW.community_id;
      NEW.prev_hash := coalesce(v_prev, repeat('0', 64));
      NEW.at := coalesce(NEW.at, clock_timestamp());
      NEW.hash := encode(digest(
          NEW.prev_hash || '|' || coalesce(NEW.actor_id::text, '-') || '|' || NEW.action || '|' ||
          coalesce(NEW.target_type, '-') || '|' || coalesce(NEW.target_id::text, '-') || '|' ||
          to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex');
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION fn_audit_chain();

    CREATE FUNCTION fn_audit_head() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      INSERT INTO audit_chain_head (community_id, seq, hash)
      VALUES (NEW.community_id, NEW.seq, NEW.hash)
      ON CONFLICT (community_id) DO UPDATE SET seq = EXCLUDED.seq, hash = EXCLUDED.hash;
      RETURN NULL;
    END $fn$;

    CREATE TRIGGER trg_audit_head AFTER INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION fn_audit_head();
  `);

  // Bẫy mục 1 (phân mảnh): ALTER DEFAULT PRIVILEGES của migration 002 cấp đủ
  // bốn quyền (kể cả UPDATE/DELETE) cho MỌI bảng owner tạo về sau — kể cả các
  // phân mảnh của audit_log. Vì vậy phân mảnh KHÔNG BAO GIỜ được tạo bằng
  // CREATE TABLE tay; phải đi qua hàm này, hàm tự REVOKE ALL rồi GRANT lại
  // đúng hai quyền ngay sau khi tạo — không có khoảng hở nào giữa lúc tạo
  // bảng và lúc thu quyền vì cả hai câu lệnh nằm trong cùng một khối PL/pgSQL.
  await knex.raw(`
    CREATE FUNCTION fn_audit_new_partition(p_month date) RETURNS void
    LANGUAGE plpgsql AS $fn$
    DECLARE v_name text := 'audit_log_' || to_char(p_month, 'YYYY_MM');
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN RETURN; END IF;
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        v_name, date_trunc('month', p_month), date_trunc('month', p_month) + interval '1 month');
      EXECUTE format('REVOKE ALL ON %I FROM ${user}', v_name);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO ${user}', v_name);
    END $fn$;
  `);

  // audit_chain_head là bảng thường (không phải phân mảnh), nên nó CŨNG dính
  // đúng bẫy mục 1: ALTER DEFAULT PRIVILEGES của migration 002 đã tự cấp đủ
  // bốn quyền (kể cả DELETE) ngay lúc CREATE TABLE audit_chain_head ở trên —
  // brief gốc chỉ GRANT ba quyền mong muốn mà quên REVOKE ALL trước, nên
  // DELETE vẫn còn sót lại. Phải REVOKE ALL trước khi GRANT lại đúng tập quyền,
  // giống hệt cách xử lý audit_log.
  await knex.raw(`
    SELECT fn_audit_new_partition(date_trunc('month', now())::date);
    SELECT fn_audit_new_partition((date_trunc('month', now()) + interval '1 month')::date);
    REVOKE ALL ON audit_log FROM ??;
    GRANT SELECT, INSERT ON audit_log TO ??;
    REVOKE ALL ON audit_chain_head FROM ??;
    GRANT SELECT, INSERT, UPDATE ON audit_chain_head TO ??;
  `, [user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS audit_log CASCADE;
    DROP TABLE IF EXISTS audit_chain_head;
    DROP FUNCTION IF EXISTS fn_audit_chain(); DROP FUNCTION IF EXISTS fn_audit_head();
    DROP FUNCTION IF EXISTS fn_audit_new_partition(date);
  `);
}
