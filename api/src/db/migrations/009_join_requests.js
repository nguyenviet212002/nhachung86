// Gia nhập — bảng đơn, hạn mức bảo lãnh (12 tháng TRƯỢT), và cơ chế chống
// chạy đua bằng khóa tư vấn theo giao dịch.
//
// Vì sao khóa tư vấn chứ không phải `FOR UPDATE`: đây là bài toán BÓNG MA
// (phantom) — ta đếm những hàng CHƯA TỒN TẠI. `FOR UPDATE` chỉ khóa được hàng
// đã có, nên hai giao dịch song song cùng đếm ra 2/3 rồi cùng chèn hàng thứ
// tư, không cái nào thấy cái nào. `SERIALIZABLE` giải được nhưng buộc MỌI giao
// dịch trong hệ thống phải có vòng thử lại. `pg_advisory_xact_lock` khóa đúng
// một người bảo lãnh, rẻ, và tự nhả khi giao dịch đóng.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE join_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      applicant_data jsonb NOT NULL,
      referrer_id uuid,
      member_id uuid,
      step int NOT NULL DEFAULT 1 CHECK (step BETWEEN 1 AND 5),
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','pending','met_confirmed','approved','rejected')),
      -- met_on: NGÀY hai người thật sự gặp nhau (người bảo lãnh khai).
      -- met_confirmed_at: LÚC lời khai đó được ghi nhận. Hai mốc khác nhau —
      -- kế hoạch chỉ có mốc thứ hai nhưng đầu vào của /confirm-met lại là
      -- { met_on, note }, tức không có chỗ nào chứa met_on. Xem task-8-report.
      met_on date,
      met_confirmed_at timestamptz,
      met_confirmed_by uuid REFERENCES members(id),
      -- met_note tách khỏi note: nếu dùng chung một cột, một đơn đã
      -- confirm-met rồi bị reject sẽ bị lời khai gặp mặt ghi đè bởi lý do từ
      -- chối — mất đúng bằng chứng mà cổng met_confirmed sinh ra để giữ.
      met_note text,
      approved_by uuid REFERENCES members(id),
      reject_reason_code text CHECK (reject_reason_code IN
        ('not_ready','no_meeting','referrer_misrepresented','other')),
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Khóa ngoại GHÉP thay vì REFERENCES members(id) đơn cột (lệch có chủ
      -- đích khỏi kế hoạch): migration 004 đã cố ý để sẵn UNIQUE
      -- members_id_cid (id, community_id) cho đúng việc này. Với FK đơn cột,
      -- một đơn của cộng đồng B được phép trỏ referrer_id sang một thành viên
      -- của cộng đồng A — và khi đó fn_guarantee_quota bên dưới đọc hạn mức từ
      -- config của B trong khi đếm suất của một người thuộc A. Hạn mức của A
      -- bị chi tiêu bằng luật của B. MATCH SIMPLE: referrer_id/member_id NULL
      -- thì ràng buộc bỏ qua, đúng như FK đơn cột nullable.
      CONSTRAINT jr_referrer_same_community
        FOREIGN KEY (referrer_id, community_id) REFERENCES members (id, community_id),
      CONSTRAINT jr_member_same_community
        FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );

    -- Chỉ mục hạn mức: vị từ phải khớp CHÍNH XÁC vế WHERE của fn_guarantee_quota,
    -- kể cả nhánh 'rejected' + referrer_misrepresented (kế hoạch bỏ sót nhánh
    -- này nên các hàng đốt-suất-vĩnh-viễn rơi ra ngoài chỉ mục).
    CREATE INDEX idx_jr_quota ON join_requests (referrer_id, created_at)
      WHERE status IN ('pending','met_confirmed','approved')
         OR (status = 'rejected' AND reject_reason_code = 'referrer_misrepresented');

    -- Chỉ mục danh sách: GET /join-requests lọc community_id + status, xếp theo
    -- created_at giảm dần.
    CREATE INDEX idx_jr_list ON join_requests (community_id, status, created_at DESC);

    CREATE TABLE guarantee_quota_overrides (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      referrer_id uuid NOT NULL,
      extra_slots int NOT NULL CHECK (extra_slots BETWEEN 1 AND 3),
      reason text NOT NULL,
      granted_by uuid NOT NULL REFERENCES members(id),
      valid_until timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT gqo_referrer_same_community
        FOREIGN KEY (referrer_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_gqo_lookup ON guarantee_quota_overrides (referrer_id, valid_until);
  `);

  // Nới lỏng tự hết hạn bằng valid_until, không sửa lại được sau khi cấp.
  await knex.raw(`REVOKE UPDATE, DELETE ON guarantee_quota_overrides FROM ??`, [user]);
  // Đơn đã nộp không biến mất (spec dòng 689).
  await knex.raw(`REVOKE DELETE ON join_requests FROM ??`, [user]);

  // -------------------------------------------------------------------------
  // Hạn mức bảo lãnh — spec mục 4.3.
  //
  // Cửa sổ 12 THÁNG TRƯỢT, không phải năm dương lịch: năm dương lịch cho phép
  // bảo lãnh 3 người tháng 12 rồi 3 người nữa tháng 1 — sáu người trong tám
  // tuần, đúng thứ hạn mức sinh ra để chặn.
  //
  // Trigger bắt CẢ `UPDATE OF status`: không có vế đó thì lách được bằng cách
  // tạo mười đơn 'draft' (draft chưa tiêu suất) rồi đẩy tất cả lên 'pending'.
  // -------------------------------------------------------------------------
  await knex.raw(`
    CREATE FUNCTION fn_guarantee_quota() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_used int; v_extra int; v_cap int;
    BEGIN
      IF NEW.referrer_id IS NULL THEN
        RAISE EXCEPTION 'REFERRER_REQUIRED';         -- nguyên tắc 1: không bảo lãnh ẩn danh
      END IF;
      IF NEW.status NOT IN ('pending','met_confirmed','approved') THEN
        RETURN NEW;
      END IF;

      PERFORM pg_advisory_xact_lock(hashtextextended(NEW.referrer_id::text, 42));

      -- Đơn 'rejected' TRẢ LẠI suất, TRỪ KHI lý do là referrer_misrepresented:
      -- người bảo lãnh ngay tình không bị phạt vì quyết định của ban duyệt,
      -- người khai gian thì mất suất vĩnh viễn.
      --
      -- "AND community_id = NEW.community_id" là thừa khi khóa ngoại ghép
      -- jr_referrer_same_community còn nguyên (referrer_id đã quyết định
      -- community_id) — giữ lại vì luật của dự án là mọi truy vấn lọc
      -- community_id, và vì nếu ai đó gỡ khóa ngoại kia thì đây là lưới thứ hai.
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

      -- hạn mức là chính sách của cộng đồng, không phải hằng số của nền tảng
      v_cap := coalesce((SELECT (config->>'guarantee_quota_per_year')::int
                           FROM communities WHERE id = NEW.community_id), 3) + v_extra;
      IF v_used >= v_cap THEN
        RAISE EXCEPTION 'GUARANTEE_QUOTA_EXCEEDED'
          USING DETAIL = format('%s/%s trong 12 tháng gần nhất', v_used, v_cap);
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_guarantee_quota
      BEFORE INSERT OR UPDATE OF status ON join_requests
      FOR EACH ROW EXECUTE FUNCTION fn_guarantee_quota();
  `);

  // -------------------------------------------------------------------------
  // otp_challenges.consumed_at — thuộc luồng POST /auth/register, việc Task 7
  // cố ý để lại cho Task 8 (nó phụ thuộc join_requests nên không làm sớm hơn
  // được).
  //
  // Vì sao cần: verifyOtp đánh dấu challenge 'used' rồi phát ra một JWT sống 5
  // phút. JWT là vé mang theo (bearer) — không có gì ngăn nộp CÙNG MỘT vé đó
  // ba lần trong 5 phút để tạo ba đơn gia nhập, tức một lần xác minh số điện
  // thoại đẻ ra nhiều đơn. Đặc tả đòi "otp_token phải được tiêu thụ". Cột này
  // là nơi ghi việc tiêu thụ đó; register UPDATE nó có điều kiện
  // (consumed_at IS NULL) nên lần nộp thứ hai không tìm thấy hàng nào để cập
  // nhật. Không mượn status='expired' cho việc này: 'expired' nghĩa là hết
  // hạn theo thời gian, khác hẳn "đã dùng để lập đơn".
  await knex.raw(`ALTER TABLE otp_challenges ADD COLUMN consumed_at timestamptz`);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE otp_challenges DROP COLUMN IF EXISTS consumed_at;
    DROP TRIGGER IF EXISTS trg_guarantee_quota ON join_requests;
    DROP FUNCTION IF EXISTS fn_guarantee_quota();
    DROP TABLE IF EXISTS guarantee_quota_overrides;
    DROP TABLE IF EXISTS join_requests;
  `);
}
