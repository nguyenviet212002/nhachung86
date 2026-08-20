// Bịt các cửa "ràng buộc trên bảng A không chạy khi động vào bảng B" tìm ra ở
// vòng rà toàn bộ 71 bảng / 39 trigger — xem `docs/RANG-BUOC.md` (mục 5 liệt kê
// từng cửa kèm cách tái hiện; mục 7 ghi những cửa CỐ Ý chưa vá và vì sao).
//
// MỌI cửa dưới đây đã được tái hiện bằng CHẠY THẬT: migration đầy đủ từ schema
// trắng, kết nối `app_role` thật, giao dịch có đóng dấu người thực hiện. Không
// mục nào là suy đoán từ việc đọc mã.
//
// ===========================================================================
// MỘT QUYẾT ĐỊNH THIẾT KẾ PHẢI ĐỌC TRƯỚC: `fn_acting_member()` KHÁC
// `fn_self_only()` ở nhánh "không có actor", và đó là chủ ý.
//
// `fn_self_only` (migration 025) ném `NO_ACTOR` khi giao dịch không đóng dấu.
// Đúng cho ba bảng nó đang canh: mọi lượt ghi hợp lệ vào `work_confirmations`,
// `aid_slot_takers`, `signal_responses` đều đến từ một người đang đăng nhập.
//
// Ba bảng mới ở đây thì không như vậy:
//   * `privacy_settings` được `fn_member_bootstrap` (SECURITY DEFINER, migration
//     012) ghi tám hàng mặc định cho NGƯỜI MỚI, trong giao dịch đóng dấu NGƯỜI
//     DUYỆT. Với `fn_self_only`, luồng duyệt gia nhập sẽ chết — luật "chính chủ"
//     SAI ở đó về nghiệp vụ chứ không chỉ bất tiện.
//   * `privacy_settings`, `contact_requests`, `introductions` đều là bảng mà
//     migration và người vận hành có lý do chính đáng để chạm bằng `psql`.
//
// Nên `fn_acting_member(TG_RELID)` trả về:
//   - `uuid` của người thực hiện, nếu giao dịch có đóng dấu ⇒ luật chính chủ ÉP;
//   - `NULL`, nếu không đóng dấu NHƯNG câu lệnh đang chạy bằng quyền CHỦ BẢNG
//     (migration, `psql` của người vận hành, hoặc một hàm SECURITY DEFINER của
//     chính hệ thống — trong hàm SECURITY DEFINER, `current_user` là chủ hàm)
//     ⇒ đây là đường của chính hệ thống, bỏ qua luật chính chủ;
//   - ném `NO_ACTOR`, nếu không đóng dấu và KHÔNG phải chủ bảng — tức `app_role`
//     ghi vào đây ngoài `withActor()`, đúng loại lỗi mà `fn_self_only` bắt.
//
// GIỚI HẠN, NÓI THẲNG: khác `fn_work_participants_frozen` hay `fn_fund_sig_guard`
// (chặn cả đường owner/`psql`), ba trigger "chính chủ" ở đây KHÔNG chặn đường
// owner. Đổi lại chúng chặn đúng mặt tấn công thật — mọi request HTTP đều đi qua
// `withActor()` bằng vai `app_role`. README vận hành phải ghi: sửa
// `privacy_settings` bằng `psql` là sửa quyền riêng tư của người khác mà không
// có dấu vết.
// ===========================================================================

