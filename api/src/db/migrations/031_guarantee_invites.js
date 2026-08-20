// Link mời bảo lãnh — QĐ-1 của người dùng (progress.md, mục "Quyết định của
// người dùng 2026-08-20").
//
// VÌ SAO CÓ BẢNG NÀY. `join_requests.referrer_id` trước đây đến từ một ô nhập
// trên form đăng ký công khai. Ba hệ quả người dùng chỉ ra:
//   (a) ai cũng khai được tên bất kỳ ai làm người bảo lãnh cho mình, và người
//       bị khai không hề hay biết cho tới lúc nhận thông báo xác nhận gặp mặt
//       — nguyên tắc 1 bị thủng từ bên trong;
//   (b) ô nhập ấy LÀ một máy dò danh sách thành viên;
//   (c) thứ tự nhân quả thật ngoài đời là người bảo lãnh hành động TRƯỚC.
// Link mời đảo lại đúng thứ tự đó: người bảo lãnh phát link, người được mời
// mang link tới. Không ai gõ số điện thoại hay uuid của ai.
//
// LƯU BĂM, KHÔNG LƯU TOKEN. `token_hash` là sha256 hex của chuỗi ngẫu nhiên
// 256 bit đi trong đường link. Token thô chỉ tồn tại đúng một lần, trong thân
// phản hồi HTTP trả về cho người phát link. Nó không vào log, không vào thông
// báo lỗi, không vào `audit_log`.
//
// BỐN ĐIỂM BẮT BUỘC và chỗ cưỡng chế chúng:
//   1. Dùng một lần — `guarantee_invite_claim()` (khoá hàng + UPDATE có điều
//      kiện) và `fn_guarantee_invite_frozen` (lưới thứ hai).
//   2. Link chưa dùng CŨNG tiêu suất — `fn_guarantee_slots_used()`, dùng chung
//      cho cả hai cổng (`fn_guarantee_quota` lúc lập đơn, `fn_guarantee_invite_quota`
//      lúc phát link).
//   3. Thu hồi được, suất trả lại ngay — `revoked_at` nằm trong vế WHERE của
//      hàm đếm, nên không cần bước dọn dẹp nào.
//   4. Không thay thế bước xác nhận gặp mặt — migration này KHÔNG chạm
//      `met_confirmed_at`, `met_confirmed_by` hay `trg_member_status_gate`.
//      Đó là một khẳng định về việc KHÔNG làm gì, nên bài test canh nó
//      (t29) chứ không phải mã.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE guarantee_invites (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      referrer_id uuid NOT NULL,

      -- Chỉ băm. Ràng buộc hình dạng ở ngay cột để một lần lỡ tay lưu token
      -- thô (chuỗi base64url 43 ký tự) hỏng ngay lúc ghi, chứ không nằm im
      -- trong bảng cho tới lúc có người đọc log.
      token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),

      -- AI BẤM NÚT, tách khỏi AI ĐỨNG RA BẢO LÃNH. Hai cột này bằng nhau ở
      -- đường thường; khác nhau ở đường dự phòng (approver phát hộ). Nếu chỉ
      -- có "referrer_id" thì hai trường hợp trông giống hệt nhau trong nhật ký
      -- — và khi đó đường vòng VẪN LÀ cửa sau im lặng, chỉ khác là có ghi chép.
      created_by uuid NOT NULL,
      on_behalf_reason_code text,
      on_behalf_reason text,

      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
      used_at timestamptz,
      used_by_join_request uuid,
      revoked_at timestamptz,
      revoked_reason text,

      CONSTRAINT gi_id_cid UNIQUE (id, community_id),

      -- Khoá ngoại GHÉP, không phải đơn cột. Lỗi "quên community_id" đã lặp
      -- bảy lần trong dự án này; ở đây nó có hậu quả cụ thể: một link của cộng
      -- đồng B trỏ referrer sang thành viên của cộng đồng A sẽ tiêu suất của A
      -- theo hạn mức đọc từ config của B.
      CONSTRAINT gi_referrer_same_community
        FOREIGN KEY (referrer_id, community_id) REFERENCES members (id, community_id),
      CONSTRAINT gi_creator_same_community
        FOREIGN KEY (created_by, community_id) REFERENCES members (id, community_id),
      CONSTRAINT gi_jr_same_community
        FOREIGN KEY (used_by_join_request, community_id) REFERENCES join_requests (id, community_id),

      CONSTRAINT gi_expires_after_created CHECK (expires_at > created_at),

      -- Đơn nối vào link thì link phải đã được dùng. Chiều ngược lại
      -- (dùng rồi thì phải có đơn) KHÔNG kiểm ở đây được vì hai việc xảy ra
      -- trong cùng một giao dịch nhưng không cùng một câu lệnh — xem
      -- "trg_guarantee_invite_use_complete" (hoãn tới COMMIT) bên dưới.
      CONSTRAINT gi_used_needs_used_at
        CHECK (used_by_join_request IS NULL OR used_at IS NOT NULL),
      CONSTRAINT gi_revoked_pair
        CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
      CONSTRAINT gi_revoked_reason_nonempty
        CHECK (revoked_reason IS NULL OR length(btrim(revoked_reason)) >= 5),

      -- Lưới cuối cho đường dự phòng. Lưới THỨ NHẤT là trigger bên dưới (nó
      -- ném ra mã lỗi dịch được); CHECK này ở lại phòng khi có ai đó gỡ
      -- trigger, và nó chặn cả đường owner/psql.
      CONSTRAINT gi_on_behalf_reason CHECK (
        (created_by = referrer_id
           AND on_behalf_reason_code IS NULL AND on_behalf_reason IS NULL)
        OR
        (created_by <> referrer_id
           AND on_behalf_reason_code IS NOT NULL
           AND on_behalf_reason IS NOT NULL
           AND length(btrim(on_behalf_reason)) >= 20)
      ),
      CONSTRAINT gi_on_behalf_reason_code CHECK (
        on_behalf_reason_code IS NULL OR on_behalf_reason_code IN
          ('khong_mo_duoc_link','khong_dung_dien_thoai_thong_minh','link_het_han','khac')
      )
    );

    -- Chỉ mục hạn mức: vị từ phải khớp CHÍNH XÁC vế WHERE của nhánh thứ hai
    -- trong fn_guarantee_slots_used. "expires_at" không vào vị từ được (now()
    -- không phải hằng số) nên nó là cột của chỉ mục, không phải điều kiện.
    CREATE INDEX idx_gi_quota ON guarantee_invites (referrer_id, expires_at)
      WHERE used_at IS NULL AND revoked_at IS NULL;

    -- Đường tra cứu lúc người được mời mang link tới: token_hash đã UNIQUE nên
    -- đã có chỉ mục; chỉ mục dưới đây cho màn "những link tôi đã phát".
    CREATE INDEX idx_gi_referrer ON guarantee_invites (community_id, referrer_id, created_at DESC);
  `);

  // Link đã phát là một sự việc đã xảy ra. Xoá nó là xoá đúng bằng chứng
  // "người bảo lãnh đã chủ động mời" — cùng lý do join_requests bị REVOKE DELETE.
  await knex.raw(`REVOKE DELETE ON guarantee_invites FROM ??`, [user]);

  // -------------------------------------------------------------------------
  // MỘT hàm đếm cho CẢ HAI cổng.
  //
  // Vì sao không viết vế WHERE ấy hai lần: `idx_jr_quota` (migration 009) đã
  // kèm sẵn lời cảnh báo "vị từ phải khớp CHÍNH XÁC vế WHERE của
  // fn_guarantee_quota" — tức dự án đã biết đây là chỗ trôi dạt. Nay có tới hai
  // cổng cùng phải trả lời một câu hỏi ("người này đã hứa với bao nhiêu người
  // rồi"), nên hai bản sao sẽ lệch nhau ở lần sửa thứ nhất. Một hàm, hai người
  // gọi.
  //
  // ĐIỂM 2 CỦA QĐ-1 nằm ở nhánh thứ hai: link CÒN HẠN, CHƯA DÙNG, CHƯA THU HỒI
  // cũng tính là một suất. Người dùng tự chỉ ra chỗ dễ sót — nếu chỉ đếm ở
  // join_requests thì một người phát 10 link rồi để 10 người đăng ký cùng lúc
  // vẫn bị khoá tư vấn chặn, NHƯNG người bảo lãnh đã lỡ hứa với 10 người. Chặn
  // lúc phát link mới là chặn đúng lúc.
  //
  // Ba trạng thái làm link NHẢ suất ra, và cả ba đều nằm trong vế WHERE nên
  // suất trả lại NGAY, không cần một công việc dọn dẹp nào chạy nền:
  //   * đã dùng  ⇒ suất chuyển sang hàng join_requests tương ứng (nhánh 1);
  //   * hết hạn  ⇒ lời hứa hết hiệu lực;
  //   * thu hồi  ⇒ điểm 3 của QĐ-1.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_guarantee_slots_used(
      p_referrer uuid, p_community uuid, p_exclude_jr uuid, p_exclude_invite uuid
    ) RETURNS int LANGUAGE sql STABLE AS $fn$
      SELECT (
        (SELECT count(*) FROM join_requests jr
          WHERE jr.referrer_id = p_referrer
            AND jr.community_id = p_community
            AND jr.id IS DISTINCT FROM p_exclude_jr
            AND jr.created_at > now() - interval '12 months'
            AND (jr.status IN ('pending','met_confirmed','approved')
              OR (jr.status = 'rejected' AND jr.reject_reason_code = 'referrer_misrepresented')))
        +
        (SELECT count(*) FROM guarantee_invites gi
          WHERE gi.referrer_id = p_referrer
            AND gi.community_id = p_community
            AND gi.id IS DISTINCT FROM p_exclude_invite
            AND gi.used_at IS NULL
            AND gi.revoked_at IS NULL
            AND gi.expires_at > now())
      )::int;
    $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_guarantee_slots_used(uuid,uuid,uuid,uuid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_guarantee_slots_used(uuid,uuid,uuid,uuid) TO ??`, [user]);

  await knex.raw(`
    CREATE FUNCTION fn_guarantee_cap(p_referrer uuid, p_community uuid) RETURNS int
    LANGUAGE sql STABLE AS $fn$
      SELECT coalesce((SELECT (config->>'guarantee_quota_per_year')::int
                         FROM communities WHERE id = p_community), 3)
           + coalesce((SELECT sum(extra_slots)::int FROM guarantee_quota_overrides
                        WHERE referrer_id = p_referrer
                          AND community_id = p_community
                          AND valid_until > now()), 0);
    $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION fn_guarantee_cap(uuid,uuid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_guarantee_cap(uuid,uuid) TO ??`, [user]);

  // -------------------------------------------------------------------------
  // Cổng 1 — lúc LẬP ĐƠN. Thân hàm cũ của migration 009 giữ nguyên từng chữ,
  // chỉ thay hai câu đếm bằng hai lời gọi hàm chung ở trên. Hành vi cũ không
  // đổi khi người bảo lãnh chưa có link nào còn hạn (v_open = 0) — đó là lý do
  // t08 và t12 không phải sửa một dòng nào.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_cap int;
    BEGIN
      IF NEW.referrer_id IS NULL THEN
        RAISE EXCEPTION 'REFERRER_REQUIRED';         -- nguyên tắc 1: không bảo lãnh ẩn danh
      END IF;
      IF NEW.status NOT IN ('pending','met_confirmed','approved') THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      v_used := fn_guarantee_slots_used(NEW.referrer_id, NEW.community_id, NEW.id, NULL);
      v_cap  := fn_guarantee_cap(NEW.referrer_id, NEW.community_id);

      IF v_used >= v_cap THEN
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  // -------------------------------------------------------------------------
  // Cổng 2 — lúc PHÁT LINK. CÙNG khoá tư vấn (cùng salt 42) với cổng 1: hai
  // cổng đếm chung một quỹ suất, nên chúng phải xếp hàng SAU NHAU chứ không
  // phải mỗi cổng một hàng. Khoá khác nhau thì hai giao dịch "phát link" và
  // "lập đơn" cùng thấy 2/3 và cùng đi qua — đúng bài toán bóng ma mà migration
  // 009 đã mô tả, chỉ khác là nay có hai cửa vào.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_guarantee_invite_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_cap int;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      v_used := fn_guarantee_slots_used(NEW.referrer_id, NEW.community_id, NULL, NEW.id);
      v_cap  := fn_guarantee_cap(NEW.referrer_id, NEW.community_id);

      IF v_used >= v_cap THEN
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_guarantee_invite_quota
      BEFORE INSERT ON guarantee_invites
      FOR EACH ROW EXECUTE FUNCTION fn_guarantee_invite_quota();
  `);

  // -------------------------------------------------------------------------
  // Đường dự phòng, và cái bẫy trong nó.
  //
  // Người dùng nguyên văn: "có thật những anh chị em không mở nổi đường link,
  // nhưng đường vòng đó phải để lại dấu vết, không được là cửa sau im lặng."
  //
  // Ba việc trigger này làm, và mỗi việc đóng một cách biến đường vòng thành
  // cửa sau:
  //   * `created_by` phải là CHÍNH người đang thao tác. Không có vế này thì
  //     approver phát link hộ vẫn ghi được `created_by = referrer_id`, và bản
  //     ghi trông y hệt đường thường — dấu vết bị xoá ngay lúc sinh ra.
  //   * tạo hộ thì người bấm nút phải mang vai `approver` CỦA CHÍNH CỘNG ĐỒNG
  //     NÀY. Không có vế này thì "đường dự phòng" là đường của tất cả mọi người.
  //   * tạo hộ thì lý do là trường BẮT BUỘC, không rỗng, không phải một dấu
  //     tích chuột (>= 20 ký tự sau khi cắt khoảng trắng — cùng ngưỡng với
  //     met_note ở migration 009, cùng lý do).
  //
  // Ép ở CSDL chứ không ở zod: zod canh một đường vào: route. Trigger canh mọi
  // đường vào, kể cả câu SQL mà một task sau viết vội.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_guarantee_invite_creator() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_actor uuid := fn_acting_member(TG_RELID);
    BEGIN
      IF v_actor IS NOT NULL AND NEW.created_by IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'INVITE_CREATOR_MISMATCH'
          USING DETAIL = 'link mời phải mang tên chính người bấm nút phát nó';
      END IF;

      IF NEW.created_by = NEW.referrer_id THEN
        IF NEW.on_behalf_reason_code IS NOT NULL OR NEW.on_behalf_reason IS NOT NULL THEN
          RAISE EXCEPTION 'INVITE_REASON_REQUIRED'
            USING DETAIL = 'người tự phát link cho mình thì không có ai để ghi là phát hộ';
        END IF;
        RETURN NEW;
      END IF;

      -- Từ đây trở xuống là đường dự phòng.
      IF NOT EXISTS (
        SELECT 1 FROM member_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.member_id = NEW.created_by
           AND mr.community_id = NEW.community_id
           AND r.key = 'approver'
      ) THEN
        RAISE EXCEPTION 'INVITE_ON_BEHALF_DENIED'
          USING DETAIL = 'chỉ ban duyệt của chính cộng đồng này mới phát link hộ người khác';
      END IF;

      IF NEW.on_behalf_reason_code IS NULL
         OR NEW.on_behalf_reason IS NULL
         OR length(btrim(NEW.on_behalf_reason)) < 20 THEN
        RAISE EXCEPTION 'INVITE_REASON_REQUIRED'
          USING DETAIL = 'phát link hộ phải ghi rõ lý do, và lý do không được để trống';
      END IF;

      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_guarantee_invite_creator
      BEFORE INSERT ON guarantee_invites
      FOR EACH ROW EXECUTE FUNCTION fn_guarantee_invite_creator();
  `);

  // -------------------------------------------------------------------------
  // Đóng băng đúng những dữ kiện mà luật hạn mức ĐỌC — cùng khuôn
  // `fn_join_request_frozen` (migration 027, họ D: "luật đọc trạng thái đổi
  // được, và không ai đóng băng trạng thái đó").
  //
  // Ba đường đã tái hiện được nếu không có trigger này:
  //   * kéo `expires_at` về quá khứ ⇒ link biến mất khỏi câu đếm, người bảo
  //     lãnh phát thêm link thứ tư, rồi kéo `expires_at` trở lại;
  //   * đổi `referrer_id` sau khi phát ⇒ suất đã tiêu chuyển sang người khác;
  //   * xoá `used_at` ⇒ link dùng một lần thành link dùng vô hạn (điểm 1).
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_guarantee_invite_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.community_id, NEW.referrer_id, NEW.token_hash, NEW.created_by,
          NEW.created_at, NEW.expires_at, NEW.on_behalf_reason_code, NEW.on_behalf_reason)
         IS DISTINCT FROM
         (OLD.community_id, OLD.referrer_id, OLD.token_hash, OLD.created_by,
          OLD.created_at, OLD.expires_at, OLD.on_behalf_reason_code, OLD.on_behalf_reason) THEN
        RAISE EXCEPTION 'INVITE_FROZEN'
          USING DETAIL = 'cộng đồng, người bảo lãnh, băm token, người phát và hai mốc thời gian là dữ kiện hạn mức đọc, không sửa được';
      END IF;

      -- Đã dùng thì vĩnh viễn đã dùng. Đây là điểm 1 của QĐ-1 nhìn từ phía
      -- UPDATE: "guarantee_invite_claim()" canh cuộc đua, còn vế này canh câu
      -- UPDATE trần mà một task sau có thể viết.
      IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED'
          USING DETAIL = 'link mời chỉ dùng được một lần';
      END IF;
      IF OLD.used_by_join_request IS NOT NULL
         AND NEW.used_by_join_request IS DISTINCT FROM OLD.used_by_join_request THEN
        RAISE EXCEPTION 'INVITE_FROZEN'
          USING DETAIL = 'link mời đã nối với một đơn, không dời sang đơn khác được';
      END IF;

      -- Thu hồi rồi thì không hồi sinh, và không thu hồi được thứ đã dùng —
      -- việc đã xảy ra thì không rút lại bằng một câu UPDATE.
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'INVITE_FROZEN'
          USING DETAIL = 'link đã thu hồi thì không hồi sinh được';
      END IF;
      IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND OLD.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED'
          USING DETAIL = 'link đã có người dùng nên không thu hồi được nữa';
      END IF;
      IF NEW.used_at IS NOT NULL AND OLD.used_at IS NULL THEN
        IF OLD.revoked_at IS NOT NULL THEN
          RAISE EXCEPTION 'INVITE_REVOKED' USING DETAIL = 'link mời đã bị thu hồi';
        END IF;
        IF OLD.expires_at <= now() THEN
          RAISE EXCEPTION 'INVITE_EXPIRED' USING DETAIL = 'link mời đã hết hạn';
        END IF;
      END IF;

      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_guarantee_invite_frozen
      BEFORE UPDATE ON guarantee_invites
      FOR EACH ROW EXECUTE FUNCTION fn_guarantee_invite_frozen();
  `);

  // -------------------------------------------------------------------------
  // "used_at đặt trong CÙNG GIAO DỊCH tạo join_requests" (QĐ-1, điểm 1).
  //
  // Vế đó có hai nửa và CHECK ở cột chỉ giữ được một nửa. Nửa còn lại — đã đốt
  // link thì phải có đơn để lại — không kiểm được ở mức câu lệnh, vì hai việc
  // nằm trong hai câu khác nhau của cùng một giao dịch (phải đốt link TRƯỚC để
  // suất không bị đếm hai lần, mà id của đơn thì chỉ có SAU khi chèn đơn).
  //
  // Ràng buộc HOÃN TỚI COMMIT là công cụ đúng cho hình dạng đó — cùng khuôn
  // `trg_member_status_gate` (migration 010). Nếu không có nó, một giao dịch
  // đốt link rồi bỏ dở giữa chừng vẫn commit được, và người bảo lãnh mất một
  // suất mà không ai nhận được lời mời nào.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_guarantee_invite_use_complete() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v guarantee_invites%ROWTYPE;
    BEGIN
      -- ĐỌC LẠI HÀNG, không đọc NEW. Trigger hoãn tới COMMIT vẫn mang theo ảnh
      -- chụp NEW của ĐÚNG câu lệnh đã kích hoạt nó, không phải trạng thái cuối
      -- giao dịch — mà ở đây câu lệnh kích hoạt là câu đặt used_at, chạy TRƯỚC
      -- câu nối used_by_join_request. Dùng NEW thì luồng hợp lệ cũng chết ở
      -- COMMIT (đã tái hiện). Cùng khuôn trg_member_status_gate (migration 010):
      -- ràng buộc hoãn phải hỏi lại bảng.
      SELECT * INTO v FROM guarantee_invites WHERE id = NEW.id;
      IF NOT FOUND THEN RETURN NEW; END IF;
      IF v.used_at IS NOT NULL AND v.used_by_join_request IS NULL THEN
        RAISE EXCEPTION 'INVITE_USE_INCOMPLETE'
          USING DETAIL = 'link đã đánh dấu là dùng nhưng không đơn nào nối tới';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_guarantee_invite_use_complete
      AFTER INSERT OR UPDATE ON guarantee_invites
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_guarantee_invite_use_complete();
  `);

  // -------------------------------------------------------------------------
  // Nhận link — đường DUY NHẤT đốt một link.
  //
  // VỀ CUỘC ĐUA, và đây là chỗ đề bài chỉ sai chỗ nên phải nói rõ (xem báo
  // cáo): brief bảo dùng `pg_advisory_xact_lock` như Task 8. Nhưng bài toán ở
  // Task 8 là BÓNG MA — đếm những hàng CHƯA TỒN TẠI, và khoá hàng không khoá
  // được thứ chưa có. Ở đây hàng ĐÃ CÓ SẴN, nên `SELECT ... FOR UPDATE` là
  // công cụ đúng: giao dịch thứ hai xếp hàng ngay tại đó, và khi giao dịch thứ
  // nhất commit thì câu SELECT của nó chạy lại trên ảnh chụp MỚI (READ
  // COMMITTED) và thấy `used_at` đã được đặt.
  //
  // Khoá tư vấn vẫn cần, nhưng ở CHỖ KHÁC: `fn_guarantee_invite_quota` ở trên,
  // nơi đúng là bài toán bóng ma của Task 8.
  //
  // Ba lưới cho cùng một luật (dùng một lần), cố ý chồng nhau vì mỗi lưới
  // chặn một đường vào khác nhau: FOR UPDATE chặn cuộc đua; `AND used_at IS
  // NULL` chặn trường hợp ai đó gỡ FOR UPDATE; `trg_guarantee_invite_frozen`
  // chặn câu UPDATE trần không đi qua hàm này.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION guarantee_invite_claim(p_token_hash text, p_community uuid)
    RETURNS TABLE (invite_id uuid, invite_referrer_id uuid)
    LANGUAGE plpgsql AS $fn$
    DECLARE v guarantee_invites%ROWTYPE; v_hit int;
    BEGIN
      SELECT * INTO v FROM guarantee_invites
       WHERE token_hash = p_token_hash AND community_id = p_community
       FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INVITE_NOT_FOUND' USING DETAIL = 'không có link mời nào khớp';
      END IF;
      IF v.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_REVOKED' USING DETAIL = 'link mời đã bị thu hồi';
      END IF;
      IF v.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED' USING DETAIL = 'link mời chỉ dùng được một lần';
      END IF;
      IF v.expires_at <= now() THEN
        RAISE EXCEPTION 'INVITE_EXPIRED' USING DETAIL = 'link mời đã hết hạn';
      END IF;

      UPDATE guarantee_invites SET used_at = now()
       WHERE id = v.id AND used_at IS NULL;
      GET DIAGNOSTICS v_hit = ROW_COUNT;
      IF v_hit = 0 THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED' USING DETAIL = 'link mời chỉ dùng được một lần';
      END IF;

      invite_id := v.id;
      invite_referrer_id := v.referrer_id;
      RETURN NEXT;
    END $fn$;
  `);
  await knex.raw(`REVOKE EXECUTE ON FUNCTION guarantee_invite_claim(text,uuid) FROM PUBLIC`);
  await knex.raw(`GRANT EXECUTE ON FUNCTION guarantee_invite_claim(text,uuid) TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP FUNCTION IF EXISTS guarantee_invite_claim(text,uuid);
    DROP TRIGGER IF EXISTS trg_guarantee_invite_use_complete ON guarantee_invites;
    DROP FUNCTION IF EXISTS fn_guarantee_invite_use_complete();
    DROP TRIGGER IF EXISTS trg_guarantee_invite_frozen ON guarantee_invites;
    DROP FUNCTION IF EXISTS fn_guarantee_invite_frozen();
    DROP TRIGGER IF EXISTS trg_guarantee_invite_creator ON guarantee_invites;
    DROP FUNCTION IF EXISTS fn_guarantee_invite_creator();
    DROP TRIGGER IF EXISTS trg_guarantee_invite_quota ON guarantee_invites;
    DROP FUNCTION IF EXISTS fn_guarantee_invite_quota();
  `);

  // Trả `fn_guarantee_quota` về đúng thân hàm của migration 009 TRƯỚC khi bỏ
  // bảng: hàm chung bên dưới đọc `guarantee_invites`, nên thứ tự ngược lại sẽ
  // để lại một hàm trỏ tới bảng không còn tồn tại.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_extra int; v_cap int;
    BEGIN
      IF NEW.referrer_id IS NULL THEN
        RAISE EXCEPTION 'REFERRER_REQUIRED';
      END IF;
      IF NEW.status NOT IN ('pending','met_confirmed','approved') THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      SELECT count(*) INTO v_used FROM join_requests
       WHERE referrer_id = NEW.referrer_id
         AND community_id = NEW.community_id
         AND id <> NEW.id
         AND created_at > now() - interval '12 months'
         AND (status IN ('pending','met_confirmed','approved')
           OR (status = 'rejected' AND reject_reason_code = 'referrer_misrepresented'));

      SELECT coalesce(sum(extra_slots), 0) INTO v_extra
        FROM guarantee_quota_overrides
       WHERE referrer_id = NEW.referrer_id
         AND community_id = NEW.community_id
         AND valid_until > now();

      v_cap := coalesce((SELECT (config->>'guarantee_quota_per_year')::int
                           FROM communities WHERE id = NEW.community_id), 3) + v_extra;
      IF v_used >= v_cap THEN
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS fn_guarantee_cap(uuid,uuid);
    DROP FUNCTION IF EXISTS fn_guarantee_slots_used(uuid,uuid,uuid,uuid);
    DROP TABLE IF EXISTS guarantee_invites;
  `);
}
