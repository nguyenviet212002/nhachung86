// contact_read: thêm CHỐT CHẶN CỘNG ĐỒNG — bịt một đường rò dữ liệu cá nhân
// chéo cộng đồng có thật, đã tái hiện được.
//
// Bản ở migration 006 tra người bị xem bằng `SELECT community_id FROM members
// WHERE id = p_target` rồi dùng community_id đó cho mọi việc còn lại — nhưng
// KHÔNG bao giờ so nó với cộng đồng của NGƯỜI XEM. Hệ quả đo được (probe chạy
// thật trên CSDL test trước khi viết tệp này): người xem thuộc cộng đồng A gọi
// contact_read(<member của cộng đồng B>, 'phone') nhận về
// `{allowed: true, value: '0912999999'}` — số điện thoại thật của người thuộc
// cộng đồng khác, kèm một dòng audit_log 'contact.read' ghi vào cộng đồng B.
//
// Trước Task 10 lỗ này không có đường vào: chưa route nào gọi contact_read.
// Task 10 mở đúng route đó (`GET /members/:id/contacts/:field`), nên nó phải
// được bịt ở đây, và bịt Ở TẦNG CSDL chứ không chỉ ở service. Tầng service có
// kiểm (members/service.js tra người bị xem theo `community_id` của actor
// trước khi gọi), nhưng đó là LỜI HỨA CỦA ỨNG DỤNG; cùng lập luận đã dùng ở
// Ruling T8-d ("CSDL chặn, không phải service chặn") và mục 4.2 đặc tả. Route
// thứ hai gọi contact_read mà quên kiểm sẽ mở lại nguyên vẹn lỗ này.
//
// Đây là lần thứ SÁU cùng một họ lỗi trong dự án (Ruling T7-a, T8-d, hai chỗ ở
// Task 9, mã mẫu contact_upsert ở mục 4.7 đặc tả) — lần này nằm trong một hàm
// SECURITY DEFINER, tức chỗ REVOKE ALL trên member_contacts không đỡ được.
//
// Vì sao RAISE 'NO_TARGET' chứ không phải một mã lỗi riêng: đặc tả mục 5.3
// ("Không để thông báo lỗi thành công cụ dò danh sách") đòi "không tồn tại" và
// "tồn tại nhưng không thuộc cộng đồng của bạn" phải KHÔNG phân biệt được từ
// bên ngoài. Dùng chung nhánh NO_TARGET là cách rẻ nhất để giữ điều đó.
//
// Đánh số 012a chứ không phải 013: 013 đã hẹn cho `013_capabilities` ở bảng
// mục 11 đặc tả. Điều kiện an toàn của Ruling T9-d thỏa hiển nhiên ở đây vì
// 012a là migration CUỐI CÙNG hiện có — nó được nối thêm vào đuôi, không chèn
// vào giữa, nên không có kịch bản "knex xếp sau một migration đã chạy".
//
// !!! CHÚ Ý CHO TASK 13 !!! Migration 015 (đặc tả mục 6 / comment ở 006) sẽ
// CREATE OR REPLACE hàm này lần nữa để thêm nhánh "lời giới thiệu đủ ba chữ
// ký". Bản viết lại đó PHẢI giữ nguyên hai câu kiểm cộng đồng dưới đây, nếu
// không lỗ rò được mở lại y nguyên.

