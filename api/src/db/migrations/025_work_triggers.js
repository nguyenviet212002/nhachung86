// Trigger của ba bảng việc — spec mục 4.1 và 4.4.
//
// VÌ SAO TỆP RIÊNG chứ không thêm vào 011_work_records.js như kế hoạch viết:
// Ruling C8. Migration đã chạy thì không sửa — máy đã triển khai sẽ lệch với
// máy mới, và knex không có cách nào biết để chạy lại. Lý do THỨ HAI mà mục 11
// đặc tả nêu ("gắn trigger uy tín trước khi có bảng đếm uy tín là dựng một cửa
// không ai canh") đúng là đã hết hiệu lực vì Task 12 làm cả hai cùng lúc — nhưng
// lý do thứ nhất thì không phụ thuộc vào điều đó. Xem task-12-report.
//
// Số 025 để tệp này chạy SAU 023_trust_stats: khi trigger sinh cạnh và trigger
// hạn mức bắt đầu sống, bảng đếm uy tín đã có mặt. Đây là "nối vào đuôi", thỏa
// điều kiện an toàn của Ruling T9-d một cách hiển nhiên.
//
// TRẬT TỰ TRIGGER: PostgreSQL chạy các trigger cùng thời điểm theo THỨ TỰ TÊN.
// Vì vậy hai trigger BEFORE INSERT trên work_confirmations được đặt tên có số
// thứ tự: luật DANH TÍNH (`fn_self_only`) phải chặn trước luật HẠN MỨC — người
// không phải chính chủ không đáng được biết trạng thái hạn mức của cặp người
// khác, và "SELF_ONLY" là câu trả lời đúng cho việc họ đang làm.
export async function up(knex) {
  // ---------------------------------------------------------------------------
  // fn_self_only — spec mục 4.1. Dùng chung cho work_confirmations (ở đây) và
  // aid_slot_takers (migration 016, Task 13), nên nhận tên cột qua TG_ARGV.
  //
  // Đây là nguyên tắc 1 ở dạng cụ thể nhất: KHÔNG có xác nhận ẩn danh, và không
  // ai ký thay ai. `nullif(current_setting(...), '')` đúng khuôn Ruling T3-b —
  // core/tx.js đặt chuỗi RỖNG khi không có actor, nên so `IS NULL` trần sẽ làm
  // luật "bắt buộc có người thực hiện" không bao giờ kích hoạt.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_self_only() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
  `);

  // ---------------------------------------------------------------------------
  // fn_manual_pair_quota — spec mục 4.4 lớp 2.
  //
  // LỆCH CÓ CHỦ ĐÍCH khỏi mã mẫu đặc tả, và đây là một lỗi thật chứ không phải
  // sở thích: mã mẫu lấy `min(member_id), max(member_id)` của bản ghi rồi chỉ
  // đếm cho ĐÚNG MỘT cặp đó. Với bản ghi hai người thì trùng nhau, nhưng luật
  // được viết ra là "6 bản ghi manual MỖI CẶP / 12 tháng" — với bản ghi ba
  // người (A<B<C) mã mẫu chỉ canh cặp (A,C), còn (A,B) và (B,C) không ai đếm.
  // Sáu bản ghi {A,B} rồi bản thứ bảy {A,B,C} sẽ LỌT, vì cặp (A,C) mới có 1.
  // Ở đây đếm cho MỌI cặp của bản ghi và lấy số lớn nhất.
  //
  // Khóa tư vấn lấy theo TỪNG cặp, THEO THỨ TỰ (lo, hi) cố định — thứ tự cố
  // định là điều kiện để hai giao dịch chồng cặp nhau không khóa chéo nhau.
  //
  // `w.community_id = NEW.community_id` là thừa khi các khóa ngoại ghép ở 011
  // còn nguyên (member quyết định cộng đồng), nhưng giữ lại theo đúng luật của
  // dự án — sáu lần quên lọc community_id thì lưới thứ hai không phải là thừa.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_manual_pair_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE r RECORD; v_n int; v_cap int; v_creator uuid; v_type text;
    BEGIN
      SELECT source_type, created_by INTO v_type, v_creator FROM work_records
       WHERE id = NEW.work_record_id AND community_id = NEW.community_id;
      IF v_type IS DISTINCT FROM 'manual' THEN RETURN NEW; END IF;

      -- Đặc tả mục 4.4 câu cuối: "created_by của bản ghi manual bắt buộc là một
      -- trong những người tham gia". Câu đó chưa có đối tượng SQL nào thực hiện.
      -- Không kiểm được lúc INSERT work_records (chưa có người tham gia nào),
      -- nên chỗ đúng là đây — cửa đầu tiên mà một bản ghi manual phải đi qua để
      -- có giá trị. Thiếu nó, một người dựng được bản ghi việc giữa hai người
      -- KHÁC rồi chờ họ bấm xác nhận, tức người ngoài cuộc mở được hồ sơ việc
      -- cho người trong cuộc.
      IF NOT EXISTS (SELECT 1 FROM work_participants p
                      WHERE p.work_record_id = NEW.work_record_id
                        AND p.community_id = NEW.community_id
                        AND p.member_id = v_creator) THEN
        RAISE EXCEPTION 'MANUAL_CREATOR_NOT_PARTICIPANT'
          USING DETAIL = 'người tạo bản ghi thủ công phải là một trong những người tham gia';
      END IF;

      FOR r IN SELECT a.member_id AS lo, b.member_id AS hi
                 FROM work_participants a
                 JOIN work_participants b ON b.work_record_id = a.work_record_id
                                         AND a.member_id < b.member_id
                                         AND b.community_id = NEW.community_id
                WHERE a.work_record_id = NEW.work_record_id
                  AND a.community_id = NEW.community_id
                ORDER BY a.member_id, b.member_id      -- thứ tự cố định: không khóa chéo
      LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(r.lo::text || r.hi::text, 99));

        SELECT count(DISTINCT w.id) INTO v_n
          FROM work_records w
          JOIN work_participants pa ON pa.work_record_id = w.id AND pa.member_id = r.lo
          JOIN work_participants pb ON pb.work_record_id = w.id AND pb.member_id = r.hi
         WHERE w.source_type = 'manual'
           AND w.community_id = NEW.community_id
           AND w.created_at > now() - interval '12 months';

        -- hạn mức là chính sách của cộng đồng, không phải hằng số của nền tảng
        v_cap := coalesce((SELECT (config->>'manual_pair_quota')::int
                             FROM communities WHERE id = NEW.community_id), 6);
        IF v_n > v_cap THEN
          RAISE EXCEPTION 'MANUAL_PAIR_QUOTA_EXCEEDED'
            USING DETAIL = format('%s bản ghi thủ công giữa hai người trong 12 tháng', v_n);
        END IF;
      END LOOP;
      RETURN NEW;
    END $fn$;
  `);

  // ---------------------------------------------------------------------------
  // fn_work_record_frozen — spec mục 4.1.
  //
  // Đã có xác nhận thì nội dung việc đóng băng: người ta xác nhận MỘT việc cụ
  // thể, không phải ký khống một hàng để người tạo điền lại sau.
  //
  // Bổ sung so với đặc tả: `created_by` và `community_id` cũng nằm trong bộ
  // đóng băng. `created_by` của bản ghi 'manual' là dữ kiện mục 4.4 dựa vào
  // ("người tạo phải là một trong những người tham gia"), nên sửa được nó sau
  // khi đã có xác nhận là mở lại đúng cửa vừa đóng.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_work_record_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF EXISTS (SELECT 1 FROM work_confirmations WHERE work_record_id = OLD.id)
         AND (NEW.done_on, NEW.title, NEW.source_type, NEW.source_id, NEW.created_by, NEW.community_id)
          IS DISTINCT FROM
             (OLD.done_on, OLD.title, OLD.source_type, OLD.source_id, OLD.created_by, OLD.community_id) THEN
        RAISE EXCEPTION 'WORK_RECORD_FROZEN'
          USING DETAIL = 'đã có xác nhận, chỉ còn sửa được reviewed_by/reviewed_at';
      END IF;
      RETURN NEW;
    END $fn$;
  `);

  // ---------------------------------------------------------------------------
  // fn_work_review_gate — "LỚP 1: approver mở khóa" (mục 4.4) ở tầng CSDL.
  //
  // Đặc tả nói rất rõ ý định — bản ghi 'manual' chỉ được tính khi
  // `reviewed_at IS NOT NULL` — nhưng KHÔNG có gì kiểm ai đặt được cột đó.
  // `reviewed_by` chỉ là `REFERENCES members(id)`, còn app_role có UPDATE trên
  // work_records. Nghĩa là toàn bộ lớp 1 chỉ là một cột mà bất kỳ câu UPDATE
  // nào cũng điền được: hai người dựng bản ghi manual rồi tự điền reviewed_by
  // bằng chính tên mình là xong. Cửa có, người canh thì không.
  //
  // Ba luật, và cả ba đều là điều kiện để "qua approver" có nghĩa:
  //   * reviewed_by phải mang vai 'approver' TRONG CHÍNH CỘNG ĐỒNG của bản ghi
  //     (lọc community_id — lần thứ sáu của lỗi này đã đủ để coi nó là luật);
  //   * reviewed_by KHÔNG được là người tham gia chính việc đó — cùng lập luận
  //     với `a.approver_id <> NEW.created_by` ở trigger quỹ (mục 4.5): tự ký
  //     cho bút toán mình tạo thì chữ ký không còn là chữ ký;
  //   * một bản ghi 'manual' không được SINH RA đã duyệt sẵn — lúc INSERT chưa
  //     có người tham gia nào nên luật thứ hai không kiểm được gì, và "duyệt"
  //     một việc trước khi biết ai làm là duyệt một tờ giấy trắng.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_work_review_gate() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.reviewed_at IS NULL THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
                          AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by THEN
        RETURN NEW;                       -- không đụng tới hai cột này
      END IF;

      IF TG_OP = 'INSERT' AND NEW.source_type = 'manual' THEN
        RAISE EXCEPTION 'MANUAL_REVIEW_BEFORE_WORK'
          USING DETAIL = 'bản ghi thủ công không được sinh ra đã duyệt sẵn';
      END IF;

      IF NEW.reviewed_by IS NULL THEN
        RAISE EXCEPTION 'REVIEWER_REQUIRED' USING DETAIL = 'có lúc duyệt thì phải có người duyệt';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM member_roles mr
                       JOIN roles r ON r.id = mr.role_id
                      WHERE mr.member_id = NEW.reviewed_by
                        AND mr.community_id = NEW.community_id
                        AND r.key = 'approver') THEN
        RAISE EXCEPTION 'REVIEWER_NOT_APPROVER'
          USING DETAIL = 'người duyệt phải có vai approver trong chính cộng đồng của bản ghi';
      END IF;

      IF EXISTS (SELECT 1 FROM work_participants p
                  WHERE p.work_record_id = NEW.id AND p.member_id = NEW.reviewed_by) THEN
        RAISE EXCEPTION 'REVIEWER_IS_PARTICIPANT'
          USING DETAIL = 'người duyệt không được là người tham gia chính việc đó';
      END IF;

      RETURN NEW;
    END $fn$;
  `);

  // ---------------------------------------------------------------------------
  // fn_work_participants_frozen — KHÔNG có trong đặc tả, và nó là lỗ hổng thật.
  //
  // Bảng quyền ở mục 4.8 cấp cho work_participants ĐỦ BỐN QUYỀN với lý do ghi
  // rõ: "danh sách người tham gia còn sửa được TỚI KHI CÓ XÁC NHẬN ĐẦU TIÊN".
  // Không có đối tượng SQL nào thực hiện vế "tới khi" đó — nó chỉ là một câu
  // trong bảng. Hai đường khai thác, cả hai đều phá đúng nguyên tắc 2:
  //
  //   (1) THÊM người sau khi mọi người đã xác nhận. A và B xác nhận việc {A,B}
  //       ⇒ có cạnh A–B. Chèn thêm C, C tự xác nhận ⇒ fn_work_edge thấy "đủ
  //       mọi người" và sinh thêm cạnh A–C, B–C. A và B chưa bao giờ xác nhận
  //       một việc có C trong đó — cạnh quan hệ mọc ra từ chữ ký của người khác.
  //
  //   (2) XOÁ người chưa xác nhận. Việc {A,B,C}, A và B xác nhận, C im lặng nên
  //       việc chưa được tính. Xoá C ⇒ điều kiện "đủ mọi người" thành đúng ⇒
  //       việc được tính vào confirmed_works ở lần tính lại kế tiếp. Người giữ
  //       cửa bị gỡ khỏi danh sách chính là cách mở cửa.
  //       (Khóa ngoại của work_confirmations chỉ chặn xoá người ĐÃ xác nhận.)
  //
  // Trigger này làm cho câu ở bảng 4.8 thành sự thật, và chặn cả đường owner/psql
  // chứ không chỉ đường app_role — nên quyền ở expected-grants.json giữ nguyên.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_work_participants_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_wr uuid;
    BEGIN
      -- TG_OP tường minh, KHÔNG coalesce(NEW, OLD): trong plpgsql, NEW chưa
      -- được gán ở trigger DELETE và OLD chưa được gán ở trigger INSERT, nên
      -- chạm vào biến sai vế là lỗi lúc chạy chứ không phải NULL.
      IF TG_OP = 'DELETE' THEN v_wr := OLD.work_record_id;
                         ELSE v_wr := NEW.work_record_id; END IF;

      IF EXISTS (SELECT 1 FROM work_confirmations WHERE work_record_id = v_wr) THEN
        RAISE EXCEPTION 'WORK_PARTICIPANTS_FROZEN'
          USING DETAIL = 'đã có xác nhận, danh sách người tham gia không đổi được nữa';
      END IF;

      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $fn$;
  `);

  // ---------------------------------------------------------------------------
  // fn_work_edge — spec mục 4.1. TRÁI TIM của nguyên tắc 2.
  //
  // Cạnh 'worked_together' sinh ra khi bản ghi xác nhận CUỐI CÙNG được ghi,
  // không sớm hơn một mili-giây. Thiếu một người thì không có cạnh nào — không
  // phải "cạnh tạm", không phải "cạnh một phía". Đó là toàn bộ lý do tách ba
  // bảng thay vì một hàng có hai cột confirmed_a/confirmed_b.
  //
  // SECURITY DEFINER vì app_role bị REVOKE INSERT trên member_relations
  // (migration 012) — cạnh CHỈ do trigger sinh. Và vì nó là SECURITY DEFINER,
  // nó phải tự kiểm cộng đồng bên trong (Ruling T10-a): v_cid đọc từ chính bản
  // ghi việc, rồi mọi mặt cắt sang work_participants đều lọc theo v_cid, nên
  // không có đường nào ghép hai người khác cộng đồng thành một cạnh.
  // ---------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_work_edge() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE r RECORD; v_cid uuid;
    BEGIN
      SELECT community_id INTO v_cid FROM work_records WHERE id = NEW.work_record_id;
      IF v_cid IS NULL THEN
        RAISE EXCEPTION 'NO_WORK_RECORD';       -- không thể xảy ra qua FK, nhưng đừng đoán
      END IF;

      IF EXISTS (
        SELECT 1 FROM work_participants p
         WHERE p.work_record_id = NEW.work_record_id
           AND p.community_id = v_cid
           AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                            WHERE c.work_record_id = p.work_record_id
                              AND c.member_id = p.member_id)
      ) THEN RETURN NEW; END IF;      -- còn thiếu người: chưa có cạnh nào

      FOR r IN SELECT a.member_id AS lo, b.member_id AS hi
                 FROM work_participants a
                 JOIN work_participants b ON b.work_record_id = a.work_record_id
                                         AND a.member_id < b.member_id
                                         AND b.community_id = v_cid
                WHERE a.work_record_id = NEW.work_record_id
                  AND a.community_id = v_cid
      LOOP
        INSERT INTO member_relations
          (community_id, kind, member_a, member_b, first_work_record_id)
        VALUES (v_cid, 'worked_together', r.lo, r.hi, NEW.work_record_id)
        ON CONFLICT (community_id, kind, member_a, member_b) DO NOTHING;
      END LOOP;
      RETURN NEW;
    END $fn$;
  `);

  await knex.raw(`
    -- Số thứ tự trong tên là CÓ Ý NGHĨA — xem ghi chú đầu tệp.
    CREATE TRIGGER trg_wc_1_self_only BEFORE INSERT ON work_confirmations
      FOR EACH ROW EXECUTE FUNCTION fn_self_only('member_id');
    CREATE TRIGGER trg_wc_2_manual_pair_quota BEFORE INSERT ON work_confirmations
      FOR EACH ROW EXECUTE FUNCTION fn_manual_pair_quota();

    CREATE TRIGGER trg_work_edge AFTER INSERT ON work_confirmations
      FOR EACH ROW EXECUTE FUNCTION fn_work_edge();

    CREATE TRIGGER trg_work_record_frozen BEFORE UPDATE ON work_records
      FOR EACH ROW EXECUTE FUNCTION fn_work_record_frozen();

    CREATE TRIGGER trg_work_review_gate BEFORE INSERT OR UPDATE ON work_records
      FOR EACH ROW EXECUTE FUNCTION fn_work_review_gate();

    CREATE TRIGGER trg_work_participants_frozen
      BEFORE INSERT OR UPDATE OR DELETE ON work_participants
      FOR EACH ROW EXECUTE FUNCTION fn_work_participants_frozen();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_work_participants_frozen ON work_participants;
    DROP TRIGGER IF EXISTS trg_work_review_gate ON work_records;
    DROP TRIGGER IF EXISTS trg_work_record_frozen ON work_records;
    DROP TRIGGER IF EXISTS trg_work_edge ON work_confirmations;
    DROP TRIGGER IF EXISTS trg_wc_2_manual_pair_quota ON work_confirmations;
    DROP TRIGGER IF EXISTS trg_wc_1_self_only ON work_confirmations;
    DROP FUNCTION IF EXISTS fn_work_edge();
    DROP FUNCTION IF EXISTS fn_work_participants_frozen();
    DROP FUNCTION IF EXISTS fn_work_review_gate();
    DROP FUNCTION IF EXISTS fn_work_record_frozen();
    DROP FUNCTION IF EXISTS fn_manual_pair_quota();
    DROP FUNCTION IF EXISTS fn_self_only();
  `);
}
