// Vận hành — vai, quyền, và bốn chỗ mà "không route nào gọi nó" đang đóng vai
// bảo vệ.
//
// ===========================================================================
// VÌ SAO TỆP NÀY TỒN TẠI, NÓI NGẮN
//
// Migration 008 để lại một lời hẹn nguyên văn: *"`member_roles` là việc GÁN
// vai — hành động nhạy cảm cần đi qua một hàm SECURITY DEFINER hẹp giống
// `contact_upsert` […]. Task 7 không tạo luồng gán vai nào — khoá lại theo
// đúng tinh thần 'nghi ngờ thì đóng' cho tới khi có hàm đó."*
//
// Đây là tệp viết hàm đó. Và vì `docs/RANG-BUOC.md` mục 4.1 ghi thẳng rằng
// lời hứa *"vai trò là dữ liệu chỉ-đọc"* hôm nay chỉ đúng **"vì chưa ai gán
// vai được"**, mở luồng gán vai là mở lại **bốn** câu hỏi cùng lúc:
//
//   #24  gỡ vai `approver` khỏi người ĐÃ KÝ có làm chữ ký cũ mất hiệu lực
//        ngược không?  → 028 đã vá bằng `role_at_sign`; tệp này KHÔNG được
//        phá điều đó, và `t27` canh.
//   tự nâng quyền: `tech` tự gán `tech`, `approver` tự gán thêm vai.
//   lọc `community_id` (lỗi đã lặp BẢY lần trong dự án).
//   ai bấm nút: mọi hàm `SECURITY DEFINER` phải TỰ KIỂM NGƯỜI GỌI.
//
// ===========================================================================
// BỐN CHỖ ĐƯỢC BỊT Ở ĐÂY, ba trong bốn đã TÁI HIỆN BẰNG CHẠY THẬT trước khi
// viết một dòng mã nào (xem `task-16-report.md`, mục "probe trước thi công"):
//
//  (1) `fn_community_config_apply(uuid)` — 028 nói thẳng ra chỗ này còn lỏng:
//      *"nó chỉ kiểm hành động có tồn tại và đúng loại"*. Tái hiện được: một
//      thành viên **không vai gì** gọi thẳng hàm, và `communities.config` đổi
//      thật (`fund_two_approver_threshold: 999999999`). Trigger
//      `trg_community_config_guard` vẫn giữ luật "phải có hai chữ ký" — nhưng
//      luật "**ai** được bấm nút thi hành" thì không ai giữ ở tầng CSDL, chỉ
//      route giữ. Route là thứ người ta viết thêm mỗi task.
//
//  (2) `audit_log.actor_id` là ô "câu hỏi 4" ở dạng thuần khiết nhất
//      (`docs/RANG-BUOC.md` mục 2): khóa ngoại bắt được ô trống, không bắt
//      được ô **điền tên người khác**. Tái hiện được: `app_role` đóng dấu
//      mình là A rồi ghi một dòng nhật ký mang `actor_id = B`. Và vì
//      `actor_id` NẰM TRONG chuỗi băm (mục 4.6 đặc tả), dòng giả mạo ấy là
//      lịch sử **hợp lệ vĩnh viễn**: `verifyChain` sẽ xác nhận nó lành.
//      Nhật ký bất biến chỉ đáng tin khi nó bất biến **và** trung thực.
//
//  (3) `fn_trust_recount(uuid)` — SECURITY DEFINER, `GRANT EXECUTE` cho
//      `app_role`, và không hỏi ai đang gọi. Tái hiện được: thành viên thường
//      của cộng đồng A gọi nó cho một người của cộng đồng B. Thiệt hại thật
//      thấp (hàm tính lại từ sự thật gốc nên không ghi được con số sai) —
//      nhưng "an toàn vì nó idempotent" là một lập luận về **hậu quả**, không
//      phải một cánh cổng. Ngày ai đó thêm một tham số vào hàm, lập luận ấy
//      hết hiệu lực mà không ai nhớ nó từng tồn tại.
//
//  (4) `fn_member_bootstrap()`, `fn_work_edge()`, `fn_audit_new_partition()`
//      có `proacl IS NULL`, tức `EXECUTE` mặc định cho **PUBLIC**. Hai hàm
//      đầu là `RETURNS trigger` nên PostgreSQL từ chối gọi thẳng, hàm thứ ba
//      không phải `SECURITY DEFINER` nên chết ở `permission denied for schema
//      public` — cả ba đều **an toàn vì lý do bên ngoài chúng**. Thu về cho
//      khớp `fn_trust_recount` (đã `REVOKE FROM PUBLIC` từ Task 12).
//
// ===========================================================================
// MỘT LẬP LUẬN PHẢI GHI LẠI: VÌ SAO CÓ CẢ HÀM LẪN TRIGGER
//
// `member_roles` chỉ có `SELECT` cho `app_role`, nên đường ghi duy nhất từ
// HTTP là một hàm `SECURITY DEFINER`. Đặt kiểm tra bên trong hàm là đủ — HÔM
// NAY. Nhưng Ruling T10-a đã trả giá để học rằng `REVOKE` không đỡ được hàm
// `SECURITY DEFINER` **thứ hai**, và chỗ (1) ở trên là chính xác ca đó xảy ra
// lần nữa, trong một tệp viết bởi người biết rõ bài học đó.
//
// Nên luật "không ai tự nâng quyền cho mình" nằm ở **trigger trên chính bảng
// `member_roles`**, không nằm trong hàm. Trigger đọc `app.actor_id` qua
// `fn_acting_member()` — một biến của GIAO DỊCH, nên nó vẫn thấy được người
// thật kể cả khi câu lệnh đang chạy bên trong một hàm `SECURITY DEFINER`
// (trong hàm đó `current_user` là chủ hàm, nhưng `app.actor_id` thì không
// đổi). Đây là điểm khác biệt then chốt so với `current_user`, và là lý do
// bản vá này chặn được cả hàm gán vai thứ hai mà ai đó viết ở task sau.
//
// Đường của chủ bảng (migration, `psql`, phần DỰNG DỮ LIỆU của bộ kiểm thử)
// đi qua vì `fn_acting_member` trả `NULL` ở đó — cùng đánh đổi đã tuyên và
// giải thích ở mục 6.1 của `docs/RANG-BUOC.md`, không phải một ngoại lệ mới.
// ===========================================================================

