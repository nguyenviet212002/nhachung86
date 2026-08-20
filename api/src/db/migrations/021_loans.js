// Vay mượn — spec mục 11 dòng `021_loans`: "Cột `_enc`, bảng khóa theo chủ thể".
//
// Đây là chỗ duy nhất trong giai đoạn 1 chạm tới mục 10 TẦNG 2 (dữ liệu nhạy
// cảm: CCCD, số tài khoản ngân hàng). Luật ở đó là: **hủy khóa, không hủy dữ
// liệu**. Mỗi chủ thể có một khóa riêng; khóa đó được bọc bằng khóa gốc trong
// biến môi trường. Xóa theo yêu cầu chủ thể = HỦY khóa riêng. Bản mã còn nằm
// trong các bản sao lưu cũ nhưng vĩnh viễn không ai đọc được — kể cả khi khôi
// phục từ bản sao lưu ba tháng trước. Xóa cứng KHÔNG làm được điều này.
//
// Ba ràng buộc ở tầng CSDL cho lời hứa đó, vì "hủy khóa" mà chỉ là một cột
// timestamptz thì nó chỉ là một lời hứa:
//   1. đã hủy thì KHÔNG hồi sinh được (fn_subject_key_destroy);
//   2. đánh dấu đã hủy mà wrapped_key vẫn còn ⇒ từ chối — "hủy" phải có nghĩa
//      là bản khóa THẬT SỰ không còn ở đó, không phải một lá cờ;
//   3. không xoá được hàng (REVOKE DELETE): hàng bia mộ chính là bằng chứng
//      rằng việc hủy đã xảy ra, và mục 10 đòi ghi audit_log cho nó.
//
// CỘT `_enc` LÀ `bytea`, KHÔNG PHẢI `text`: bản mã là byte. Ứng dụng mã hoá và
// giải mã (khóa gốc nằm ở biến môi trường, không nằm trong CSDL) — cố ý KHÔNG
// dùng pgcrypto phía máy chủ, vì làm vậy thì khóa đi qua câu lệnh SQL và rơi
// vào log truy vấn của chính CSDL.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE subject_keys (
      member_id uuid PRIMARY KEY,
      community_id uuid NOT NULL REFERENCES communities(id),
      -- khóa dữ liệu của chủ thể, ĐÃ ĐƯỢC BỌC bằng khóa gốc. NULL nghĩa là đã hủy.
      wrapped_key bytea,
      key_version int NOT NULL DEFAULT 1,
      destroyed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT subject_key_destroy_means_gone
        CHECK ((destroyed_at IS NULL) = (wrapped_key IS NOT NULL)),
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE loans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      borrower_id uuid NOT NULL,
      amount numeric(14,2) NOT NULL CHECK (amount > 0),
      purpose text NOT NULL,
      status text NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested','approved','rejected','disbursed','repaying','closed')),
      due_on date,
      disbursed_on date,
      -- Dữ liệu nhạy cảm: chỉ ở dạng bản mã, giải được bằng khóa của chủ thể.
      bank_account_enc bytea,
      id_number_enc bytea,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT loan_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (borrower_id, community_id) REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_loans_open ON loans (community_id, status);

    CREATE TABLE loan_guarantors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      loan_id uuid NOT NULL,
      member_id uuid NOT NULL,
      signed_at timestamptz NOT NULL DEFAULT now(),
      note text,
      UNIQUE (loan_id, member_id),
      FOREIGN KEY (loan_id, community_id)   REFERENCES loans (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (member_id, community_id) REFERENCES members (id, community_id)
    );

    CREATE TABLE loan_repayments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      loan_id uuid NOT NULL,
      amount numeric(14,2) NOT NULL CHECK (amount > 0),
      paid_on date NOT NULL DEFAULT current_date,
      recorded_by uuid NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (loan_id, community_id)      REFERENCES loans (id, community_id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by, community_id)  REFERENCES members (id, community_id)
    );
    CREATE INDEX idx_loan_repay ON loan_repayments (loan_id, paid_on);
  `);

  await knex.raw(`
    -- Người bảo lãnh khoản vay không được là chính người vay. Ràng buộc liên
    -- bảng nên CHECK không làm được — cùng khuôn với fn_endorsement_signer_valid.
    CREATE FUNCTION fn_loan_guarantor_valid() RETURNS trigger LANGUAGE plpgsql AS $fn$
    DECLARE v_borrower uuid;
    BEGIN
      SELECT borrower_id INTO v_borrower FROM loans
       WHERE id = NEW.loan_id AND community_id = NEW.community_id;
      IF v_borrower IS NULL THEN RAISE EXCEPTION 'NO_LOAN'; END IF;
      IF v_borrower = NEW.member_id THEN
        RAISE EXCEPTION 'LOAN_GUARANTOR_IS_BORROWER'
          USING DETAIL = 'người vay không tự bảo lãnh cho khoản vay của mình';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_loan_guarantor_valid
      BEFORE INSERT OR UPDATE ON loan_guarantors
      FOR EACH ROW EXECUTE FUNCTION fn_loan_guarantor_valid();
  `);

  await knex.raw(`
    CREATE FUNCTION fn_subject_key_destroy() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        -- Xoá hàng là xoá bằng chứng rằng việc hủy đã xảy ra (mục 10 đòi ghi
        -- audit_log 'key.destroyed'; hàng bia mộ là vế còn lại của bằng chứng đó).
        RAISE EXCEPTION 'SUBJECT_KEY_IMMUTABLE'
          USING DETAIL = 'không xoá hàng khóa chủ thể — hủy khóa là đặt destroyed_at';
      END IF;

      IF OLD.destroyed_at IS NOT NULL THEN
        RAISE EXCEPTION 'SUBJECT_KEY_DESTROYED'
          USING DETAIL = 'khóa đã hủy thì không hồi sinh được — đó là toàn bộ ý nghĩa của việc hủy';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_subject_key_destroy
      BEFORE UPDATE OR DELETE ON subject_keys
      FOR EACH ROW EXECUTE FUNCTION fn_subject_key_destroy();
  `);

  await knex.raw(`
    -- subject_keys: ứng dụng cần đọc bản khóa đã bọc để giải mã, và cần UPDATE
    -- để hủy. DELETE bị thu — trigger cũng chặn, hai lớp cho một lời hứa.
    REVOKE ALL ON subject_keys FROM ??;
    GRANT SELECT, INSERT, UPDATE ON subject_keys TO ??;
    REVOKE ALL ON loans FROM ??;
    GRANT SELECT, INSERT, UPDATE ON loans TO ??;
    REVOKE ALL ON loan_guarantors FROM ??;
    GRANT SELECT, INSERT, UPDATE, DELETE ON loan_guarantors TO ??;
    -- Lần trả nợ đã ghi là một sự việc đã xảy ra: sửa/xoá được thì sổ nợ không
    -- còn là sổ.
    REVOKE ALL ON loan_repayments FROM ??;
    GRANT SELECT, INSERT ON loan_repayments TO ??;
  `, [user, user, user, user, user, user, user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_subject_key_destroy ON subject_keys;
    DROP TRIGGER IF EXISTS trg_loan_guarantor_valid ON loan_guarantors;
    DROP FUNCTION IF EXISTS fn_subject_key_destroy();
    DROP FUNCTION IF EXISTS fn_loan_guarantor_valid();
    DROP TABLE IF EXISTS loan_repayments;
    DROP TABLE IF EXISTS loan_guarantors;
    DROP TABLE IF EXISTS loans;
    DROP TABLE IF EXISTS subject_keys;
  `);
}