export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  // -------------------------------------------------------------------------
  // 0. Ai đang thực hiện — MỘT định nghĩa, dùng cho cả ba trigger dưới.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_acting_member(p_rel oid) RETURNS uuid
    LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
    DECLARE v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
    BEGIN
      IF v_actor IS NOT NULL THEN RETURN v_actor; END IF;
      IF current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = p_rel) THEN
        RETURN NULL;                 -- đường của chính hệ thống, xem ghi chú đầu tệp
      END IF;
      RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
    END $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_acting_member(oid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_acting_member(oid) TO ??`, [user]);

  // -------------------------------------------------------------------------
  // 1. HỌ A — `contact_read` không quyết định gì; nó ĐI HỎI ba bảng, và ba bảng
  //    ấy không ai canh.
  //
  //    Cả kiến trúc bỏ công tách `member_contacts` ra khỏi `members` rồi
  //    `REVOKE ALL` để một route viết ẩu không làm lộ số điện thoại. Nhưng
  //    `contact_read` trả lời "cho xem hay không" bằng cách đọc
  //    `privacy_settings` / `contact_requests` / `introductions` — ba bảng mà
  //    bất kỳ câu `UPDATE` nào của `app_role` cũng viết được. Cửa chính khoá ba
  //    lớp, còn cái công tắc mở cửa thì để ngoài hiên.
  // -------------------------------------------------------------------------

  // 1a. Mức riêng tư là câu trả lời của CHÍNH CHỦ HỒ SƠ.
  //
  // Chỉ canh UPDATE/DELETE, KHÔNG canh INSERT: `fn_member_bootstrap` chèn tám
  // hàng mặc định cho người mới bằng dấu của người duyệt (xem ghi chú đầu tệp),
  // và `UNIQUE (member_id, field_key)` cộng với việc DELETE nay bị canh khiến
  // đường "xoá rồi chèn lại hàng public" không mở được.
  await knex.raw(`
    CREATE FUNCTION fn_privacy_self_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_actor uuid := fn_acting_member(TG_RELID);
    BEGIN
      IF v_actor IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;

      IF OLD.member_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'privacy_settings.member_id phải là chính người đang đăng nhập';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      -- Cả NEW: không sang tên hàng riêng tư của mình cho người khác.
      IF NEW.member_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'privacy_settings.member_id phải là chính người đang đăng nhập';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_privacy_self_only
      BEFORE UPDATE OR DELETE ON privacy_settings
      FOR EACH ROW EXECUTE FUNCTION fn_privacy_self_only();
  `);

  // 1b. Đơn xin quyền: người XIN không tự duyệt cho mình.
  //
  // `cr_not_self` (CHECK) đã chặn "xin quyền của chính mình". Nó KHÔNG chặn
  // "tự bấm nút đồng ý thay cho người kia" — đúng câu hỏi 4 của `docs/RANG-BUOC.md`:
  // ràng buộc đúng về hình thức, rỗng về mục đích. `status='approved'` là chữ ký
  // của chủ hồ sơ; chữ ký thì chỉ chủ nhân ký được.
  await knex.raw(`
    CREATE FUNCTION fn_contact_request_self_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_actor uuid := fn_acting_member(TG_RELID);
    BEGIN
      IF v_actor IS NULL THEN RETURN NEW; END IF;

      -- Nguyên tắc 1: không ai xin hộ ai.
      IF TG_OP = 'INSERT' AND NEW.requester_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'contact_requests.requester_id phải là chính người đang đăng nhập';
      END IF;

      -- Ba cột định danh của một đơn là dữ kiện của lời đồng ý; đổi chúng là
      -- chuyển lời đồng ý sang một cặp người khác.
      IF TG_OP = 'UPDATE'
         AND (NEW.requester_id, NEW.target_id, NEW.field_key)
             IS DISTINCT FROM (OLD.requester_id, OLD.target_id, OLD.field_key) THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'không đổi được người xin / người được hỏi / trường của một đơn đã nộp';
      END IF;

      -- Quyết định (approved/denied) chỉ chủ hồ sơ đưa ra được.
      IF NEW.status <> 'pending'
         AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
         AND NEW.target_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'chỉ chủ hồ sơ quyết định đơn xin quyền nhắm vào mình';
      END IF;

      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_contact_request_self_only
      BEFORE INSERT OR UPDATE ON contact_requests
      FOR EACH ROW EXECUTE FUNCTION fn_contact_request_self_only();
  `);

  // 1c. Ba chữ ký mở kênh — mỗi chữ ký một người.
  //
  // `CHECK intro_three_consents` bảo đảm KHÔNG TỒN TẠI trạng thái "kênh mở mà
  // thiếu chữ ký", và `t13-three-consents` chứng minh điều đó rất kỹ. Nhưng CHECK
  // chỉ biết BA Ô CÙNG BẬT; nó không biết AI BẬT Ô NÀO. Ba cái tick do một người
  // bấm vẫn là ba cái tick — và vì `intro_distinct_candidate` chỉ cấm
  // candidate trùng introducer/poster, một người vừa là introducer vừa là poster
  // tự mở được kênh với bất kỳ ai làm "ứng viên", rồi đọc số điện thoại của họ.
  await knex.raw(`
    CREATE FUNCTION fn_intro_consent_self_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      v_actor uuid := fn_acting_member(TG_RELID);
      v_i boolean; v_c boolean; v_p boolean;      -- trạng thái CŨ của ba ô
    BEGIN
      IF v_actor IS NULL THEN RETURN NEW; END IF;

      IF TG_OP = 'INSERT' THEN
        v_i := false; v_c := false; v_p := false;
      ELSE
        v_i := OLD.consent_introducer; v_c := OLD.consent_candidate; v_p := OLD.consent_poster;
        -- Ba vai đóng băng khi đã có bất kỳ chữ ký nào: đổi tên người ở vai đó
        -- là gán chữ ký đã có sang một người chưa bao giờ ký.
        IF (v_i OR v_c OR v_p)
           AND (NEW.introducer_id, NEW.candidate_id, NEW.poster_id)
               IS DISTINCT FROM (OLD.introducer_id, OLD.candidate_id, OLD.poster_id) THEN
          RAISE EXCEPTION 'SELF_ONLY'
            USING DETAIL = 'lời giới thiệu đã có chữ ký nên không đổi được ba vai';
        END IF;
      END IF;

      IF NEW.consent_introducer AND NOT v_i AND NEW.introducer_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'introductions.consent_introducer chỉ chính người giới thiệu bật được';
      END IF;
      IF NEW.consent_candidate AND NOT v_c AND NEW.candidate_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'introductions.consent_candidate chỉ chính ứng viên bật được';
      END IF;
      IF NEW.consent_poster AND NOT v_p AND NEW.poster_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = 'introductions.consent_poster chỉ chính người đăng tin bật được';
      END IF;

      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_intro_consent_self_only
      BEFORE INSERT OR UPDATE ON introductions
      FOR EACH ROW EXECUTE FUNCTION fn_intro_consent_self_only();
  `);

  // -------------------------------------------------------------------------
  // 2. HỌ B — `fn_self_only` chỉ được gắn ở `BEFORE INSERT`.
  //
  // `UPDATE` biến một hàng cũ thành một hành động mới mà không đi qua `INSERT`
  // lần nào: `UPDATE aid_slot_takers SET member_id = <người khác>` sang tên suất
  // giúp cho một người chưa bấm gì; `UPDATE … SET slot_id = <suất khác>` nhét
  // thêm người vào một suất đã đủ chỗ; `UPDATE signal_responses SET responder_id`
  // trả lời thay người khác. Cả ba đã tái hiện được.
  //
  // `DELETE` cũng vào danh sách: gỡ suất của người khác là quyết định thay họ,
  // và `aid_slot_takers`/`signal_responses` đều có `DELETE` trong ma trận quyền.
  //
  // `fn_self_only` phải biết đọc `OLD` để phục vụ nhánh `DELETE`. Thay thân hàm
  // chứ không viết hàm thứ hai — hai bản luật cho cùng một ý là đúng thứ `core/`
  // sinh ra để tránh. Ba trigger `BEFORE INSERT` đang dùng nó không đổi hành vi.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_self_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_rec   jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
      v_row   uuid := (v_rec ->> TG_ARGV[0])::uuid;
      v_old   uuid;
    BEGIN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;
      IF v_row IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = format('%s.%s phải là chính người đang đăng nhập', TG_TABLE_NAME, TG_ARGV[0]);
      END IF;
      -- Ở UPDATE phải soi CẢ hàng cũ: sang tên hàng của người khác về mình vẫn
      -- là quyết định thay họ, và vế NEW một mình không thấy điều đó.
      IF TG_OP = 'UPDATE' THEN
        v_old := (to_jsonb(OLD) ->> TG_ARGV[0])::uuid;
        IF v_old IS DISTINCT FROM v_actor THEN
          RAISE EXCEPTION 'SELF_ONLY'
            USING DETAIL = format('%s.%s phải là chính người đang đăng nhập', TG_TABLE_NAME, TG_ARGV[0]);
        END IF;
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $fn$;
  `);

  //
  // TRẬT TỰ TRIGGER trên `aid_slot_takers`: PostgreSQL chạy các trigger cùng
  // thời điểm theo THỨ TỰ TÊN, và `trg_aid_slot_capacity` < `trg_slot_self_only`
  // theo bảng chữ cái — nghĩa là luật HẠN MỨC trả lời trước luật DANH TÍNH.
  // Sai hướng: người đang điền tên người khác vào suất phải nghe `SELF_ONLY`,
  // không phải một câu về tình trạng chỗ trống của một suất không liên quan tới
  // họ. Đây đúng lập luận migration 025 đã dùng cho `work_confirmations`, và
  // ở đó tên trigger được đánh số chính vì việc này. Đặt số ở đây luôn.
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_slot_self_only ON aid_slot_takers;
    CREATE TRIGGER trg_ast_1_self_only
      BEFORE INSERT OR UPDATE OR DELETE ON aid_slot_takers
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');

    DROP TRIGGER IF EXISTS trg_sig_resp_self_only ON signal_responses;
    CREATE TRIGGER trg_sig_resp_self_only
      BEFORE INSERT OR UPDATE OR DELETE ON signal_responses
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('responder_id');

    -- signal_forwards đã bị REVOKE UPDATE, DELETE nên đường app_role vốn kín;
    -- gắn thêm ở đây để đường owner/psql cũng kín, cùng lập luận "hai lớp cho
    -- một tài sản" của mục 4.8 đặc tả.
    DROP TRIGGER IF EXISTS trg_sig_fwd_self_only ON signal_forwards;
    CREATE TRIGGER trg_sig_fwd_self_only
      BEFORE INSERT OR UPDATE OR DELETE ON signal_forwards
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('from_member_id');
  `);

  // Sức chứa của suất cũng chỉ được canh ở INSERT — `UPDATE … SET slot_id` đưa
  // được người thứ hai vào một suất khai `needed = 1` (đã tái hiện).
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_aid_slot_capacity ON aid_slot_takers;
    CREATE TRIGGER trg_ast_2_capacity
      BEFORE INSERT OR UPDATE ON aid_slot_takers
      FOR EACH ROW EXECUTE FUNCTION fn_aid_slot_capacity();
  `);

  // -------------------------------------------------------------------------
  // 3. HỌ C — trigger ngồi trên bảng CON, đọc một cột định danh ở bảng CHA.
  //    Đổi cột đó ở bảng cha thì không ai canh.
  //
  //    Hình dạng ĐÚNG đã có sẵn trong dự án: `trg_endorsement_two_signatures` là
  //    trigger hoãn trên chính bảng CHA, nên `UPDATE endorsements SET member_id`
  //    bị nó đếm lại và chặn (đã tự kiểm: bị chặn). Ba chỗ dưới đây thiếu đúng
  //    vế đó.
  // -------------------------------------------------------------------------

  // 3a. Bằng chứng năng lực phải là việc CHÍNH CHỦ tham gia và đã tự ký
  //     (`fn_capability_evidence_valid`, migration 013). Đổi chủ năng lực sau
  //     khi đã gắn bằng chứng là đổi luôn câu trả lời của luật ấy: năng lực
  //     chuyển sang tên người chưa bao giờ làm việc đó.
  await knex.raw(`
    CREATE FUNCTION fn_capability_owner_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.member_id, NEW.community_id) IS NOT DISTINCT FROM (OLD.member_id, OLD.community_id) THEN
        RETURN NEW;
      END IF;
      IF EXISTS (SELECT 1 FROM capability_evidence WHERE capability_id = OLD.id) THEN
        RAISE EXCEPTION 'CAPABILITY_OWNER_FROZEN'
          USING DETAIL = 'năng lực đã dẫn bằng chứng nên không chuyển sang tên người khác được';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_capability_owner_frozen BEFORE UPDATE ON capabilities
      FOR EACH ROW EXECUTE FUNCTION fn_capability_owner_frozen();
  `);

  // 3b. "Người vay không tự bảo lãnh cho khoản vay của mình" — cùng một luật,
  //     nay ép được từ CẢ HAI đầu. Dùng lại đúng mã lỗi của
  //     `fn_loan_guarantor_valid` (migration 021) vì đây là cùng một câu trả lời
  //     cho cùng một câu hỏi, chỉ khác bảng nào bị động vào.
  await knex.raw(`
    CREATE FUNCTION fn_loan_borrower_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.borrower_id IS NOT DISTINCT FROM OLD.borrower_id THEN RETURN NEW; END IF;
      IF EXISTS (SELECT 1 FROM loan_guarantors g
                  WHERE g.loan_id = NEW.id AND g.member_id = NEW.borrower_id) THEN
        RAISE EXCEPTION 'LOAN_GUARANTOR_IS_BORROWER'
          USING DETAIL = 'người vay không tự bảo lãnh cho khoản vay của mình';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_loan_borrower_valid BEFORE UPDATE ON loans
      FOR EACH ROW EXECUTE FUNCTION fn_loan_borrower_valid();
  `);

  // 3c. `pending_action_signatures.payload_hash_at_sign` có mặt trong lược đồ từ
  //     đặc tả mục 7.1 và CHƯA CÓ MỘT CÂU SQL NÀO ĐỌC NÓ. Hai trigger hai đầu
  //     (`trg_pending_two_signatures`, `trg_pending_sig_guard`) chỉ ĐẾM chữ ký.
  //     Hậu quả đã tái hiện: ghi hành động + hai chữ ký, rồi `UPDATE` đổi
  //     `payload`/`payload_hash`, rồi `status='executed'` — hai người ký nội
  //     dung X, hệ thống thi hành nội dung Y. Với `contacts.export` hay
  //     `member.terminate` thì đó là một việc không hoàn tác được.
  //
  //     Sửa ở HÀM ĐẾM DÙNG CHUNG, không sửa hai trigger: một định nghĩa của
  //     "chữ ký hợp lệ" thì hai đầu không thể trôi dạt khỏi nhau. Đây cũng là
  //     đúng chỗ đặc tả mục 7.2 bước 2 mô tả ("`payload_hash` tính lại BẰNG
  //     `payload_hash_at_sign` của chữ ký đầu") mà chưa ai viết ra bằng SQL.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_pending_action_signatures(p_action uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT s.signer_id)::int
        FROM pending_action_signatures s
        JOIN pending_actions a ON a.id = s.pending_action_id
       WHERE s.pending_action_id = p_action
         AND s.community_id = a.community_id
         AND s.payload_hash_at_sign = a.payload_hash;   -- ký ĐÚNG nội dung này
    $fn$;
  `);

  //     Và đóng băng chính hàng hành động khi đã có chữ ký. Cần cả hai: hàm đếm
  //     ở trên bắt được đổi `payload_hash`, nhưng đổi `target_id` mà giữ nguyên
  //     hash thì nó không thấy — mà `fn_pending_signature_valid` kiểm "người ký
  //     không được là đối tượng" ở BẢNG CHỮ KÝ, nên đổi đối tượng ở BẢNG HÀNH
  //     ĐỘNG không ai kiểm lại (đã tái hiện: hành động `member.terminate` thi
  //     hành nhắm vào chính một trong hai người ký).
  await knex.raw(`
    CREATE FUNCTION fn_pending_action_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.community_id, NEW.action_key, NEW.target_type, NEW.target_id,
          NEW.payload, NEW.payload_hash, NEW.created_by)
         IS NOT DISTINCT FROM
         (OLD.community_id, OLD.action_key, OLD.target_type, OLD.target_id,
          OLD.payload, OLD.payload_hash, OLD.created_by) THEN
        RETURN NEW;
      END IF;
      IF EXISTS (SELECT 1 FROM pending_action_signatures WHERE pending_action_id = OLD.id) THEN
        RAISE EXCEPTION 'PENDING_ACTION_FROZEN'
          USING DETAIL = 'hành động đã có chữ ký: nội dung và đối tượng không đổi được nữa';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_pending_action_frozen BEFORE UPDATE ON pending_actions
      FOR EACH ROW EXECUTE FUNCTION fn_pending_action_frozen();
  `);

  // 3d. `fn_memory_photo_people_guard` (migration 019) đọc `OLD` ở nhánh
  //     `DELETE` nhưng ở nhánh `UPDATE` chỉ nhìn `NEW.photo_id`. `DELETE` bị
  //     `REVOKE` với lý do ghi rõ ở 019: "gỡ hàng của một người là cách xoá
  //     tiếng 'không' của họ". Nhận định đó đúng — nhưng **DỜI cũng là xoá**,
  //     chỉ khác động từ: `UPDATE memory_photo_people SET photo_id = <ảnh khác>`
  //     lấy một tiếng nói ra khỏi tấm ảnh đã duyệt mà không trigger nào kêu
  //     (đã tái hiện). Đây là chỗ hở nằm BÊN TRONG chính bản vá Ruling T13-b.
  //
  //     VÒNG SỬA ĐẦU CỦA TÔI ĐO SAI ĐẠI LƯỢNG, ghi lại vì nó là một bài học:
  //     tôi mở rộng `fn_memory_photo_people_guard` để kiểm CẢ `OLD.photo_id`.
  //     Bài test vẫn XANH khi chưa vá — vì hàm đếm `fn_photo_consent_missing`
  //     đếm số người **chưa đồng ý**, và dời một hàng `consent='yes'` đi thì con
  //     số ấy vẫn bằng 0. Thiệt hại thật không phải "ảnh thiếu đồng ý" mà là
  //     "một người BIẾN MẤT khỏi danh sách người có mặt" — một đại lượng khác
  //     hẳn, và cái lưới cũ không đo nó. (Cùng bài học Ruling T13-c: một bài
  //     test dựng để chống loại lỗi X vẫn mù trước X nếu nó đo sai đại lượng.)
  //
  //     Sửa đúng: `(photo_id, member_id)` LÀ danh tính của một lời khai có mặt.
  //     Đổi chúng không phải "sửa lời khai" mà là "xoá lời khai này và bịa ra
  //     một lời khai khác" — đúng thứ `REVOKE DELETE` ở 019 đã cấm. Đổi ý thì
  //     `UPDATE consent`, đó mới là đường đúng và nó để lại dấu.
  await knex.raw(`
    CREATE FUNCTION fn_memory_photo_people_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.photo_id, NEW.member_id) IS DISTINCT FROM (OLD.photo_id, OLD.member_id) THEN
        RAISE EXCEPTION 'PHOTO_PEOPLE_FROZEN'
          USING DETAIL = 'không dời được lời khai có mặt sang ảnh khác hay sang tên người khác — dời cũng là xoá';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_memory_photo_ppl_frozen BEFORE UPDATE ON memory_photo_people
      FOR EACH ROW EXECUTE FUNCTION fn_memory_photo_people_frozen();
  `);

  // -------------------------------------------------------------------------
  // 4. HỌ D — luật đọc trạng thái đổi được, và không ai đóng băng trạng thái đó.
  // -------------------------------------------------------------------------

  // 4a. `fn_guarantee_quota` (migration 009) đếm trên `referrer_id`, `created_at`
  //     và `reject_reason_code`, nhưng trigger chỉ khai `UPDATE OF status`. Ba
  //     đường đã tái hiện được:
  //       * đổi `reject_reason_code` từ `referrer_misrepresented` sang
  //         `not_ready` ⇒ suất "đốt vĩnh viễn" quay lại (1 → 0);
  //       * kéo lùi `created_at` ⇒ cửa sổ 12 tháng trượt tự rỗng;
  //       * đặt `referrer_id = NULL` ⇒ đơn `pending` sống tiếp mà không còn ai
  //         bảo lãnh, tức nguyên tắc 1 bị lách sau lưng `REFERRER_REQUIRED`.
  //
  //     Đóng băng ba dữ kiện ấy thay vì mở rộng danh sách cột của trigger hạn
  //     mức: hạn mức chỉ ĐỌC chúng, nên chỗ đúng là cấm sửa, không phải đếm lại.
  //     `join-requests/service.js` không sửa cột nào trong ba cột này (nó chỉ
  //     ghi `reject_reason_code` MỘT LẦN, từ NULL).
  await knex.raw(`
    CREATE FUNCTION fn_join_request_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.community_id, NEW.referrer_id, NEW.created_at)
         IS DISTINCT FROM (OLD.community_id, OLD.referrer_id, OLD.created_at) THEN
        RAISE EXCEPTION 'JOIN_REQUEST_FROZEN'
          USING DETAIL = 'cộng đồng, người bảo lãnh và ngày nộp là dữ kiện hạn mức bảo lãnh đọc, không sửa được';
      END IF;
      IF OLD.reject_reason_code IS NOT NULL
         AND NEW.reject_reason_code IS DISTINCT FROM OLD.reject_reason_code THEN
        RAISE EXCEPTION 'JOIN_REQUEST_FROZEN'
          USING DETAIL = 'lý do từ chối đã ghi thì không sửa lại — nó quyết định suất bảo lãnh có được trả lại hay không';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_join_request_frozen BEFORE UPDATE ON join_requests
      FOR EACH ROW EXECUTE FUNCTION fn_join_request_frozen();
  `);

  // 4b. `fn_referrer_frozen` (migration 010) chỉ chặn khi `OLD.status = 'member'`,
  //     mà `status` có BA giá trị. Hai câu `UPDATE` trong một giao dịch —
  //     `status='left'` rồi đổi `referrer_id` — đi qua trót lọt (đã tái hiện),
  //     đúng lúc đặc tả mục 10 nói hồ sơ người rời phải thành BIA MỘ.
  //
  //     Đổi điều kiện sang `OLD.status <> 'guest'`: người còn là khách thì sợi
  //     bảo lãnh chưa thành sự thật lịch sử (và `t08-guarantee-quota` khẳng định
  //     đúng điều đó), người đã vào hoặc đã rời thì thành rồi.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_referrer_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.referrer_id IS DISTINCT FROM NEW.referrer_id AND OLD.status <> 'guest' THEN
        RAISE EXCEPTION 'REFERRER_FROZEN'
          USING DETAIL = 'sợi bảo lãnh đã thành sự thật lịch sử, không sửa được';
      END IF;
      RETURN NEW;
    END $fn$;
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_join_request_frozen ON join_requests;
    DROP FUNCTION IF EXISTS fn_join_request_frozen();

    DROP TRIGGER IF EXISTS trg_pending_action_frozen ON pending_actions;
    DROP FUNCTION IF EXISTS fn_pending_action_frozen();

    DROP TRIGGER IF EXISTS trg_loan_borrower_valid ON loans;
    DROP FUNCTION IF EXISTS fn_loan_borrower_valid();

    DROP TRIGGER IF EXISTS trg_capability_owner_frozen ON capabilities;
    DROP FUNCTION IF EXISTS fn_capability_owner_frozen();

    DROP TRIGGER IF EXISTS trg_intro_consent_self_only ON introductions;
    DROP FUNCTION IF EXISTS fn_intro_consent_self_only();

    DROP TRIGGER IF EXISTS trg_contact_request_self_only ON contact_requests;
    DROP FUNCTION IF EXISTS fn_contact_request_self_only();

    DROP TRIGGER IF EXISTS trg_privacy_self_only ON privacy_settings;
    DROP FUNCTION IF EXISTS fn_privacy_self_only();

    DROP TRIGGER IF EXISTS trg_memory_photo_ppl_frozen ON memory_photo_people;
    DROP FUNCTION IF EXISTS fn_memory_photo_people_frozen();
  `);

  // Trả các trigger của 016/025/026 về đúng tên và phạm vi cũ (chỉ BEFORE INSERT).
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_ast_2_capacity ON aid_slot_takers;
    CREATE TRIGGER trg_aid_slot_capacity BEFORE INSERT ON aid_slot_takers
      FOR EACH ROW EXECUTE FUNCTION fn_aid_slot_capacity();

    DROP TRIGGER IF EXISTS trg_ast_1_self_only ON aid_slot_takers;
    CREATE TRIGGER trg_slot_self_only BEFORE INSERT ON aid_slot_takers
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');

    DROP TRIGGER IF EXISTS trg_sig_resp_self_only ON signal_responses;
    CREATE TRIGGER trg_sig_resp_self_only BEFORE INSERT ON signal_responses
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('responder_id');

    DROP TRIGGER IF EXISTS trg_sig_fwd_self_only ON signal_forwards;
    CREATE TRIGGER trg_sig_fwd_self_only BEFORE INSERT ON signal_forwards
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('from_member_id');
  `);

  // Khôi phục nguyên văn ba thân hàm của 022 / 025 / 010.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_pending_action_signatures(p_action uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT s.signer_id)::int
        FROM pending_action_signatures s
        JOIN pending_actions a ON a.id = s.pending_action_id
       WHERE s.pending_action_id = p_action
         AND s.community_id = a.community_id;
    $fn$;

    CREATE OR REPLACE FUNCTION fn_self_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE
      v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_row   uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
    BEGIN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;
      IF v_row IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'SELF_ONLY'
          USING DETAIL = format('%s.%s phải là chính người đang đăng nhập', TG_TABLE_NAME, TG_ARGV[0]);
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE OR REPLACE FUNCTION fn_referrer_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.referrer_id IS DISTINCT FROM NEW.referrer_id AND OLD.status = 'member' THEN
        RAISE EXCEPTION 'REFERRER_FROZEN'
          USING DETAIL = 'sợi bảo lãnh đã thành sự thật lịch sử, không sửa được';
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  await knex.raw(`DROP FUNCTION IF EXISTS fn_acting_member(oid);`);
}
