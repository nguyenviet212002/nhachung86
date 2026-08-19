// Cổng met_confirmed và sợi bảo lãnh đóng băng — spec mục 4.5 (bảng đối chiếu)
// và mục 4.7.
//
// Vì sao cổng phải là CONSTRAINT TRIGGER hoãn tới COMMIT chứ không phải
// BEFORE INSERT: `join_requests.member_id` chỉ được đặt trong CÙNG giao dịch
// approve, và chỉ SAU khi hàng members đã tồn tại (member_id là khóa ngoại trỏ
// tới nó). Kiểm ngay lúc ghi hàng members thì không đơn nào từng có member_id
// khớp, nên cổng sẽ chặn cả luồng duyệt hợp lệ. Đây là cùng công cụ, cùng lý do
// với trg_fund_two_approvers ở spec mục 4.5: ràng buộc LIÊN HÀNG kiểm lúc
// commit, không phải lúc ghi.
export async function up(knex) {
  await knex.raw(`
    CREATE FUNCTION fn_member_status_gate() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.status = 'member' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'member') THEN
        -- referrer_id IS NULL: những người đầu tiên của cộng đồng không ai bảo
        -- lãnh được (chưa có ai để bảo lãnh) — họ không đi qua luồng đơn.
        IF NEW.referrer_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM join_requests
           WHERE member_id = NEW.id
             AND community_id = NEW.community_id
             AND met_confirmed_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'MEMBER_NEEDS_MET_CONFIRMATION'
            USING DETAIL = 'chưa có xác nhận đã gặp mặt';
        END IF;
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE FUNCTION fn_referrer_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF OLD.referrer_id IS DISTINCT FROM NEW.referrer_id AND OLD.status = 'member' THEN
        RAISE EXCEPTION 'REFERRER_FROZEN'
          USING DETAIL = 'sợi bảo lãnh đã thành sự thật lịch sử, không sửa được';
      END IF;
      RETURN NEW;
    END $fn$;

    CREATE TRIGGER trg_referrer_frozen BEFORE UPDATE OF referrer_id ON members
      FOR EACH ROW EXECUTE FUNCTION fn_referrer_frozen();

    CREATE CONSTRAINT TRIGGER trg_member_status_gate
      AFTER INSERT OR UPDATE OF status ON members
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION fn_member_status_gate();
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_member_status_gate ON members;
    DROP TRIGGER IF EXISTS trg_referrer_frozen ON members;
    DROP FUNCTION IF EXISTS fn_referrer_frozen();
    DROP FUNCTION IF EXISTS fn_member_status_gate();
  `);
}
