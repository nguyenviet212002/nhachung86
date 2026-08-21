// Người dùng đã bỏ bước người bảo lãnh xác nhận gặp mặt. Link mời vẫn xác định
// referrer và tiêu hạn mức bảo lãnh; quyền kết nạp chuyển hoàn toàn cho approver.
// Migration mới sửa các hàm đang tồn tại thay vì viết lại migration lịch sử.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE OR REPLACE FUNCTION join_secret_consume(p_request uuid) RETURNS join_secret
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cid uuid; v_status text; v_out join_secret;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;

      SELECT community_id, status INTO v_cid, v_status
        FROM join_requests WHERE id = p_request;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      IF NOT EXISTS (
        SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.member_id = v_actor AND mr.community_id = v_cid AND r.key = 'approver'
      ) THEN
        RAISE EXCEPTION 'JOIN_SECRET_DENIED'
          USING DETAIL = 'chỉ ban duyệt của chính cộng đồng này đọc được dữ liệu đăng ký';
      END IF;

      -- Đơn vừa lập từ link mời đã ở pending và có thể được duyệt trực tiếp.
      -- met_confirmed vẫn được nhận để dữ liệu cũ đang ở trạng thái đó không mắc kẹt.
      IF v_status NOT IN ('pending', 'met_confirmed') THEN
        RAISE EXCEPTION 'JOIN_SECRET_DENIED'
          USING DETAIL = 'đơn không ở trạng thái có thể duyệt';
      END IF;

      DELETE FROM join_request_secrets WHERE join_request_id = p_request
        RETURNING phone, password_hash INTO v_out.phone, v_out.password_hash;
      IF v_out.password_hash IS NULL THEN
        RAISE EXCEPTION 'JOIN_SECRET_MISSING'
          USING DETAIL = 'đơn không có dữ liệu đăng ký kèm theo';
      END IF;

      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'join_request.secret_consumed', 'join_request', p_request,
              jsonb_build_object('fields', jsonb_build_array('phone', 'password_hash')));
      RETURN v_out;
    END $fn$;

    CREATE OR REPLACE FUNCTION fn_member_status_gate() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.status = 'member' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'member') THEN
        -- Người gốc không có referrer vẫn là trường hợp bootstrap. Mọi người
        -- còn lại phải có chính đơn đã được approver duyệt và nối tới mình.
        IF NEW.referrer_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM join_requests
           WHERE member_id = NEW.id
             AND community_id = NEW.community_id
             AND referrer_id = NEW.referrer_id
             AND status = 'approved'
        ) THEN
          RAISE EXCEPTION 'MEMBER_NEEDS_APPROVED_JOIN_REQUEST'
            USING DETAIL = 'chưa có đơn gia nhập đã được ban duyệt phê duyệt';
        END IF;
      END IF;
      RETURN NEW;
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO ??`, [user]);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    CREATE OR REPLACE FUNCTION join_secret_consume(p_request uuid) RETURNS join_secret
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cid uuid; v_status text; v_out join_secret;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      SELECT community_id, status INTO v_cid, v_status FROM join_requests WHERE id = p_request;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.member_id = v_actor AND mr.community_id = v_cid AND r.key = 'approver'
      ) THEN RAISE EXCEPTION 'JOIN_SECRET_DENIED'; END IF;
      IF v_status <> 'met_confirmed' THEN RAISE EXCEPTION 'JOIN_SECRET_DENIED'; END IF;
      DELETE FROM join_request_secrets WHERE join_request_id = p_request
        RETURNING phone, password_hash INTO v_out.phone, v_out.password_hash;
      IF v_out.password_hash IS NULL THEN RAISE EXCEPTION 'JOIN_SECRET_MISSING'; END IF;
      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'join_request.secret_consumed', 'join_request', p_request,
              jsonb_build_object('fields', jsonb_build_array('phone', 'password_hash')));
      RETURN v_out;
    END $fn$;

    CREATE OR REPLACE FUNCTION fn_member_status_gate() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.status = 'member' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'member') THEN
        IF NEW.referrer_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM join_requests
           WHERE member_id = NEW.id AND community_id = NEW.community_id
             AND met_confirmed_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'MEMBER_NEEDS_MET_CONFIRMATION'
            USING DETAIL = 'chưa có xác nhận đã gặp mặt';
        END IF;
      END IF;
      RETURN NEW;
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO ??`, [user]);
}
