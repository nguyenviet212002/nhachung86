// Quỹ Hội — spec mục 11 dòng `020_fund`, mục 4.5 (hai approver) và mục 4.8
// (chữ ký là bút toán).
//
// BỐN THỨ ĐƯỢC ÉP Ở ĐÂY:
//   1. Bút toán từ 1 triệu trở lên cần 2 chữ ký approver hợp lệ, kiểm lúc COMMIT.
//   2. Gỡ chữ ký cũng bị kiểm — trigger trên CHÍNH bảng chữ ký (mục 4.8).
//   3. Bút toán đã `locked` thì bất động: không sửa, không xoá.
//   4. Không xoá bút toán bằng đường app_role (REVOKE DELETE).
//
// LỆCH CÓ CHỦ ĐÍCH KHỎI MÃ MẪU ĐẶC TẢ — mục 4.5 và 4.8 đều viết:
//
//     JOIN member_roles mr ON mr.member_id = a.approver_id
//     JOIN roles r ON r.id = mr.role_id AND r.key = 'approver'
//
// KHÔNG có `mr.community_id`. Đây là lần thứ BẢY của cùng một họ lỗi trong dự
// án (Ruling T7-a, T8-d, hai chỗ ở Task 9, mã mẫu contact_upsert mục 4.7,
// Ruling T10-a). Hậu quả cụ thể: một người mang vai approver ở cộng đồng B ký
// hợp lệ cho bút toán 50 triệu của cộng đồng A. Không ai ở cộng đồng A bầu họ,
// và cộng đồng A không có cách nào biết. Đã thêm `mr.community_id = <cộng đồng
// của bút toán>` vào cả hai hàm, cộng khoá ngoại ghép trên chính bảng chữ ký
// để CSDL chặn từ lúc GHI chứ không phải lúc ĐẾM.
//
// LỆCH THỨ HAI: mã mẫu mục 4.5 đếm `count(*)` chứ không `count(DISTINCT)`.
// PRIMARY KEY (entry_id, approver_id) đã chặn ký hai lần nên hôm nay hai cách
// đếm bằng nhau — nhưng `count(*)` qua một JOIN sang member_roles sẽ đếm MỘT
// người thành HAI nếu người đó được gán vai 'approver' hai lần (member_roles có
// PRIMARY KEY (member_id, role_id) nên không xảy ra hôm nay, song đó là ràng
// buộc của một bảng KHÁC, và luật "hai người" không nên phụ thuộc vào nó).
// Dùng `count(DISTINCT a.approver_id)` để câu đếm tự đứng vững.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE fund_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      -- amount CÓ DẤU: dương là thu, âm là chi. Đặc tả dùng abs(amount) ở cả
      -- hai hàm nên đây là hình dạng nó giả định.
      amount numeric(14,2) NOT NULL CHECK (amount <> 0),
      purpose text NOT NULL,
      occurred_on date NOT NULL DEFAULT current_date,
      activity_id uuid,
      -- locked: bút toán đã chốt sổ, không đụng vào nữa
      locked boolean NOT NULL DEFAULT false,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fund_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (created_by, community_id)  REFERENCES members (id, community_id),
      FOREIGN KEY (activity_id, community_id) REFERENCES activities (id, community_id)
    );
    CREATE INDEX idx_fund_book ON fund_entries (community_id, occurred_on DESC);

    CREATE TABLE fund_entry_approvals (
      entry_id    uuid NOT NULL,
      approver_id uuid NOT NULL,
      -- community_id KHÔNG có trong mã mẫu đặc tả. Thêm vào để dùng được khoá
      -- ngoại GHÉP ở cả hai chiều: CSDL tự chặn người của cộng đồng khác ký,
      -- thay vì trông vào câu đếm trong trigger nhớ lọc.
      community_id uuid NOT NULL REFERENCES communities(id),
      signed_at   timestamptz NOT NULL DEFAULT now(),
      ip inet,
      PRIMARY KEY (entry_id, approver_id),          -- một người không ký hai lần
      FOREIGN KEY (entry_id, community_id)    REFERENCES fund_entries (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (approver_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE transparency_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      period text NOT NULL,
      title text NOT NULL,
      body text,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
      published_at timestamptz,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT report_id_cid UNIQUE (id, community_id),
      UNIQUE (community_id, period),
      CONSTRAINT report_published_pair CHECK ((status = 'published') = (published_at IS NOT NULL)),
      FOREIGN KEY (created_by, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE report_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      report_id uuid NOT NULL,
      version int NOT NULL CHECK (version > 0),
      body text,
      edited_by uuid NOT NULL,
      edited_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (report_id, version),
      FOREIGN KEY (report_id, community_id) REFERENCES transparency_reports (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (edited_by, community_id) REFERENCES members (id, community_id)
    );
  `);

  // -------------------------------------------------------------------------
  // Ngưỡng "hai approver" là CHÍNH SÁCH CỦA CỘNG ĐỒNG, không phải hằng số của
  // nền tảng — cùng lập luận với manual_pair_quota ở migration 025. Đọc từ
  // communities.config, dự phòng 1.000.000 đúng như đặc tả.
  //
  // Một hàm dùng chung cho cả hai trigger: MỘT định nghĩa của "đã đủ chữ ký",
  // nên hai trigger không thể trôi dạt khỏi nhau. Đây là bài học của chính
  // Task 12 (fn_trust_recount vs. trigger đếm) áp vào đây trước khi nó xảy ra.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_fund_valid_signatures(p_entry uuid) RETURNS int
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT count(DISTINCT a.approver_id)::int
        FROM fund_entry_approvals a
        JOIN fund_entries e ON e.id = a.entry_id
        JOIN member_roles mr ON mr.member_id = a.approver_id
                            AND mr.community_id = e.community_id   -- CÙNG cộng đồng
        JOIN roles r ON r.id = mr.role_id AND r.key = 'approver'
       WHERE a.entry_id = p_entry
         AND a.community_id = e.community_id
         AND a.approver_id <> e.created_by;                        -- không tự ký
    $fn$;

    CREATE FUNCTION fn_fund_threshold(p_community uuid) RETURNS numeric
    LANGUAGE sql STABLE SET search_path = public AS $fn$
      SELECT coalesce((SELECT (config->>'fund_two_approver_threshold')::numeric
                         FROM communities WHERE id = p_community), 1000000);
    $fn$;
  `);

  await knex.raw(`
    CREATE FUNCTION fn_fund_two_approvers() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_n int;
    BEGIN
      IF abs(NEW.amount) < fn_fund_threshold(NEW.community_id) THEN RETURN NULL; END IF;
      v_n := fn_fund_valid_signatures(NEW.id);
      IF v_n < 2 THEN
        RAISE EXCEPTION 'FUND_TWO_APPROVERS_REQUIRED'
          USING DETAIL = format('mới có %s chữ ký approver hợp lệ', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    -- Hoãn tới COMMIT: lúc ghi bút toán chưa có chữ ký nào, nên BEFORE INSERT
    -- sai về nguyên tắc chứ không chỉ bất tiện. Bút toán và hai chữ ký ghi
    -- trong cùng giao dịch; kiểm tra chạy khi cả ba đã có mặt.
    CREATE CONSTRAINT TRIGGER trg_fund_two_approvers
      AFTER INSERT OR UPDATE ON fund_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_fund_two_approvers();
  `);

  await knex.raw(`
    -- Mục 4.8 nguyên văn: trg_fund_two_approvers là trigger TRÊN fund_entries,
    -- nên nó KHÔNG chạy khi ai đó động vào fund_entry_approvals. Giao dịch 1
    -- ghi bút toán 2 triệu kèm 2 chữ ký (qua kiểm); giao dịch 2 xoá một chữ ký
    -- — và ràng buộc bảo vệ tiền của Hội bị gỡ trong im lặng.
    CREATE FUNCTION fn_fund_sig_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_entry uuid; v_amount numeric; v_locked boolean; v_cid uuid; v_n int;
    BEGIN
      -- TG_OP tường minh, KHÔNG coalesce(NEW, OLD): trong plpgsql, NEW chưa được
      -- gán ở trigger DELETE và OLD chưa được gán ở trigger INSERT.
      IF TG_OP = 'DELETE' THEN v_entry := OLD.entry_id; ELSE v_entry := NEW.entry_id; END IF;

      SELECT amount, locked, community_id INTO v_amount, v_locked, v_cid
        FROM fund_entries WHERE id = v_entry;
      IF v_amount IS NULL THEN RETURN NULL; END IF;              -- bút toán đã biến mất

      IF TG_OP = 'INSERT' AND v_locked THEN
        RAISE EXCEPTION 'FUND_ENTRY_LOCKED'
          USING DETAIL = 'không thêm chữ ký vào bút toán đã khóa';
      END IF;

      IF abs(v_amount) < fn_fund_threshold(v_cid) THEN RETURN NULL; END IF;

      v_n := fn_fund_valid_signatures(v_entry);
      IF v_n < 2 THEN
        RAISE EXCEPTION 'FUND_TWO_APPROVERS_REQUIRED'
          USING DETAIL = format('bút toán còn %s chữ ký approver hợp lệ', v_n);
      END IF;
      RETURN NULL;
    END $fn$;

    CREATE CONSTRAINT TRIGGER trg_fund_sig_guard
      AFTER INSERT OR UPDATE OR DELETE ON fund_entry_approvals
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_fund_sig_guard();
  `);

  await knex.raw(`
    -- Bút toán đã khoá là bất động (mục 4.5). Khoá được (false -> true) nhưng
    -- không mở lại được, và không sửa được gì khác sau đó.
    CREATE FUNCTION fn_fund_entry_locked() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      -- TG_OP tường minh, và nhánh DELETE phải RETURN OLD chứ không RETURN NEW.
      -- Trong trigger DELETE, NEW không được gán; một BEFORE DELETE trả NULL
      -- nghĩa là HUỶ lệnh xoá — tức bút toán chưa khoá sẽ "xoá thành công" mà
      -- không hàng nào biến mất. Hỏng âm thầm, đúng loại tệ nhất.
      IF TG_OP = 'DELETE' THEN
        IF OLD.locked THEN
          RAISE EXCEPTION 'FUND_ENTRY_LOCKED' USING DETAIL = 'bút toán đã khóa, không xoá được';
        END IF;
        RETURN OLD;
      END IF;

      IF OLD.locked THEN
        RAISE EXCEPTION 'FUND_ENTRY_LOCKED'
          USING DETAIL = 'bút toán đã khóa, không sửa được nữa';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_fund_entry_locked
      BEFORE UPDATE OR DELETE ON fund_entries
      FOR EACH ROW EXECUTE FUNCTION fn_fund_entry_locked();
  `);

  await knex.raw(`
    -- Bảng mục 4.8: fund_entries SELECT/INSERT/UPDATE (không xoá được);
    -- fund_entry_approvals SELECT/INSERT (chữ ký không gỡ được);
    -- report_versions SELECT/INSERT (lịch sử phiên bản).
    REVOKE ALL ON fund_entries FROM ??;
    GRANT SELECT, INSERT, UPDATE ON fund_entries TO ??;
    REVOKE ALL ON fund_entry_approvals FROM ??;
    GRANT SELECT, INSERT ON fund_entry_approvals TO ??;
    REVOKE ALL ON transparency_reports FROM ??;
    GRANT SELECT, INSERT, UPDATE ON transparency_reports TO ??;
    REVOKE ALL ON report_versions FROM ??;
    GRANT SELECT, INSERT ON report_versions TO ??;
  `, [user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_fund_entry_locked ON fund_entries;
    DROP TRIGGER IF EXISTS trg_fund_sig_guard ON fund_entry_approvals;
    DROP TRIGGER IF EXISTS trg_fund_two_approvers ON fund_entries;
    DROP FUNCTION IF EXISTS fn_fund_entry_locked();
    DROP FUNCTION IF EXISTS fn_fund_sig_guard();
    DROP FUNCTION IF EXISTS fn_fund_two_approvers();
    DROP FUNCTION IF EXISTS fn_fund_threshold(uuid);
    DROP FUNCTION IF EXISTS fn_fund_valid_signatures(uuid);
    DROP TABLE IF EXISTS report_versions;
    DROP TABLE IF EXISTS transparency_reports;
    DROP TABLE IF EXISTS fund_entry_approvals;
    DROP TABLE IF EXISTS fund_entries;
  `);
}
