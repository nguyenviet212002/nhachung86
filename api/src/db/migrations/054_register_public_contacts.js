// Đăng ký bắt buộc điền thêm Zalo + Messenger (trước đây chỉ bắt buộc số điện
// thoại), và ba kênh liên hệ đó (phone/zalo/messenger) được công khai NGAY lúc
// đơn được duyệt — người xem hồ sơ bấm là liên kết thẳng, không cần xin phép.
//
// CỐ Ý KHÔNG đụng communities.config.privacy_defaults: từ migration 028,
// trg_community_config_guard chặn MỌI câu UPDATE lên communities — kể cả chạy
// bằng kết nối chủ sở hữu — bắt đổi chính sách phải qua khung hai người ký
// (xem docs/RANG-BUOC.md mục "Lớp 2"). Đổi mặc định của CẢ cộng đồng qua migration
// là đúng thứ hàng rào đó dựng ra để chặn. Thay vào đó, hàm mới
// contact_publish_on_join() chỉ set 'public' cho ĐÚNG một hàng privacy_settings
// của member vừa được approve() tạo ra trong CÙNG giao dịch — dữ liệu người đó
// tự nguyện gõ vào form đăng ký, tự nguyện đồng ý điều khoản "công khai liên hệ"
// trước khi bấm gửi. Không có hàng của ai khác bị đụng tới, không có chính sách
// cộng đồng nào bị đổi.
//
// join_secret_consume() (migration 009a) đang chỉ mang phone/password_hash —
// mở rộng type + hàm để mang thêm zalo/messenger, cùng khuôn với phone: chỉ
// tồn tại từ lúc nộp đơn tới lúc duyệt, rồi bị XOÁ khỏi join_request_secrets
// (không giữ thêm bản sao thô nào ngoài mục đích).
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    ALTER TABLE join_request_secrets ADD COLUMN zalo text;
    ALTER TABLE join_request_secrets ADD COLUMN messenger text;

    ALTER TYPE join_secret ADD ATTRIBUTE zalo text;
    ALTER TYPE join_secret ADD ATTRIBUTE messenger text;
  `);

  // CREATE OR REPLACE giữ nguyên toàn bộ luật cũ (approver đúng cộng đồng, đơn
  // đang 'met_confirmed', audit_log cùng giao dịch) — chỉ thêm hai cột vào
  // RETURNING/INTO và vào danh sách trường ghi nhật ký.
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

      IF v_status <> 'met_confirmed' THEN
        RAISE EXCEPTION 'JOIN_SECRET_DENIED'
          USING DETAIL = 'đơn không ở trạng thái chờ duyệt';
      END IF;

      DELETE FROM join_request_secrets WHERE join_request_id = p_request
        RETURNING phone, password_hash, zalo, messenger
        INTO v_out.phone, v_out.password_hash, v_out.zalo, v_out.messenger;
      IF v_out.password_hash IS NULL THEN
        RAISE EXCEPTION 'JOIN_SECRET_MISSING'
          USING DETAIL = 'đơn không có dữ liệu đăng ký kèm theo';
      END IF;

      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'join_request.secret_consumed', 'join_request', p_request,
              jsonb_build_object('fields', jsonb_build_array('phone', 'password_hash', 'zalo', 'messenger')));

      RETURN v_out;
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO ??`, [user]);

  // ---------------------------------------------------------------------------
  // contact_publish_on_join — công khai một kênh liên hệ của MỘT member cụ thể,
  // ĐÚNG lúc member đó vừa được approve() tạo ra trong cùng giao dịch. Khác
  // contact_upsert (ghi GIÁ TRỊ) ở chỗ hàm này chỉ đổi MỨC RIÊNG TƯ
  // (privacy_settings.level), và khác trg_community_config_guard ở chỗ không
  // đụng communities.config — chỉ một hàng privacy_settings của đúng người đó.
  //
  // Cùng khung tin cậy với contact_upsert: approver CỦA CHÍNH CỘNG ĐỒNG đó là
  // đủ điều kiện gọi. Không RAISE khi hàng chưa tồn tại (UPDATE 0 dòng) —
  // fn_member_bootstrap() luôn tạo đủ 8 hàng privacy_settings ngay khi INSERT
  // members (cùng giao dịch, chạy trước lệnh gọi này trong approve()), nên
  // trường hợp "chưa có hàng" không xảy ra trên đường đi hợp lệ; nếu p_field
  // sai chính tả thì UPDATE khớp 0 hàng và không có gì đổi — an toàn hơn RAISE
  // giữa một giao dịch approve() đang làm nhiều việc khác.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION contact_publish_on_join(p_target uuid, p_field text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cid uuid; v_is_approver boolean;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      IF p_field NOT IN ('phone','zalo','messenger') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;

      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = v_actor AND mr.community_id = v_cid
                        AND r.key = 'approver') INTO v_is_approver;
      IF NOT v_is_approver THEN RAISE EXCEPTION 'CONTACT_WRITE_DENIED'; END IF;

      UPDATE privacy_settings SET level = 'public', updated_at = now()
       WHERE member_id = p_target AND field_key = p_field;

      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'privacy.published_on_join', 'member', p_target,
              jsonb_build_object('field', p_field));
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_publish_on_join(uuid, text) TO ??`, [user]);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    DROP FUNCTION IF EXISTS contact_publish_on_join(uuid, text);

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

      IF v_status <> 'met_confirmed' THEN
        RAISE EXCEPTION 'JOIN_SECRET_DENIED'
          USING DETAIL = 'đơn không ở trạng thái chờ duyệt';
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
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO ??`, [user]);

  await knex.raw(`
    ALTER TYPE join_secret DROP ATTRIBUTE zalo;
    ALTER TYPE join_secret DROP ATTRIBUTE messenger;
    ALTER TABLE join_request_secrets DROP COLUMN zalo;
    ALTER TABLE join_request_secrets DROP COLUMN messenger;
  `);
}