// Bảng quyền: CHỈ những khoá thật sự được `requirePermission()` cưỡng chế ở
// một route nào đó. Không thêm khoá "cho đủ bộ" — một hàng quyền không ai đọc
// là một lời hứa không ai giữ, và `t27` khẳng định hai chiều: mọi khoá ở đây
// phải có route dùng, và mọi khoá truyền cho requirePermission trong api/src
// phải có hàng ở đây.
const PERMISSIONS = [
  ['ops.audit.read', 'Xem nhật ký hệ thống', 'Đọc audit_log có lọc và phân trang, và chạy kiểm chuỗi băm'],
  ['ops.dashboard', 'Xem bảng điều khiển vận hành', 'Bốn cảnh báo của mục 4.6 và mục 9 đặc tả'],
  ['ops.pending_action.list', 'Xem danh sách việc chờ hai người ký', null],
  ['ops.role.manage', 'Gán và gỡ vai', 'Chỉ vai tech. Không ai tự gán vai cho chính mình.'],
];

// Ma trận vai → quyền. Nguồn: bảng "Vận hành" mục 5.3 đặc tả (`approver, tech`
// cho nhật ký) và mục 7.4 (*"cấp vai lại là việc của `tech` — có ghi log"*).
const ROLE_PERMISSIONS = [
  ['approver', 'ops.audit.read'],
  ['tech', 'ops.audit.read'],
  ['approver', 'ops.dashboard'],
  ['tech', 'ops.dashboard'],
  ['approver', 'ops.pending_action.list'],
  ['tech', 'ops.pending_action.list'],
  ['tech', 'ops.role.manage'],
];