const BODY_WITH_COMMUNITY_CHECK = `
    CREATE OR REPLACE FUNCTION contact_read(p_target uuid, p_field text) RETURNS contact_result
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_viewer uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_level text; v_ok boolean := false; v_reason text; v_cid uuid; v_viewer_cid uuid;
      v_out contact_result;
    BEGIN
      IF v_viewer IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      -- Danh sách trắng KIỂM TRƯỚC khi p_field được dùng trong format('%I')
      -- bên dưới — đây là chỗ duy nhất trong hệ thống nối tên cột động vào SQL.
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;
      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      -- MỚI Ở 012a: người xem và người bị xem phải cùng một cộng đồng.
      -- IS DISTINCT FROM (không phải <>) để người xem không tồn tại — v_viewer_cid
      -- là NULL — cũng rơi vào nhánh từ chối thay vì lọt qua vì NULL <> x là NULL.
      SELECT community_id INTO v_viewer_cid FROM members WHERE id = v_viewer;
      IF v_viewer_cid IS DISTINCT FROM v_cid THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      SELECT level INTO v_level FROM privacy_settings
       WHERE member_id = p_target AND field_key = p_field;
      -- Thiếu cấu hình mặc định là 'closed', không phải 'public' — nghi ngờ
      -- thì đóng, không mở.
      v_level := coalesce(v_level, 'closed');

      IF    v_viewer = p_target THEN v_ok := true;
      ELSIF v_level = 'public'  THEN v_ok := true;
      ELSIF v_level = 'on_consent' THEN
        v_ok := EXISTS (SELECT 1 FROM contact_requests
                         WHERE requester_id = v_viewer AND target_id = p_target
                           AND field_key = p_field AND status = 'approved');
        IF NOT v_ok THEN v_reason := 'NEEDS_CONSENT'; END IF;
      ELSE  v_reason := 'CLOSED';
      END IF;

      IF v_ok THEN
        EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
          INTO v_out.value USING p_target;
        v_out.allowed := true;
      ELSE
        v_out.allowed := false; v_out.reason := v_reason;   -- KHÔNG RAISE
      END IF;

      -- detail CHỈ chứa tên trường và mã lý do — KHÔNG BAO GIỜ giá trị liên hệ.
      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_viewer,
              CASE WHEN v_ok THEN 'contact.read' ELSE 'contact.denied' END,
              'member', p_target,
              jsonb_build_object('field', p_field, 'reason', coalesce(v_reason, 'ok')));
      RETURN v_out;
    END $fn$;
`;

// Bản NGUYÊN VĂN của migration 006, dùng cho down(). Giữ đầy đủ (thay vì DROP)
// để rollback trả hệ thống về đúng trạng thái trước 012a chứ không phải về một
// trạng thái không có hàm.
const BODY_006 = `
    CREATE OR REPLACE FUNCTION contact_read(p_target uuid, p_field text) RETURNS contact_result
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE
      v_viewer uuid := nullif(current_setting('app.actor_id', true), '')::uuid;
      v_level text; v_ok boolean := false; v_reason text; v_cid uuid;
      v_out contact_result;
    BEGIN
      IF v_viewer IS NULL THEN RAISE EXCEPTION 'NO_ACTOR'; END IF;
      IF p_field NOT IN ('phone','zalo','messenger','address') THEN
        RAISE EXCEPTION 'BAD_FIELD'; END IF;
      SELECT community_id INTO v_cid FROM members WHERE id = p_target;
      IF v_cid IS NULL THEN RAISE EXCEPTION 'NO_TARGET'; END IF;

      SELECT level INTO v_level FROM privacy_settings
       WHERE member_id = p_target AND field_key = p_field;
      v_level := coalesce(v_level, 'closed');

      IF    v_viewer = p_target THEN v_ok := true;
      ELSIF v_level = 'public'  THEN v_ok := true;
      ELSIF v_level = 'on_consent' THEN
        v_ok := EXISTS (SELECT 1 FROM contact_requests
                         WHERE requester_id = v_viewer AND target_id = p_target
                           AND field_key = p_field AND status = 'approved');
        IF NOT v_ok THEN v_reason := 'NEEDS_CONSENT'; END IF;
      ELSE  v_reason := 'CLOSED';
      END IF;

      IF v_ok THEN
        EXECUTE format('SELECT %I FROM member_contacts WHERE member_id = $1', p_field)
          INTO v_out.value USING p_target;
        v_out.allowed := true;
      ELSE
        v_out.allowed := false; v_out.reason := v_reason;
      END IF;

      INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail)
      VALUES (v_cid, v_viewer,
              CASE WHEN v_ok THEN 'contact.read' ELSE 'contact.denied' END,
              'member', p_target,
              jsonb_build_object('field', p_field, 'reason', coalesce(v_reason, 'ok')));
      RETURN v_out;
    END $fn$;
`;

export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(BODY_WITH_COMMUNITY_CHECK);
  // CREATE OR REPLACE giữ nguyên quyền đã cấp, nhưng khẳng định lại cho tường
  // minh — cùng tinh thần Ruling C10 (024 khẳng định lại toàn bộ ma trận quyền).
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO ??`, [user]);
}

export async function down(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(BODY_006);
  await knex.raw(`GRANT EXECUTE ON FUNCTION contact_read(uuid, text) TO ??`, [user]);
}
