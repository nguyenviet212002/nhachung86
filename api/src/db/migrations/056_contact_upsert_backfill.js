// contact_upsert() (migration 012) chỉ UPDATE, không INSERT — tên hàm hứa
// "upsert" nhưng thân hàm không có nửa "insert" nào. fn_member_bootstrap()
// (cũng migration 012) tạo hàng member_contacts rỗng NGAY LÚC INSERT một
// member mới, nên tác giả migration 012 coi "hàng member_contacts của người
// đang ghi luôn có sẵn" là bất biến — xem chú thích ở contact_publish_on_join
// (migration 054): "trường hợp 'chưa có hàng' không xảy ra trên đường đi hợp
// lệ". Đúng cho MỌI member dựng SAU migration 012. Sai cho member dựng TRƯỚC
// nó: trigger chỉ bắt INSERT về sau, không hồi tố cho hàng đã có sẵn trong
// bảng members từ trước khi trigger tồn tại.
//
// Hậu quả: PATCH /members/me của một member "cũ" gửi phone/zalo/messenger/
// address — máy chủ trả 200, UPDATE bên trong contact_upsert khớp 0 dòng vì
// chưa từng có hàng để sửa, giá trị biến mất, không một dòng lỗi nào. Bấm
// "Lưu" ở "Sửa hồ sơ" bao nhiêu lần cũng vậy: trông như máy chủ nhận rồi lại
// không giữ. Tái hiện được bằng PATCH /members/me thật trên tài khoản thành
// viên đầu tiên của cộng đồng (dựng trước khi migration 012 tồn tại): full_
// name/job/bio lưu đúng (đi thẳng qua UPDATE members), còn phone/zalo/address
// đọc lại vẫn null.
//
// HAI PHẦN VÁ — vá tại nguồn (Phần 1) rồi mới sửa dữ liệu đã hỏng (Phần 2),
// không phải một mình Phần 2: chỉ backfill mà không sửa hàm thì member dựng
// bằng trigger hỏng ở một task tương lai (hoặc bất kỳ hàng nào bị xoá nhầm
// sau này) lại rơi vào đúng lỗi này lần nữa, im lặng y hệt.
//
//   1. contact_upsert() INSERT ... ON CONFLICT DO NOTHING trước khi UPDATE —
//      hàng thiếu ở BẤT KỲ member nào, biết trước hay chưa, tự lành ở đúng
//      lần ghi kế tiếp.
//   2. Backfill một lần cho member đã tồn tại: hai bảng member_contacts/
//      privacy_settings, COPY NGUYÊN VĂN mặc định của fn_member_bootstrap()
//      (migration 012) — không bịa luật riêng tư mới ở đây.
//
// KHÔNG đụng member_relations (cạnh bảo lãnh): đó là dữ liệu suy từ
// referrer_id, không liên quan gì tới việc "Sửa hồ sơ" mất dữ liệu liên hệ,
// và dựng lại cạnh cho toàn bộ member cũ là một việc khác, ngoài phạm vi lỗi
// này.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE OR REPLACE FUNCTION contact_upsert(p_target uuid, p_field text, p_value text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cur text; v_is_approver boolean; v_cid uuid;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;

      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      -- KHÁC migration 012: đảm bảo hàng tồn tại trước khi đọc/ghi nó. Member
      -- dựng trước migration 012 không có hàng này (fn_member_bootstrap chỉ
      -- chạy cho INSERT về sau) — ON CONFLICT DO NOTHING giữ nguyên hàng nếu
      -- đã có, nên câu SELECT ... INTO v_cur ngay sau vẫn đọc đúng giá trị
      -- TRƯỚC lần ghi này (hàng mới chỉ có member_id/community_id, p_field
      -- của nó là NULL — đúng "ô còn trống" mà nhánh approver bên dưới cần).
      INSERT INTO member_contacts (member_id, community_id) VALUES (p_target, v_cid)
        ON CONFLICT (member_id) DO NOTHING;

      EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
        INTO v_cur USING p_target;

      -- Lệch có chủ đích khỏi spec: vai approver phải là vai TRONG CHÍNH CỘNG
      -- ĐỒNG của người được sửa. Spec không lọc community_id ở câu này, nghĩa là
      -- approver của cộng đồng B điền được ô liên hệ trống của người thuộc cộng
      -- đồng A. Cùng họ lỗi với Ruling T7-a/T8-d.
      SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = v_actor AND mr.community_id = v_cid
                        AND r.key = 'approver') INTO v_is_approver;

      -- chính chủ sửa bất cứ lúc nào; approver CHỈ được điền lần đầu, khi ô còn trống
      IF NOT (v_actor = p_target OR (v_is_approver AND v_cur IS NULL)) THEN
        RAISE EXCEPTION 'CONTACT_WRITE_DENIED';
      END IF;

      EXECUTE format('UPDATE member_contacts SET %I = $1, updated_at = now() WHERE member_id = $2', p_field)
        USING p_value, p_target;

      -- detail chỉ có tên trường và một cờ boolean — không bao giờ giá trị.
      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'contact.written', 'member', p_target,
              jsonb_build_object('field', p_field, 'first_fill', v_cur IS NULL));
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_upsert(uuid, text, text) TO ??`, [user]);

  // Backfill — cùng mặc định với fn_member_bootstrap() (migration 012), copy
  // nguyên văn khối jsonb mặc định của nó, không bịa luật mới ở đây.
  await knex.raw(`
    INSERT INTO member_contacts (member_id, community_id)
    SELECT m.id, m.community_id FROM members m
    ON CONFLICT (member_id) DO NOTHING;

    INSERT INTO privacy_settings (member_id, community_id, field_key, level)
    SELECT m.id, m.community_id, k.field_key, k.level
      FROM members m
      CROSS JOIN LATERAL jsonb_to_recordset(
             coalesce(
               (SELECT c.config->'privacy_defaults' FROM communities c WHERE c.id = m.community_id),
               '[{"field_key":"phone","level":"on_consent"},
                 {"field_key":"zalo","level":"on_consent"},
                 {"field_key":"messenger","level":"public"},
                 {"field_key":"address","level":"closed"},
                 {"field_key":"job","level":"public"},
                 {"field_key":"area","level":"public"},
                 {"field_key":"price","level":"public"},
                 {"field_key":"family","level":"closed"}]'::jsonb)
           ) AS k(field_key text, level text)
    ON CONFLICT (member_id, field_key) DO NOTHING;
  `);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  // Backfill của Phần 2 không hồi lại: xoá hàng liên hệ/mức riêng tư mà một
  // member đang chạy thật đã lỡ dùng là mất dữ liệu, không phải rollback.
  // down() chỉ trả contact_upsert() về đúng bản UPDATE thuần của migration 012.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION contact_upsert(p_target uuid, p_field text, p_value text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cur text; v_is_approver boolean; v_cid uuid;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;

      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
        INTO v_cur USING p_target;

      SELECT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = v_actor AND mr.community_id = v_cid
                        AND r.key = 'approver') INTO v_is_approver;

      IF NOT (v_actor = p_target OR (v_is_approver AND v_cur IS NULL)) THEN
        RAISE EXCEPTION 'CONTACT_WRITE_DENIED';
      END IF;

      EXECUTE format('UPDATE member_contacts SET %I = $1, updated_at = now() WHERE member_id = $2', p_field)
        USING p_value, p_target;

      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_actor, 'contact.written', 'member', p_target,
              jsonb_build_object('field', p_field, 'first_fill', v_cur IS NULL));
    END $fn$;
  `);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_upsert(uuid, text, text) TO ??`, [user]);
}