export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  // -------------------------------------------------------------------------
  // 1. Hạt giống `permissions` / `role_permissions`.
  //
  // Hai bảng này ra đời ở 022 và tới hôm nay vẫn RỖNG — tức `GET /ops/permissions`
  // (đặc tả mục 5.3, "mọi vai") chưa có gì để trả. Gieo bằng `ON CONFLICT DO
  // NOTHING` để migration chạy lại được trên CSDL đã có dữ liệu.
  // -------------------------------------------------------------------------
  for (const [key, name, description] of PERMISSIONS) {
    await knex.raw(
      `INSERT INTO permissions (key, name, description) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [key, name, description]
    );
  }
  for (const [roleKey, permKey] of ROLE_PERMISSIONS) {
    await knex.raw(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r, permissions p WHERE r.key = ? AND p.key = ?
       ON CONFLICT DO NOTHING`,
      [roleKey, permKey]
    );
  }

  // -------------------------------------------------------------------------
  // 2. `audit_log.actor_id` — chỗ (2) ở đầu tệp.
  //
  // TÊN TRIGGER CÓ CHỦ ĐÍCH BẮT ĐẦU BẰNG `trg_audit_a`: PostgreSQL chạy các
  // trigger cùng thời điểm theo THỨ TỰ TÊN, và `trg_audit_chain` (007) tính
  // băm TRÊN `NEW.actor_id`. Kiểm danh tính phải xong TRƯỚC khi ai đó băm nó
  // — cùng lập luận thứ tự trigger đã dùng ở 027 (`aid_slot_takers`) và 028
  // (`trg_endorsement_z_role`).
  //
  // Dùng `session_user`, KHÔNG dùng `current_user`: bên trong một hàm
  // `SECURITY DEFINER` thì `current_user` là chủ hàm, nên một câu kiểm theo
  // `current_user` sẽ mù đúng trước loại người gọi mà nó cần nhìn thấy.
  // `session_user` giữ nguyên vai đã đăng nhập thật (`app_role`).
  //
  // Ba hàm `SECURITY DEFINER` đang ghi `audit_log` (`contact_read`,
  // `contact_upsert`, `join_secret_consume`) đều lấy `actor_id` TỪ CHÍNH
  // `app.actor_id`, nên chúng qua nhánh thứ nhất mà không phải sửa gì.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_audit_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
            v_owner name;
    BEGIN
      IF v_actor IS NOT NULL THEN
        IF NEW.actor_id IS NOT NULL AND NEW.actor_id <> v_actor THEN
          RAISE EXCEPTION 'AUDIT_ACTOR_MISMATCH'
            USING DETAIL = 'dòng nhật ký ghi tên một người khác với người đang thực hiện giao dịch';
        END IF;
        RETURN NEW;
      END IF;

      -- Không đóng dấu: chỉ chủ bảng (migration, psql của người vận hành, tác
      -- vụ định kỳ) mới được nêu đích danh một người. app_role không đóng
      -- dấu thì chỉ ghi được sự kiện KHÔNG có người thực hiện (actor_id NULL) —
      -- đúng hình dạng của otp.requested, auth.login.denied.
      IF NEW.actor_id IS NOT NULL THEN
        SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = TG_RELID;
        IF session_user IS DISTINCT FROM v_owner THEN
          RAISE EXCEPTION 'AUDIT_ACTOR_MISMATCH'
            USING DETAIL = 'giao dịch không đóng dấu người thực hiện nhưng dòng nhật ký lại nêu đích danh một người';
        END IF;
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_audit_actor_guard BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION fn_audit_actor_guard();
  `);

  // -------------------------------------------------------------------------
  // 3. Trigger canh `member_roles` — xem lập luận "vì sao có cả hàm lẫn
  //    trigger" ở đầu tệp.
  //
  // Ba luật, và luật thứ hai là thứ đề bài gọi tên: **tự nâng quyền phải bị
  // chặn TƯỜNG MINH**, không phải bị chặn như một hệ quả phụ của luật vai.
  // `tech` có đủ vai để gán vai — nên nếu chỉ kiểm vai thì `tech` tự gán
  // `tech` cho chính mình sẽ ĐI QUA. Phải có một câu riêng nói "không ai đổi
  // vai của chính mình", và nó phải đứng TRƯỚC câu kiểm vai để `approver` tự
  // gán vai nghe đúng lý do.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_member_role_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_actor uuid := fn_acting_member(TG_RELID);
            v_member uuid; v_cid uuid;
    BEGIN
      -- Tách ra hai biến VÔ HƯỚNG thay vì gán cả OLD/NEW vào một biến record:
      -- CASE WHEN … THEN OLD ELSE NEW END được đánh giá như một biểu thức SQL
      -- và hai kiểu record ẩn danh ở hai nhánh không hợp nhất được. Cùng khuôn
      -- IF/ELSE mà fn_pending_sig_guard (022) và fn_memory_photo_people_guard
      -- (019) đã dùng.
      IF TG_OP = 'DELETE' THEN v_member := OLD.member_id; v_cid := OLD.community_id;
                          ELSE v_member := NEW.member_id; v_cid := NEW.community_id; END IF;

      IF v_actor IS NULL THEN
        -- Đường của chính hệ thống (migration, psql, dựng dữ liệu kiểm thử).
        IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;

      -- (a) KHÔNG AI ĐỔI VAI CỦA CHÍNH MÌNH. Câu này đứng trước câu kiểm vai
      --     vì tech THOẢ câu kiểm vai — tự nâng quyền của tech chỉ bị bắt
      --     bởi đúng câu này.
      IF v_member = v_actor THEN
        RAISE EXCEPTION 'ROLE_SELF_GRANT'
          USING DETAIL = 'không ai tự gán hay tự gỡ vai của chính mình, kể cả vai tech';
      END IF;

      -- (b) Người thao tác phải mang vai tech TRONG CHÍNH cộng đồng của
      --     hàng đang bị đụng tới. Lọc community_id cả hai đầu: lỗi quên lọc
      --     đã lặp bảy lần trong dự án.
      IF NOT EXISTS (
        SELECT 1 FROM member_roles mr
          JOIN roles r ON r.id = mr.role_id
         WHERE mr.member_id = v_actor
           AND mr.community_id = v_cid
           AND r.key = 'tech'
      ) THEN
        RAISE EXCEPTION 'ROLE_MANAGE_DENIED'
          USING DETAIL = 'chỉ vai tech của chính cộng đồng này mới gán hay gỡ vai được';
      END IF;

      -- (c) Người thao tác phải cùng cộng đồng với hàng — hệ quả của (b) hôm
      --     nay (khoá ngoại ghép của 008 buộc member_roles.community_id là
      --     cộng đồng của chính người đó), nhưng nói ra thay vì để nó là một
      --     may mắn của lược đồ.
      IF NOT EXISTS (
        SELECT 1 FROM members m WHERE m.id = v_actor AND m.community_id = v_cid
      ) THEN
        RAISE EXCEPTION 'ROLE_MANAGE_DENIED'
          USING DETAIL = 'người thao tác không thuộc cộng đồng của hàng vai này';
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $fn$;

    CREATE TRIGGER trg_member_role_guard
      BEFORE INSERT OR UPDATE OR DELETE ON member_roles
      FOR EACH ROW EXECUTE FUNCTION fn_member_role_guard();
  `);

  // -------------------------------------------------------------------------
  // 4. `fn_role_grant` / `fn_role_revoke` — cửa hợp lệ duy nhất từ HTTP.
  //
  //    KHÔNG PHẢI nơi giữ luật (trigger ở trên mới là), nhưng vẫn kiểm lại đủ
  //    để người dùng nhận một câu lỗi tử tế thay vì một ngoại lệ trigger, và
  //    để hàm này tự đứng vững nếu ai đó gỡ trigger.
  //
  //    #24 — QUAN TRỌNG: `fn_role_revoke` KHÔNG đụng tới `role_at_sign` trên
  //    ba bảng chữ ký, và ba hàm đếm của 028 KHÔNG hỏi `member_roles` nữa. Gỡ
  //    vai `approver` khỏi một người ĐÃ KÝ vì vậy không làm bút toán quỹ,
  //    bảo chứng hay hành động vận hành đã `COMMIT` mất hiệu lực NGƯỢC. Đó là
  //    quả mìn mà `docs/RANG-BUOC.md` mục 7 đặt sẵn cho đúng tệp này; 028 đã
  //    tháo ngòi, tệp này chỉ được phép KHÔNG cắm lại. `t27` canh cả hai
  //    chiều (gỡ vai ⇒ chữ ký cũ còn hiệu lực; gán vai ⇒ người chưa ký KHÔNG
  //    thành người đã ký).
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_role_grant(p_member uuid, p_role text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
            v_cid uuid; v_role_id uuid; v_n int;
    BEGIN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;

      SELECT community_id INTO v_cid FROM members WHERE id = v_actor;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'người thực hiện không tồn tại'; END IF;

      -- Người nhận vai phải ở CÙNG cộng đồng. Dùng lại NO_TARGET (đã ánh xạ
      -- thành NOT_FOUND) đúng lập luận Ruling T10-a: "không tồn tại" và "ở
      -- cộng đồng khác" phải nói CÙNG một câu, nếu không chính thông điệp lỗi
      -- trở thành máy dò danh sách thành viên của cộng đồng bên kia.
      IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_member AND community_id = v_cid) THEN
        RAISE EXCEPTION 'NO_TARGET' USING DETAIL = 'không tìm thấy người này trong cộng đồng';
      END IF;

      SELECT id INTO v_role_id FROM roles WHERE key = p_role;
      IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'BAD_ROLE' USING DETAIL = 'tên vai không nằm trong năm vai của nền tảng';
      END IF;

      -- Hai câu dưới lặp lại luật của trigger. Cố ý: chúng cho câu lỗi tử tế
      -- TRƯỚC khi trigger phải nói, và giữ hàm tự đứng vững nếu trigger bị gỡ.
      IF p_member = v_actor THEN
        RAISE EXCEPTION 'ROLE_SELF_GRANT'
          USING DETAIL = 'không ai tự gán vai cho chính mình, kể cả vai tech';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = v_actor AND mr.community_id = v_cid AND r.key = 'tech') THEN
        RAISE EXCEPTION 'ROLE_MANAGE_DENIED'
          USING DETAIL = 'chỉ vai tech của chính cộng đồng này mới gán vai được';
      END IF;

      INSERT INTO member_roles (member_id, role_id, community_id)
      VALUES (p_member, v_role_id, v_cid)
      ON CONFLICT (member_id, role_id) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;

      -- Ghi nhật ký CUỐI CÙNG, sau khi mọi nhánh ném đã đi qua (BẪY 1 của đề
      -- bài: ghi audit_log rồi throw trong cùng giao dịch ⇒ rollback xoá luôn
      -- dòng nhật ký). actor_id bằng đúng app.actor_id nên nó qua được
      -- trg_audit_actor_guard ở mục 2 mà không cần ngoại lệ nào.
      IF v_n > 0 THEN
        INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
        VALUES (v_cid, v_actor, 'role.granted', 'member', p_member,
                jsonb_build_object('role', p_role));
      END IF;
      RETURN v_n > 0;
    END $fn$;

    CREATE FUNCTION fn_role_revoke(p_member uuid, p_role text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
            v_cid uuid; v_role_id uuid; v_n int;
    BEGIN
      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;

      SELECT community_id INTO v_cid FROM members WHERE id = v_actor;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'người thực hiện không tồn tại'; END IF;

      IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_member AND community_id = v_cid) THEN
        RAISE EXCEPTION 'NO_TARGET' USING DETAIL = 'không tìm thấy người này trong cộng đồng';
      END IF;

      SELECT id INTO v_role_id FROM roles WHERE key = p_role;
      IF v_role_id IS NULL THEN
        RAISE EXCEPTION 'BAD_ROLE' USING DETAIL = 'tên vai không nằm trong năm vai của nền tảng';
      END IF;

      IF p_member = v_actor THEN
        RAISE EXCEPTION 'ROLE_SELF_GRANT'
          USING DETAIL = 'không ai tự gỡ vai của chính mình';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = v_actor AND mr.community_id = v_cid AND r.key = 'tech') THEN
        RAISE EXCEPTION 'ROLE_MANAGE_DENIED'
          USING DETAIL = 'chỉ vai tech của chính cộng đồng này mới gỡ vai được';
      END IF;

      DELETE FROM member_roles
       WHERE member_id = p_member AND role_id = v_role_id AND community_id = v_cid;
      GET DIAGNOSTICS v_n = ROW_COUNT;

      IF v_n > 0 THEN
        INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
        VALUES (v_cid, v_actor, 'role.revoked', 'member', p_member,
                jsonb_build_object('role', p_role));
      END IF;
      RETURN v_n > 0;
    END $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_role_grant(uuid, text) FROM PUBLIC`);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_role_revoke(uuid, text) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_role_grant(uuid, text) TO ??`, [user]);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_role_revoke(uuid, text) TO ??`, [user]);

  // -------------------------------------------------------------------------
  // 5. Chỗ (1): `fn_community_config_apply` nay hỏi AI ĐANG BẤM NÚT.
  //
  // Điều kiện chọn là "người gọi phải là MỘT TRONG NHỮNG NGƯỜI ĐÃ KÝ hành
  // động này", không phải "người gọi có vai approver". Lý do: đặc tả mục 7.2
  // bước 3 nói thi hành chạy **trong cùng giao dịch với chữ ký thứ hai**, nên
  // người gọi hợp lệ duy nhất trong thiết kế đã là một người ký. Kiểm theo
  // vai thì rộng hơn thực tế — một approver thứ ba, không đọc gì, không ký gì,
  // vẫn bấm được nút thi hành một quyết định của hai người khác.
  //
  // Hàng chữ ký đã mang sẵn cả cộng đồng lẫn vai lúc ký (`role_at_sign`, 028),
  // nên câu kiểm này bao luôn hai vế đó mà không phải hỏi `member_roles` —
  // tức nó cũng không phá #24.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_community_config_apply(p_action uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid; v_key text; v_new jsonb;
            v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
    BEGIN
      SELECT community_id, action_key, payload -> 'config'
        INTO v_cid, v_key, v_new
        FROM pending_actions WHERE id = p_action;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_PENDING_ACTION'; END IF;
      IF v_key <> 'community.config_change' OR v_new IS NULL OR jsonb_typeof(v_new) <> 'object' THEN
        RAISE EXCEPTION 'CONFIG_CHANGE_UNSIGNED'
          USING DETAIL = 'hành động này không phải một thay đổi cấu hình hợp lệ';
      END IF;

      IF v_actor IS NULL THEN
        RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pending_action_signatures s
         WHERE s.pending_action_id = p_action
           AND s.signer_id = v_actor
           AND s.community_id = v_cid
      ) THEN
        RAISE EXCEPTION 'EXECUTOR_NOT_SIGNER'
          USING DETAIL = 'chỉ một trong những người đã ký mới thi hành được việc này';
      END IF;

      UPDATE communities SET config = v_new, updated_at = now() WHERE id = v_cid;
      RETURN v_new;
    END $fn$;
  `);

  // -------------------------------------------------------------------------
  // 6. Chỗ (3): `fn_trust_recount` nay hỏi ai đang gọi.
  //
  // Hình dạng giống `fn_acting_member`: có đóng dấu ⇒ ép cùng cộng đồng;
  // không đóng dấu nhưng là chủ bảng ⇒ đường của hệ thống (trigger đếm lại do
  // migration/psql/tác vụ định kỳ kích hoạt) ⇒ đi qua; không đóng dấu và
  // không phải chủ bảng ⇒ `NO_ACTOR`.
  //
  // Không dùng thẳng `fn_acting_member` vì hàm đó nhận `TG_RELID` của một
  // trigger; ở đây không có trigger nào. Dùng `session_user` với cùng lý do
  // đã ghi ở mục 2 (bên trong SECURITY DEFINER, `current_user` là chủ hàm).
  //
  // Thân hàm bên dưới GIỮ NGUYÊN từng chữ của migration 023 — chỉ thêm khối
  // kiểm ở đầu. Chép lại toàn bộ là cái giá của `CREATE OR REPLACE`; đổi lại
  // `t12-trust` (15 bài, có đột biến trên cả bốn chỉ số) canh phần thân.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_trust_recount(p_member uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid;
            v_actor uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
            v_owner name;
    BEGIN
      SELECT community_id INTO v_cid FROM members WHERE id = p_member;
      IF v_cid IS NULL THEN RETURN; END IF;   -- không có người thì không có gì để đếm

      IF v_actor IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM members WHERE id = v_actor AND community_id = v_cid) THEN
          RAISE EXCEPTION 'TRUST_RECOUNT_DENIED'
            USING DETAIL = 'không đếm lại uy tín cho người của cộng đồng khác';
        END IF;
      ELSE
        SELECT pg_get_userbyid(relowner) INTO v_owner
          FROM pg_class WHERE oid = 'member_trust_stats'::regclass;
        IF session_user IS DISTINCT FROM v_owner THEN
          RAISE EXCEPTION 'NO_ACTOR' USING DETAIL = 'giao dịch không đóng dấu người thực hiện';
        END IF;
      END IF;

      INSERT INTO member_trust_stats (member_id, community_id, confirmed_works, manual_works,
                                      distinct_requesters, repeat_requesters, computed_at)
      WITH done AS (
        -- Việc mà p_member tham gia VÀ đã đủ xác nhận của MỌI người tham gia.
        -- Thiếu một người thì hàng này không tồn tại — cùng điều kiện với
        -- fn_work_edge, để "có cạnh" và "được tính việc" không bao giờ lệch nhau.
        SELECT w.id, w.source_type, w.reviewed_at, me.role AS my_role
          FROM work_records w
          JOIN work_participants me ON me.work_record_id = w.id
                                   AND me.member_id = p_member
                                   AND me.community_id = v_cid
         WHERE w.community_id = v_cid
           AND NOT EXISTS (
                 SELECT 1 FROM work_participants p
                  WHERE p.work_record_id = w.id
                    AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                                     WHERE c.work_record_id = p.work_record_id
                                       AND c.member_id = p.member_id))
      ),
      counted AS (
        -- LỚP 1 của mục 4.4, và đây là chỗ DUY NHẤT nó được viết ra.
        SELECT * FROM done WHERE source_type <> 'manual' OR reviewed_at IS NOT NULL
      ),
      reqs AS (
        -- "Người đã NHỜ" = người mang vai 'receiver' trên việc mà p_member mang
        -- vai 'doer'. Kế hoạch đếm mọi người tham gia khác bất kể vai, tức người
        -- đã GIÚP mình cũng bị đếm là người đã NHỜ mình — hai chiều ngược nhau
        -- gộp làm một thì chỉ số mất hết ý nghĩa. Xem task-12-report.
        --
        -- Đếm trên CTE counted chứ không trên done: một bản ghi manual chưa qua
        -- approver là đúng thứ mục 4.4 sinh ra để không tin, nên nó cũng không
        -- được đẻ ra tín hiệu uy tín ở cửa bên cạnh.
        SELECT o.member_id, count(DISTINCT c.id) AS n
          FROM counted c
          JOIN work_participants o ON o.work_record_id = c.id
                                  AND o.member_id <> p_member
                                  AND o.role = 'receiver'
                                  AND o.community_id = v_cid
         WHERE c.my_role = 'doer'
         GROUP BY o.member_id
      )
      SELECT p_member, v_cid,
             (SELECT count(*) FROM counted),
             (SELECT count(*) FROM done WHERE source_type = 'manual'),
             (SELECT count(*) FROM reqs),
             (SELECT count(*) FROM reqs WHERE n >= 2),
             now()
      ON CONFLICT (member_id) DO UPDATE SET
        community_id        = EXCLUDED.community_id,
        confirmed_works     = EXCLUDED.confirmed_works,
        manual_works        = EXCLUDED.manual_works,
        distinct_requesters = EXCLUDED.distinct_requesters,
        repeat_requesters   = EXCLUDED.repeat_requesters,
        computed_at         = now();
    END $fn$;
  `);

  // -------------------------------------------------------------------------
  // 7. Chỗ (4): ba hàm còn `EXECUTE` cho PUBLIC.
  //
  // Không hàm nào trong ba hàm này khai thác được hôm nay — và đó chính là lý
  // do phải thu về: "an toàn vì PostgreSQL từ chối gọi hàm trigger" và "an
  // toàn vì thiếu quyền CREATE trên schema" đều là bảo vệ đến từ chỗ khác,
  // không đến từ bảng quyền. `t27` khẳng định KHÔNG hàm nào trong `public`
  // vừa là `SECURITY DEFINER` vừa để `EXECUTE` cho PUBLIC.
  // -------------------------------------------------------------------------
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_member_bootstrap() FROM PUBLIC`);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_work_edge() FROM PUBLIC`);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_audit_new_partition(date) FROM PUBLIC`);

  // BỐN HÀM NỮA, và bốn hàm này KHÔNG cùng loại vô hại với ba hàm trên — đây
  // là phát hiện của probe mục 3 danh sách tấn công, không phải một việc dọn
  // dẹp cho gọn:
  //
  //   auth_lookup          trả về password_hash
  //   contact_read         trả về số điện thoại
  //   contact_upsert       GHI số điện thoại
  //   join_secret_consume  trả về số điện thoại + băm mật khẩu, và ĐỐT hàng gốc
  //
  // Bốn migration 006/008/009a/012 đều viết GRANT EXECUTE ... TO app_role mà
  // KHÔNG viết REVOKE ... FROM PUBLIC trước, nên `EXECUTE` mặc định cho PUBLIC
  // vẫn còn nguyên. Hôm nay cụm chỉ có `app_role` và chủ sở hữu nên không khai
  // thác được — tức đúng khuôn "an toàn nhờ may mắn" mà mục 3 danh sách tấn
  // công đi tìm: một vai CSDL thứ ba (bản sao chỉ-đọc, người phân tích, công
  // cụ giám sát) là thứ hoàn toàn bình thường để thêm ở giai đoạn sau, và
  // ngày thêm nó là ngày cả bốn cửa mở ra cùng lúc mà không ai đụng vào bốn
  // migration ấy. Migration 023 đã làm đúng cho `fn_trust_recount`; đây là bốn
  // chỗ còn lại.
  await knex.raw(`REVOKE EXECUTE ON FUNCTION auth_lookup(uuid, text) FROM PUBLIC`);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION contact_read(uuid, text) FROM PUBLIC`);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION contact_upsert(uuid, text, text) FROM PUBLIC`);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION join_secret_consume(uuid) FROM PUBLIC`);
  // `fn_privacy_state` và `fn_acting_member` không phải SECURITY DEFINER nhưng
  // đều đọc dữ liệu quyết định quyền riêng tư — thu về cho cùng một mức.
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_privacy_state(uuid, uuid, text) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION auth_lookup(uuid, text) TO ??`, [user]);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO ??`, [user]);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_upsert(uuid, text, text) TO ??`, [user]);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO ??`, [user]);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_privacy_state(uuid, uuid, text) TO ??`, [user]);
  // `fn_audit_new_partition` vẫn phải gọi được bởi chủ bảng (migration 007 tự
  // gọi nó, và tác vụ định kỳ của Task 18 sẽ gọi) — chủ hàm luôn có EXECUTE.
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_member_role_guard ON member_roles;
    DROP FUNCTION IF EXISTS fn_member_role_guard();
    DROP TRIGGER IF EXISTS trg_audit_actor_guard ON audit_log;
    DROP FUNCTION IF EXISTS fn_audit_actor_guard();
    DROP FUNCTION IF EXISTS fn_role_grant(uuid, text);
    DROP FUNCTION IF EXISTS fn_role_revoke(uuid, text);
  `);

  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_member_bootstrap() TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_work_edge() TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_audit_new_partition(date) TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION auth_lookup(uuid, text) TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_upsert(uuid, text, text) TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION join_secret_consume(uuid) TO PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_privacy_state(uuid, uuid, text) TO PUBLIC`);

  // Khôi phục nguyên văn thân hàm của 028 và 023.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_community_config_apply(p_action uuid) RETURNS jsonb
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

    CREATE OR REPLACE FUNCTION fn_trust_recount(p_member uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE v_cid uuid;
    BEGIN
      SELECT community_id INTO v_cid FROM members WHERE id = p_member;
      IF v_cid IS NULL THEN RETURN; END IF;

      INSERT INTO member_trust_stats (member_id, community_id, confirmed_works, manual_works,
                                      distinct_requesters, repeat_requesters, computed_at)
      WITH done AS (
        -- Việc mà p_member tham gia VÀ đã đủ xác nhận của MỌI người tham gia.
        -- Thiếu một người thì hàng này không tồn tại — cùng điều kiện với
        -- fn_work_edge, để "có cạnh" và "được tính việc" không bao giờ lệch nhau.
        SELECT w.id, w.source_type, w.reviewed_at, me.role AS my_role
          FROM work_records w
          JOIN work_participants me ON me.work_record_id = w.id
                                   AND me.member_id = p_member
                                   AND me.community_id = v_cid
         WHERE w.community_id = v_cid
           AND NOT EXISTS (
                 SELECT 1 FROM work_participants p
                  WHERE p.work_record_id = w.id
                    AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                                     WHERE c.work_record_id = p.work_record_id
                                       AND c.member_id = p.member_id))
      ),
      counted AS (
        -- LỚP 1 của mục 4.4, và đây là chỗ DUY NHẤT nó được viết ra.
        SELECT * FROM done WHERE source_type <> 'manual' OR reviewed_at IS NOT NULL
      ),
      reqs AS (
        -- "Người đã NHỜ" = người mang vai 'receiver' trên việc mà p_member mang
        -- vai 'doer'. Kế hoạch đếm mọi người tham gia khác bất kể vai, tức người
        -- đã GIÚP mình cũng bị đếm là người đã NHỜ mình — hai chiều ngược nhau
        -- gộp làm một thì chỉ số mất hết ý nghĩa. Xem task-12-report.
        --
        -- Đếm trên CTE counted chứ không trên done: một bản ghi manual chưa qua
        -- approver là đúng thứ mục 4.4 sinh ra để không tin, nên nó cũng không
        -- được đẻ ra tín hiệu uy tín ở cửa bên cạnh.
        SELECT o.member_id, count(DISTINCT c.id) AS n
          FROM counted c
          JOIN work_participants o ON o.work_record_id = c.id
                                  AND o.member_id <> p_member
                                  AND o.role = 'receiver'
                                  AND o.community_id = v_cid
         WHERE c.my_role = 'doer'
         GROUP BY o.member_id
      )
      SELECT p_member, v_cid,
             (SELECT count(*) FROM counted),
             (SELECT count(*) FROM done WHERE source_type = 'manual'),
             (SELECT count(*) FROM reqs),
             (SELECT count(*) FROM reqs WHERE n >= 2),
             now()
      ON CONFLICT (member_id) DO UPDATE SET
        community_id        = EXCLUDED.community_id,
        confirmed_works     = EXCLUDED.confirmed_works,
        manual_works        = EXCLUDED.manual_works,
        distinct_requesters = EXCLUDED.distinct_requesters,
        repeat_requesters   = EXCLUDED.repeat_requesters,
        computed_at         = now();
    END $fn$;
  `);

  await knex.raw(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key LIKE 'ops.%')`);
  await knex.raw(`DELETE FROM permissions WHERE key LIKE 'ops.%'`);
}
