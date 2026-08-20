// Khung hai người ký — ba chỗ hở CỐ Ý CHƯA VÁ của `docs/RANG-BUOC.md` mục 7,
// nay vá được vì Task 14 dựng endpoint cho khung ấy.
//
// ===========================================================================
// #22 — `communities.config` LÀ ĐÒN BẨY DÀI NHẤT TRONG HỆ THỐNG, và cho tới
// migration này KHÔNG AI CANH NÓ.
//
// Đã tái hiện bằng chạy thật (mục 5.4 của RANG-BUOC.md): một câu
// `UPDATE communities SET config->'fund_two_approver_threshold'` rồi ghi bút
// toán **chi 50 triệu đồng mà không một chữ ký nào**. Cùng cột đó còn chứa
// `guarantee_quota_per_year`, `manual_pair_quota`, `privacy_defaults` — nghĩa
// là ai sửa được nó thì **vô hiệu hoá được cả loạt ràng buộc mà không chạm vào
// ràng buộc nào**. Mọi trigger hạn mức đều đi hỏi cột này; không trigger nào
// hỏi ngược lại "ai được sửa cột này".
//
// BẢN VÁ CÓ HAI LỚP, và hai lớp đó KHÔNG thừa nhau:
//
//   Lớp 1 — `REVOKE INSERT, UPDATE, DELETE ON communities`. Đóng đường của
//     `app_role`, tức mọi request HTTP. Nhưng Ruling T10-a đã trả giá để học
//     rằng `REVOKE` **không đỡ được hàm `SECURITY DEFINER`** (hàm chạy bằng
//     quyền chủ bảng), nên một mình nó không đủ.
//
//   Lớp 2 — `trg_community_config_guard`, một trigger **vô điều kiện** trên
//     chính `communities`. Nó KHÔNG dùng `fn_acting_member()`: hàm đó cố ý trả
//     `NULL` cho đường chủ bảng, mà đường chủ bảng chính là đường một hàm
//     `SECURITY DEFINER` viết ẩu sẽ đi. Trigger này chặn CẢ owner, CẢ `psql`,
//     CẢ hàm `SECURITY DEFINER` — kể cả hàm `fn_community_config_apply` ngay
//     dưới đây. Cửa duy nhất còn lại là: có một `pending_actions` đang chờ,
//     `action_key='community.config_change'`, chưa quá hạn, đủ hai chữ ký hợp
//     lệ, VÀ `payload->'config'` **bằng đúng** giá trị đang được ghi vào.
//
// Vì sao so `payload->'config'` là TOÀN BỘ config mới chứ không phải một danh
// sách khoá đổi: (a) hai người ký nhìn thấy đúng thứ sẽ được ghi, không phải
// một phép cộng họ phải tự tính trong đầu; (b) danh sách khoá "được canh" là
// một danh sách CẤM, và mọi danh sách cấm trong dự án này đều đã hụt ít nhất
// một lần — khoá mới thêm vào `config` ở giai đoạn sau sẽ tự động được canh
// thay vì tự động lọt.
//
// ===========================================================================
// #20 — tự cấp `guarantee_quota_overrides` cho chính mình. Đã tái hiện: Alice
// tự cấp 3 suất cho Alice với `granted_by = Alice`. Đặc tả mục 4.3 nói nới hạn
// mức phải qua khung hai người ký; không đối tượng SQL nào buộc điều đó.
//
// ===========================================================================
// #24 — ẢNH CHỤP VAI TẠI THỜI ĐIỂM KÝ. Chưa khai thác được hôm nay
// (`member_roles` chỉ có `SELECT`), nhưng migration 008 đã hẹn sẽ có hàm gán
// vai và lượt này viết nó. Nếu không vá trước, gỡ vai `approver` khỏi một
// người **đã ký** sẽ làm bút toán quỹ / hành động vận hành đã `COMMIT` mất
// hiệu lực chữ ký mà không trigger nào chạy.
//
// Ghi nguyên văn để đừng ai gỡ:
//
//     CHỮ KÝ LÀ SỰ VIỆC Ở MỘT THỜI ĐIỂM; ĐẾM NÓ BẰNG TRẠNG THÁI HIỆN TẠI LÀ
//     TRỘN HAI TRỤC THỜI GIAN.
//
// Nên `role_at_sign` được ghi vào CHÍNH HÀNG CHỮ KÝ, do trigger ghi (không
// phải do ứng dụng gửi lên — ứng dụng gửi gì cũng bị ghi đè), và ba hàm đếm
// đếm theo cột đó thay vì `JOIN member_roles`.
// ===========================================================================
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  // -------------------------------------------------------------------------
  // 1. `action_key` mới: `community.config_change`.
  // -------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE pending_actions DROP CONSTRAINT pending_actions_action_key_check;
    ALTER TABLE pending_actions ADD CONSTRAINT pending_actions_action_key_check
      CHECK (action_key IN (
        'data.delete', 'contacts.export', 'backup.restore',
        'member.terminate', 'guarantee.quota_override', 'community.config_change'));

    -- Bảng mục 7.5 vẫn là MỘT bản đồ dùng chung cho trigger và service.
    CREATE OR REPLACE FUNCTION fn_pending_action_role(p_action_key text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $fn$
      SELECT CASE p_action_key
               WHEN 'data.delete'              THEN 'approver'
               WHEN 'contacts.export'          THEN 'tech'
               WHEN 'backup.restore'           THEN 'tech'
               WHEN 'member.terminate'         THEN 'approver'
               WHEN 'guarantee.quota_override' THEN 'approver'
               -- Đổi chính sách của cộng đồng là quyết định về LUẬT, cùng loại
               -- với chấm dứt tư cách chứ không phải việc kỹ thuật: approver.
               WHEN 'community.config_change'  THEN 'approver'
             END;
    $fn$;
  `);

  // -------------------------------------------------------------------------
  // 2. #24 — `role_at_sign` trên cả ba bảng chữ ký.
  // -------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE pending_action_signatures ADD COLUMN role_at_sign text;
    ALTER TABLE fund_entry_approvals      ADD COLUMN role_at_sign text;
    ALTER TABLE endorsement_signatures    ADD COLUMN role_at_sign text;
  `);

  // Lấp cho hàng đã có: chỉ ghi vai khi người ký THẬT SỰ đang mang vai đó —
  // lấp bừa 'approver' cho mọi hàng cũ sẽ hợp thức hoá đúng những chữ ký mà
  // hàm đếm hôm nay đang loại ra.
  await knex.raw(`
    UPDATE fund_entry_approvals a SET role_at_sign = 'approver'
     WHERE a.role_at_sign IS NULL
       AND EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                    WHERE mr.member_id = a.approver_id
                      AND mr.community_id = a.community_id AND r.key = 'approver');

    UPDATE pending_action_signatures s SET role_at_sign = fn_pending_action_role(a.action_key)
      FROM pending_actions a
     WHERE a.id = s.pending_action_id AND s.role_at_sign IS NULL
       AND EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                    WHERE mr.member_id = s.signer_id
                      AND mr.community_id = s.community_id
                      AND r.key = fn_pending_action_role(a.action_key));

    UPDATE endorsement_signatures s SET role_at_sign = 'approver'
     WHERE s.role_at_sign IS NULL
       AND EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                    WHERE mr.member_id = s.signer_id
                      AND mr.community_id = s.community_id AND r.key = 'approver');
  `);

  // 2a. Quỹ — ghi ảnh chụp vai, KHÔNG ném lỗi.
  //
  // Cố ý không ném: `fn_fund_valid_signatures` từ trước tới nay vẫn cho phép
  // ghi một hàng chữ ký của người không mang vai (nó chỉ không ĐẾM hàng đó),
  // và `t13-fund` dựa vào đúng hành vi ấy để chứng minh ngưỡng hai chữ ký có
  // thật. Đổi sang ném ở đây sẽ làm những bài đó đỏ vì một lý do KHÁC với lý
  // do chúng kiểm — đúng thứ Ruling T8-a cấm. Ảnh chụp vai là việc GHI LẠI
  // một sự việc, không phải một cánh cổng mới.
  await knex.raw(`
    CREATE FUNCTION fn_fund_sig_role_snapshot() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      -- Gán ĐÈ, không đọc giá trị ứng dụng gửi lên: nếu tin vào cột do client
      -- điền thì ảnh chụp vai chỉ là một ô tự khai, đúng "câu hỏi 4" của
      -- docs/RANG-BUOC.md (ràng buộc đúng hình thức, rỗng mục đích).
      NEW.role_at_sign := (
        SELECT r.key FROM member_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.member_id = NEW.approver_id
           AND mr.community_id = NEW.community_id
           AND r.key = 'approver'
         LIMIT 1);
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_fund_sig_role_snapshot
      BEFORE INSERT OR UPDATE ON fund_entry_approvals
      FOR EACH ROW EXECUTE FUNCTION fn_fund_sig_role_snapshot();
  `);

  // 2b. Hàm đếm của quỹ nay đọc ảnh chụp, KHÔNG `JOIN member_roles`.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_fund_valid_signatures(p_entry uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT a.approver_id)::int
        FROM fund_entry_approvals a
        JOIN fund_entries e ON e.id = a.entry_id
       WHERE a.entry_id = p_entry
         AND a.community_id = e.community_id
         AND a.approver_id <> e.created_by          -- không tự ký
         AND a.role_at_sign = 'approver';           -- vai LÚC KÝ, không phải vai hôm nay
    $fn$;
  `);

  // 2c. Hành động vận hành — `fn_pending_signature_valid` đã kiểm vai rồi, nên
  //     ở đây chỉ cần ghi lại kết quả của chính lần kiểm ấy.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_pending_signature_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_action text; v_target_type text; v_target uuid; v_cid uuid; v_role text;
    BEGIN
      SELECT action_key, target_type, target_id, community_id
        INTO v_action, v_target_type, v_target, v_cid
        FROM pending_actions WHERE id = NEW.pending_action_id;
      IF v_action IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;

      IF v_target_type = 'member' AND v_target = NEW.signer_id THEN
        RAISE EXCEPTION 'SIGNER_IS_TARGET'
          USING DETAIL = 'không ai ký cho một hành động nhắm vào chính mình';
      END IF;

      v_role := fn_pending_action_role(v_action);
      IF NOT EXISTS (SELECT 1 FROM member_roles mr
                       JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = NEW.signer_id
                        AND mr.community_id = v_cid
                        AND r.key = v_role) THEN
        RAISE EXCEPTION 'SIGNER_ROLE_REQUIRED'
          USING DETAIL = format('hành động này cần người ký mang vai %s', v_role);
      END IF;

      -- #24: đóng dấu vai NGAY TẠI ĐÂY. Gỡ vai sau đó không làm chữ ký này
      -- mất hiệu lực ngược, vì hàm đếm không còn hỏi member_roles nữa.
      NEW.role_at_sign := v_role;
      RETURN NEW;
    END $fn$;

    CREATE OR REPLACE FUNCTION fn_pending_action_signatures(p_action uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT s.signer_id)::int
        FROM pending_action_signatures s
        JOIN pending_actions a ON a.id = s.pending_action_id
       WHERE s.pending_action_id = p_action
         AND s.community_id = a.community_id
         AND s.payload_hash_at_sign = a.payload_hash   -- ký ĐÚNG nội dung này (027)
         AND s.role_at_sign = fn_pending_action_role(a.action_key);  -- và ĐÚNG vai, lúc ký
    $fn$;
  `);

  // 2d. Bảo chứng — QĐ-2 của người dùng (2026-08-20): CẢ HAI người ký phải
  //     mang vai `approver` TẠI THỜI ĐIỂM KÝ.
  //
  //     Căn cứ là mockup 0702, không phải suy diễn: tiêu đề "Bảo chứng của Ban
  //     điều hành", hai chữ ký ghi rõ "Ban điều hành · người xem bản gốc" và
  //     "Đại diện Ban điều hành thứ hai · Đồng ký theo quy tắc bốn mắt", dòng
  //     cuối "Không ai được tự cấp bảo chứng một mình, kể cả Chủ trì."
  //     Migration 018 đã ghi rõ nó KHÔNG đòi vai và vì sao (đặc tả mục 4.5 chỉ
  //     nói "đúng 2 người khác nhau"), kèm câu "đã nêu để người chủ trì quyết".
  //     Người chủ trì đã quyết — đây là chỗ ghi quyết định đó thành SQL.
  //
  //     TÊN TRIGGER CÓ CHỦ ĐÍCH BẮT ĐẦU BẰNG `trg_endorsement_z_`: PostgreSQL
  //     chạy trigger cùng thời điểm theo THỨ TỰ TÊN, và luật DANH TÍNH ("không
  //     tự bảo chứng cho mình", `trg_endorsement_signer_valid`) phải trả lời
  //     TRƯỚC luật VAI. Người tự ký cho mình phải nghe `ENDORSEMENT_SELF_SIGN`,
  //     không phải một câu về vai — cùng lập luận thứ tự trigger mà migration
  //     027 đã dùng cho `aid_slot_takers`.
  await knex.raw(`
    CREATE FUNCTION fn_endorsement_sig_role() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = NEW.signer_id
                        AND mr.community_id = NEW.community_id
                        AND r.key = 'approver') THEN
        RAISE EXCEPTION 'ENDORSER_ROLE_REQUIRED'
          USING DETAIL = 'bảo chứng là việc của Ban điều hành: cả hai người ký phải mang vai approver';
      END IF;
      NEW.role_at_sign := 'approver';
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_endorsement_z_role
      BEFORE INSERT OR UPDATE ON endorsement_signatures
      FOR EACH ROW EXECUTE FUNCTION fn_endorsement_sig_role();
  `);

  // 2e. Hai hàm đếm của bảo chứng đếm theo ảnh chụp vai.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_endorsement_two_signatures() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_n int;
    BEGIN
      IF NEW.status <> 'active' THEN RETURN NULL; END IF;
      SELECT count(DISTINCT s.signer_id) INTO v_n
        FROM endorsement_signatures s
       WHERE s.endorsement_id = NEW.id
         AND s.community_id = NEW.community_id
         AND s.signer_id <> NEW.member_id
         AND s.role_at_sign = 'approver';
      IF v_n <> 2 THEN
        RAISE EXCEPTION 'ENDORSEMENT_NEEDS_TWO_DISTINCT'
          USING DETAIL = format('bảo chứng đang có %s chữ ký hợp lệ, cần đúng 2', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE OR REPLACE FUNCTION fn_endorsement_sig_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_e uuid; v_status text; v_subject uuid; v_cid uuid; v_n int;
    BEGIN
      IF TG_OP = 'DELETE' THEN v_e := OLD.endorsement_id; ELSE v_e := NEW.endorsement_id; END IF;

      SELECT status, member_id, community_id INTO v_status, v_subject, v_cid
        FROM endorsements WHERE id = v_e;
      IF v_status IS NULL THEN RETURN NULL; END IF;
      IF v_status <> 'active' THEN RETURN NULL; END IF;

      SELECT count(DISTINCT s.signer_id) INTO v_n
        FROM endorsement_signatures s
       WHERE s.endorsement_id = v_e
         AND s.community_id = v_cid
         AND s.signer_id <> v_subject
         AND s.role_at_sign = 'approver';
      IF v_n <> 2 THEN
        RAISE EXCEPTION 'ENDORSEMENT_NEEDS_TWO_DISTINCT'
          USING DETAIL = format('bảo chứng còn %s chữ ký hợp lệ, cần đúng 2', v_n);
      END IF;
      RETURN NULL;
    END $fn$;
  `);

  // -------------------------------------------------------------------------
  // 3. #22 — `communities.config` đi qua khung hai người ký.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_community_config_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.config IS NOT DISTINCT FROM OLD.config THEN RETURN NEW; END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pending_actions a
         WHERE a.community_id = OLD.id
           AND a.action_key = 'community.config_change'
           AND a.status = 'pending'
           AND a.expires_at > now()
           AND a.payload -> 'config' = NEW.config      -- ĐÚNG nội dung đã ký
           AND fn_pending_action_signatures(a.id) >= 2
      ) THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'communities.config là chính sách của cộng đồng: đổi nó phải qua một hành động community.config_change đủ hai chữ ký';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_community_config_guard BEFORE UPDATE ON communities
      FOR EACH ROW EXECUTE FUNCTION fn_community_config_guard();
  `);

  // Cửa hợp lệ duy nhất. Chú ý: hàm này KHÔNG phải nơi giữ luật — trigger ở
  // trên mới là. Nếu ai đó viết một hàm SECURITY DEFINER thứ hai cũng đụng vào
  // `communities.config`, trigger vẫn chặn nó. Đây là bài học Ruling T10-a
  // được áp dụng NGAY khi dựng cửa, thay vì sau khi mất một vòng soát xét.
  await knex.raw(`
    CREATE FUNCTION fn_community_config_apply(p_action uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid; v_key text; v_new jsonb;
    BEGIN
      SELECT community_id, action_key, payload -> 'config'
        INTO v_cid, v_key, v_new
        FROM pending_actions WHERE id = p_action;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;
      IF v_key <> 'community.config_change' OR v_new IS NULL OR jsonb_typeof(v_new) <> 'object' THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'hành động này không phải một thay đổi cấu hình hợp lệ';
      END IF;
      UPDATE communities SET config = v_new, updated_at = now() WHERE id = v_cid;
      RETURN v_new;
    END $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_community_config_apply(uuid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_community_config_apply(uuid) TO ??`, [user]);

  // Lớp 1: `app_role` không còn viết thẳng vào `communities` nữa. Không route
  // nào trong `api/src` từng làm việc đó (đã grep toàn kho), nên đây không
  // phải một sự siết chặt gây đau — nó chỉ khai đúng thực tế thành quyền.
  await knex.raw(`REVOKE INSERT, UPDATE, DELETE ON communities FROM ??`, [user]);

  // -------------------------------------------------------------------------
  // 4. #20 — nới hạn mức bảo lãnh phải đến từ một hành động ĐÃ THI HÀNH.
  // -------------------------------------------------------------------------
  await knex.raw(`
    ALTER TABLE guarantee_quota_overrides ADD COLUMN pending_action_id uuid;
  `);
  await knex.raw(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM guarantee_quota_overrides WHERE pending_action_id IS NULL) THEN
        RAISE EXCEPTION 'Có hàng guarantee_quota_overrides cũ không gắn được pending_action — phải xử lý bằng tay trước khi chạy migration này';
      END IF;
    END $$;
  `);
  await knex.raw(`
    ALTER TABLE guarantee_quota_overrides ALTER COLUMN pending_action_id SET NOT NULL;
    -- Khoá ngoại GHÉP: hành động của cộng đồng B không nới được hạn mức của
    -- cộng đồng A. Lỗi này đã lặp bảy lần trong dự án; ở đây CSDL tự chặn.
    ALTER TABLE guarantee_quota_overrides ADD CONSTRAINT gqo_action_same_community
      FOREIGN KEY (pending_action_id, community_id) REFERENCES pending_actions (id, community_id);
    -- MỘT hành động đã ký nới ĐÚNG MỘT lần. Không có ràng buộc này thì hai
    -- người ký một lần rồi chèn một trăm hàng nới hạn mức bằng cùng một chữ ký.
    ALTER TABLE guarantee_quota_overrides ADD CONSTRAINT gqo_one_row_per_action
      UNIQUE (pending_action_id);
  `);

  // Hoãn tới COMMIT, không phải BEFORE INSERT: hàng nới hạn mức được ghi bởi
  // chính người thi hành, TRONG giao dịch của chữ ký thứ hai, tức lúc chèn thì
  // hành động vẫn còn 'pending'. Kiểm ngay lúc ghi sẽ chặn đúng luồng hợp lệ.
  // Cùng hình dạng `trg_fund_two_approvers` / `trg_pending_two_signatures`.
  await knex.raw(`
    CREATE FUNCTION fn_gqo_two_person() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_key text; v_status text; v_target uuid; v_creator uuid;
    BEGIN
      SELECT action_key, status, target_id, created_by
        INTO v_key, v_status, v_target, v_creator
        FROM pending_actions WHERE id = NEW.pending_action_id;
      IF v_key IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;

      IF v_key <> 'guarantee.quota_override' OR v_status <> 'executed' THEN
        RAISE EXCEPTION 'QUOTA_OVERRIDE_UNSIGNED'
          USING DETAIL = 'nới hạn mức bảo lãnh phải đến từ một hành động guarantee.quota_override đã thi hành';
      END IF;
      -- Hành động ký cho NGƯỜI NÀO thì nới cho người ấy. Không có vế này thì
      -- một chữ ký hợp lệ cho B dùng lại được để nới cho A.
      IF v_target IS DISTINCT FROM NEW.referrer_id THEN
        RAISE EXCEPTION 'QUOTA_OVERRIDE_UNSIGNED'
          USING DETAIL = 'hành động đã ký nhắm vào một người khác';
      END IF;
      -- granted_by là ô "câu hỏi 4": khoá ngoại bắt được ô trống, không bắt
      -- được ô điền tên người khác. Buộc nó bằng người ĐỀ XUẤT hành động.
      IF NEW.granted_by IS DISTINCT FROM v_creator THEN
        RAISE EXCEPTION 'QUOTA_OVERRIDE_UNSIGNED'
          USING DETAIL = 'granted_by phải là người đề xuất hành động đã ký';
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_gqo_two_person
      AFTER INSERT OR UPDATE ON guarantee_quota_overrides
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_gqo_two_person();
  `);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_gqo_two_person ON guarantee_quota_overrides;
    DROP FUNCTION IF EXISTS fn_gqo_two_person();
    ALTER TABLE guarantee_quota_overrides DROP CONSTRAINT IF EXISTS gqo_one_row_per_action;
    ALTER TABLE guarantee_quota_overrides DROP CONSTRAINT IF EXISTS gqo_action_same_community;
    ALTER TABLE guarantee_quota_overrides DROP COLUMN IF EXISTS pending_action_id;

    DROP TRIGGER IF EXISTS trg_community_config_guard ON communities;
    DROP FUNCTION IF EXISTS fn_community_config_guard();
    DROP FUNCTION IF EXISTS fn_community_config_apply(uuid);

    DROP TRIGGER IF EXISTS trg_endorsement_z_role ON endorsement_signatures;
    DROP FUNCTION IF EXISTS fn_endorsement_sig_role();
    DROP TRIGGER IF EXISTS trg_fund_sig_role_snapshot ON fund_entry_approvals;
    DROP FUNCTION IF EXISTS fn_fund_sig_role_snapshot();
  `);

  await knex.raw(`GRANT INSERT, UPDATE, DELETE ON communities TO ??`, [user]);

  // Khôi phục nguyên văn bốn thân hàm của 018 / 020 / 022 / 027.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_fund_valid_signatures(p_entry uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT a.approver_id)::int
        FROM fund_entry_approvals a
        JOIN fund_entries e ON e.id = a.entry_id
        JOIN member_roles mr ON mr.member_id = a.approver_id
                            AND mr.community_id = e.community_id
        JOIN roles r ON r.id = mr.role_id AND r.key = 'approver'
       WHERE a.entry_id = p_entry
         AND a.community_id = e.community_id
         AND a.approver_id <> e.created_by;
    $fn$;

    CREATE OR REPLACE FUNCTION fn_pending_action_signatures(p_action uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT s.signer_id)::int
        FROM pending_action_signatures s
        JOIN pending_actions a ON a.id = s.pending_action_id
       WHERE s.pending_action_id = p_action
         AND s.community_id = a.community_id
         AND s.payload_hash_at_sign = a.payload_hash;
    $fn$;

    CREATE OR REPLACE FUNCTION fn_pending_signature_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_action text; v_target_type text; v_target uuid; v_cid uuid; v_role text;
    BEGIN
      SELECT action_key, target_type, target_id, community_id
        INTO v_action, v_target_type, v_target, v_cid
        FROM pending_actions WHERE id = NEW.pending_action_id;
      IF v_action IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;
      IF v_target_type = 'member' AND v_target = NEW.signer_id THEN
        RAISE EXCEPTION 'SIGNER_IS_TARGET'
          USING DETAIL = 'không ai ký cho một hành động nhắm vào chính mình';
      END IF;
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

    CREATE OR REPLACE FUNCTION fn_endorsement_two_signatures() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_n int;
    BEGIN
      IF NEW.status <> 'active' THEN RETURN NULL; END IF;
      SELECT count(DISTINCT s.signer_id) INTO v_n
        FROM endorsement_signatures s
       WHERE s.endorsement_id = NEW.id
         AND s.community_id = NEW.community_id
         AND s.signer_id <> NEW.member_id;
      IF v_n <> 2 THEN
        RAISE EXCEPTION 'ENDORSEMENT_NEEDS_TWO_DISTINCT'
          USING DETAIL = format('bảo chứng đang có %s chữ ký hợp lệ, cần đúng 2', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE OR REPLACE FUNCTION fn_endorsement_sig_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_e uuid; v_status text; v_subject uuid; v_cid uuid; v_n int;
    BEGIN
      IF TG_OP = 'DELETE' THEN v_e := OLD.endorsement_id; ELSE v_e := NEW.endorsement_id; END IF;
      SELECT status, member_id, community_id INTO v_status, v_subject, v_cid
        FROM endorsements WHERE id = v_e;
      IF v_status IS NULL THEN RETURN NULL; END IF;
      IF v_status <> 'active' THEN RETURN NULL; END IF;
      SELECT count(DISTINCT s.signer_id) INTO v_n
        FROM endorsement_signatures s
       WHERE s.endorsement_id = v_e
         AND s.community_id = v_cid
         AND s.signer_id <> v_subject;
      IF v_n <> 2 THEN
        RAISE EXCEPTION 'ENDORSEMENT_NEEDS_TWO_DISTINCT'
          USING DETAIL = format('bảo chứng còn %s chữ ký hợp lệ, cần đúng 2', v_n);
      END IF;
      RETURN NULL;
    END $fn$;
  `);

  await knex.raw(`
    ALTER TABLE pending_action_signatures DROP COLUMN IF EXISTS role_at_sign;
    ALTER TABLE fund_entry_approvals      DROP COLUMN IF EXISTS role_at_sign;
    ALTER TABLE endorsement_signatures    DROP COLUMN IF EXISTS role_at_sign;

    ALTER TABLE pending_actions DROP CONSTRAINT pending_actions_action_key_check;
    ALTER TABLE pending_actions ADD CONSTRAINT pending_actions_action_key_check
      CHECK (action_key IN (
        'data.delete', 'contacts.export', 'backup.restore',
        'member.terminate', 'guarantee.quota_override'));

    CREATE OR REPLACE FUNCTION fn_pending_action_role(p_action_key text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $fn$
      SELECT CASE p_action_key
               WHEN 'data.delete'              THEN 'approver'
               WHEN 'contacts.export'          THEN 'tech'
               WHEN 'backup.restore'           THEN 'tech'
               WHEN 'member.terminate'         THEN 'approver'
               WHEN 'guarantee.quota_override' THEN 'approver'
             END;
    $fn$;
  `);
}
