// Sao lưu và tác vụ định kỳ — Task 18.
//
// Bốn việc, mỗi việc một lý do:
//
//  1. `backups.kind` nhận thêm `'audit'`. Bản xuất nhật ký hằng tuần KHÔNG phải
//     một bản sao lưu `full`: nó chỉ có `audit_log` + `audit_chain_head`, nó đi
//     một đường khác, tới một đích khác, bằng một thông tin đăng nhập khác. Ghi
//     nó là `'full'` là nói dối đúng vào bảng mà quy trình khôi phục sẽ đọc để
//     chọn tệp — và ngày cần khôi phục thì không phải ngày để phát hiện điều đó.
//
//  2. `backups` và `restore_tests` thành CHỈ-THÊM cho MỌI NGƯỜI, kể cả chủ sở
//     hữu. `app_role` vốn đã chỉ có SELECT/INSERT (migration 022), nhưng
//     container sao lưu chạy bằng kết nối chủ sở hữu (nó phải `pg_dump` toàn
//     bộ, mà `app_role` không đọc nổi `member_contacts`) — nên nếu không có
//     trigger này thì đúng cái tài khoản chạy sao lưu cũng là tài khoản xoá
//     được dòng "sao lưu thất bại". Cùng lập luận với `fund_entries.locked`
//     (mục 4.8): một bản ghi việc-đã-xảy-ra thì ghi được, không sửa được.
//     Hệ quả bắt buộc cho `backup.sh`: ghi MỘT hàng lúc kết thúc, mang cả
//     `started_at` lẫn `finished_at`, chứ không mở hàng trước rồi cập nhật sau.
//
//  3. `fn_audit_verify_chain` — MỘT định nghĩa của phép kiểm chuỗi băm.
//     `core/audit.js` có nó bằng JavaScript, còn `verify-chain.sh` chạy trong
//     container sao lưu, nơi KHÔNG có Node. Chép câu SQL ấy sang shell là dựng
//     bản đồ thứ hai, và hai bản đồ giống nhau đặt ở hai chỗ là hai bản đồ sẽ
//     khác nhau. Đưa nó xuống CSDL rồi cho cả hai bên gọi chung.
//
//  4. Trả một khoản nợ nhỏ của Task 4: `EXECUTE` trên `fn_audit_new_partition`
//     mặc định cấp cho `PUBLIC`. Thu về.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE backups DROP CONSTRAINT backups_kind_check;
    ALTER TABLE backups ADD CONSTRAINT backups_kind_check
      CHECK (kind IN ('full','incremental','wal','audit'));

    -- Quy trình khôi phục hỏi đúng một câu: "bản sao lưu 'full' gần nhất còn
    -- tốt của cộng đồng này là cái nào". Chỉ mục cho đúng câu đó.
    CREATE INDEX idx_backups_recent ON backups (community_id, kind, started_at DESC);
  `);

  await knex.raw(`
    CREATE FUNCTION fn_ops_record_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      RAISE EXCEPTION 'OPS_RECORD_APPEND_ONLY'
        USING DETAIL = format(
          '%s ghi lại một việc đã xảy ra: ghi được, không sửa được, không xoá được',
          TG_TABLE_NAME);
    END $fn$;

    CREATE TRIGGER trg_backups_frozen
      BEFORE UPDATE OR DELETE ON backups
      FOR EACH ROW EXECUTE FUNCTION fn_ops_record_frozen();

    CREATE TRIGGER trg_restore_tests_frozen
      BEFORE UPDATE OR DELETE ON restore_tests
      FOR EACH ROW EXECUTE FUNCTION fn_ops_record_frozen();
  `);

  await knex.raw(`
    -- Thân hàm là ĐÚNG câu SQL mà core/audit.js đang chạy, không phải một bản
    -- viết lại. Hai chi tiết của bản gốc được giữ nguyên vì cả hai đều là bản
    -- vá của một lỗi đã gặp thật:
    --
    --   * TOÀN BỘ việc so khớp — kể cả đọc lại 'at' để đưa vào digest() — nằm
    --     trong MỘT câu SQL, trên chính giá trị 'at' còn trong hàng đã lưu.
    --     Đưa 'at' vòng qua JavaScript thì driver pg cắt mất micro-giây và
    --     chuỗi lành cũng báo gãy (xem chú thích dài ở core/audit.js).
    --   * 'checked' đếm số dòng đã qua TRƯỚC dòng gãy đầu tiên, không phải tổng
    --     số dòng: nó trả lời "chuỗi lành tới đâu".
    CREATE TYPE audit_chain_result AS (ok boolean, checked bigint, broken_at bigint);

    CREATE FUNCTION fn_audit_verify_chain(p_community uuid, p_from timestamptz DEFAULT NULL,
                                          p_to timestamptz DEFAULT NULL)
    RETURNS audit_chain_result
    LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
    DECLARE r RECORD; v_out audit_chain_result;
    BEGIN
      v_out.ok := true; v_out.checked := 0; v_out.broken_at := NULL;
      FOR r IN
        WITH ordered AS (
          SELECT seq, actor_id, action, target_type, target_id, at, prev_hash, hash,
                 lag(hash) OVER (ORDER BY seq) AS expected_prev,
                 row_number() OVER (ORDER BY seq) AS rn
            FROM audit_log
           WHERE community_id = p_community
             AND (p_from IS NULL OR at >= p_from)
             AND (p_to   IS NULL OR at <= p_to)
        )
        SELECT seq,
               (rn = 1 OR prev_hash = expected_prev) AS prev_ok,
               (hash = encode(digest(
                   prev_hash || '|' || coalesce(actor_id::text, '-') || '|' || action || '|' ||
                   coalesce(target_type, '-') || '|' || coalesce(target_id::text, '-') || '|' ||
                   to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex')) AS hash_ok
          FROM ordered
         ORDER BY seq
      LOOP
        IF NOT r.prev_ok OR NOT r.hash_ok THEN
          v_out.ok := false; v_out.broken_at := r.seq;
          RETURN v_out;
        END IF;
        v_out.checked := v_out.checked + 1;
      END LOOP;
      RETURN v_out;
    END $fn$;
  `);

  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_audit_verify_chain(uuid, timestamptz, timestamptz) TO ??`, [user]);

  // Nợ Task 4 (đã ghi trong progress.md): EXECUTE trên fn_audit_new_partition
  // mặc định cấp cho PUBLIC. Thu về. Hàm này tạo bảng nên chỉ chủ sở hữu chạy
  // nổi (app_role không có CREATE trên schema), nhưng để `PUBLIC` giữ quyền gọi
  // một hàm mà nó chắc chắn thất bại là để lại một dòng khó hiểu trong nhật ký
  // lỗi và một chỗ dò kiểu "hàm này có tồn tại không".
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_audit_new_partition(date) FROM PUBLIC`);
}

export async function down(knex) {
  await knex.raw(`
    GRANT EXECUTE ON FUNCTION fn_audit_new_partition(date) TO PUBLIC;
    DROP FUNCTION IF EXISTS fn_audit_verify_chain(uuid, timestamptz, timestamptz);
    DROP TYPE IF EXISTS audit_chain_result;
    DROP TRIGGER IF EXISTS trg_restore_tests_frozen ON restore_tests;
    DROP TRIGGER IF EXISTS trg_backups_frozen ON backups;
    DROP FUNCTION IF EXISTS fn_ops_record_frozen();
    DROP INDEX IF EXISTS idx_backups_recent;
    ALTER TABLE backups DROP CONSTRAINT backups_kind_check;
    ALTER TABLE backups ADD CONSTRAINT backups_kind_check
      CHECK (kind IN ('full','incremental','wal'));
  `);
}
