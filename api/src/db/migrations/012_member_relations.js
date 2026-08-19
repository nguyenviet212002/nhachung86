// member_relations — bảng quan hệ mà ỨNG DỤNG KHÔNG ĐƯỢC PHÉP GHI, cộng với
// trigger khởi tạo hồ sơ (spec mục 4.1 và 4.7).
//
// Nguồn sự thật của quan hệ bảo lãnh là members.referrer_id.
// member_relations(kind='guarantee') là BẢN DẪN XUẤT, sinh tự động bởi trigger.
// Hai chỗ ghi được thì sẽ có ngày lệch, và lúc đó không ai biết chỗ nào đúng —
// nên chỉ có một chỗ ghi, và nó không phải tầng ứng dụng.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE member_relations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      kind text NOT NULL CHECK (kind IN ('guarantee','worked_together')),
      member_a uuid NOT NULL,
      member_b uuid NOT NULL,
      first_work_record_id uuid,
      established_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rel_not_self  CHECK (member_a <> member_b),
      -- 'guarantee' là cạnh CÓ HƯỚNG (a bảo lãnh b) nên không chuẩn tắc hoá
      -- được; 'worked_together' vô hướng nên ép a < b để (A,B) và (B,A) không
      -- thành hai hàng khác nhau của cùng một sự việc.
      CONSTRAINT rel_canonical CHECK (kind <> 'worked_together' OR member_a < member_b),
      CONSTRAINT rel_unique    UNIQUE (community_id, kind, member_a, member_b),
      -- Lệch có chủ đích khỏi spec (spec viết REFERENCES members(id) đơn cột):
      -- với khóa ngoại đơn cột, một cạnh của cộng đồng B nối được hai người của
      -- cộng đồng A — và bảng này là thứ mà GET /members/me/relations sẽ đọc để
      -- vẽ sợi bảo lãnh. Cùng họ lỗi với Ruling T7-a và T8-d, chỉ khác bảng.
      CONSTRAINT rel_a_same_community
        FOREIGN KEY (member_a, community_id) REFERENCES members (id, community_id),
      CONSTRAINT rel_b_same_community
        FOREIGN KEY (member_b, community_id) REFERENCES members (id, community_id),
      CONSTRAINT rel_work_same_community
        FOREIGN KEY (first_work_record_id, community_id) REFERENCES work_records (id, community_id)
    );

    -- guarantee là cạnh CÓ HƯỚNG, nhưng không thể tồn tại cả (A→B) lẫn (B→A).
    CREATE UNIQUE INDEX rel_guarantee_one_direction ON member_relations
      (community_id, LEAST(member_a, member_b), GREATEST(member_a, member_b))
      WHERE kind = 'guarantee';

    CREATE INDEX idx_rel_member_b ON member_relations (member_b, kind);
  `);

  // Cạnh CHỈ do trigger sinh. Nếu app_role ghi được thì "quan hệ" trở thành
  // thứ ứng dụng khai, không phải thứ đã xảy ra.
  await knex.raw(`REVOKE INSERT, UPDATE, DELETE ON member_relations FROM ??`, [user]);
  await knex.raw(`GRANT SELECT ON member_relations TO ??`, [user]);

  // ---------------------------------------------------------------------------
  // fn_member_bootstrap — spec mục 4.7.
  //
  // member_relations và member_contacts đều nằm NGOÀI tầm với của app_role, nên
  // luồng duyệt gia nhập KHÔNG được tự ghi vào hai bảng đó. Service chỉ tạo hàng
  // members; hộp liên hệ rỗng, 8 mức riêng tư mặc định và cạnh guarantee là việc
  // của trigger SECURITY DEFINER này.
  //
  // Ruling C6 — coalesce sang MẢNG MẶC ĐỊNH AN TOÀN: communities.config mặc
  // định là '{}' (migration 003), nên một cộng đồng tạo thiếu khóa
  // privacy_defaults sẽ làm jsonb_to_recordset nhận NULL và sinh 0 hàng riêng
  // tư. Khi đó contact_read đọc mức NULL → coalesce thành 'closed', tức hồ sơ
  // ĐÓNG chứ không mở; nhưng màn "quyền riêng tư của tôi" sẽ trống trơn và
  // người dùng không có gì để chỉnh. Mặc định dự phòng phải là mặc định của
  // spec dòng 852: phone/zalo = on_consent, address/family = closed, còn lại
  // public.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_member_bootstrap() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    BEGIN
      -- 1. Hộp liên hệ rỗng (app_role không tạo nổi vì bị REVOKE ALL ở 005)
      INSERT INTO member_contacts (member_id, community_id) VALUES (NEW.id, NEW.community_id)
        ON CONFLICT (member_id) DO NOTHING;

      -- 2. Tám mức riêng tư mặc định, đọc từ communities.config
      INSERT INTO privacy_settings (member_id, community_id, field_key, level)
      SELECT NEW.id, NEW.community_id, k.field_key, k.level
        FROM jsonb_to_recordset(
               coalesce(
                 (SELECT config->'privacy_defaults' FROM communities WHERE id = NEW.community_id),
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

      -- 3. Cạnh bảo lãnh — DẪN XUẤT từ referrer_id, không phải do service ghi
      IF NEW.referrer_id IS NOT NULL THEN
        INSERT INTO member_relations (community_id, kind, member_a, member_b)
        VALUES (NEW.community_id, 'guarantee', NEW.referrer_id, NEW.id)
          ON CONFLICT (community_id, kind, member_a, member_b) DO NOTHING;
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_member_bootstrap AFTER INSERT ON members
      FOR EACH ROW EXECUTE FUNCTION fn_member_bootstrap();
  `);

  // ---------------------------------------------------------------------------
  // contact_upsert — spec mục 4.7. Cửa GHI duy nhất vào member_contacts, đối
  // xứng với contact_read (cửa ĐỌC duy nhất, migration 006).
  //
  // Approver KHÔNG sửa được số điện thoại đã có — chỉ điền được ô còn TRỐNG,
  // đúng một lần, và lần đó có dấu vết. Đó là toàn bộ khác biệt giữa "ban duyệt
  // giúp người mới điền hồ sơ" và "ban duyệt sửa được liên hệ của bất kỳ ai".
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION contact_upsert(p_target uuid, p_field text, p_value text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_cur text; v_is_approver boolean; v_cid uuid;
    BEGIN
      IF v_actor IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      -- Danh sách trắng kiểm TRƯỚC khi p_field chạm format('%I') — cùng luật
      -- với contact_read, đây là chỗ duy nhất nối tên cột động vào SQL.
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;

      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

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
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS contact_upsert(uuid, text, text);
    DROP TRIGGER IF EXISTS trg_member_bootstrap ON members;
    DROP FUNCTION IF EXISTS fn_member_bootstrap();
    DROP TABLE IF EXISTS member_relations;
  `);
}
