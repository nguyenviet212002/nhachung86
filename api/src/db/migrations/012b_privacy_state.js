// fn_privacy_state — MỘT luật riêng tư cho CẢ TÁM trường, đặt ở một chỗ.
//
// VÌ SAO TỆP NÀY TỒN TẠI (việc thừa kế (a), Ruling T11-f)
// -------------------------------------------------------
// privacy_settings (migration 006) nhận đúng tám field_key:
//   phone, zalo, messenger, address   — nằm ở member_contacts, đọc qua contact_read
//   job, area, price, family          — KHÔNG có cửa nào đọc mức của chúng
//
// Bốn trường sau có hàng trong privacy_settings, màn "Quyền riêng tư" cho người
// dùng gạt nút, nhưng GET /members trả `job` và `area` như cột thường. Đặt
// job = 'closed' rồi mở danh bạ: vẫn thấy đủ. Đó là một cái nút không nối vào
// đâu cả — tệ hơn không có nút, vì nó hứa một sự bảo vệ không tồn tại và người
// ta sẽ dựa vào lời hứa đó mà khai thật. Trong cộng đồng 52 người, `area` cộng
// `job` là đủ để định danh một người.
//
// VÌ SAO Ở TẦNG CSDL CHỨ KHÔNG PHẢI THÊM MẤY DÒNG `if` TRONG JAVASCRIPT
// ---------------------------------------------------------------------
// Luật riêng tư hôm nay sống ở hai nơi nếu làm ẩu: envelope() trong JS quyết
// định che/không che, còn câu WHERE của GET /members lại LỌC theo m.job và
// m.area_id. Bộ lọc chính là một kênh phụ hoàn chỉnh: `?job=bác sĩ` trả về
// đúng những người có nghề đó, kể cả người đã đặt job='closed'. Che giá trị mà
// để nguyên bộ lọc là che một nửa — cùng hình dạng với Ruling T8-c ("che câu
// chữ mà để hở trạng thái").
//
// Muốn bộ lọc tôn trọng mức riêng tư thì SQL BẮT BUỘC phải biết luật. Và khi
// SQL đã phải biết luật thì viết luật đó lần thứ hai trong JS là tự tạo ra hai
// bản sao sẽ trôi dạt khỏi nhau — đúng điều đề bài Task 13 cảnh báo. Nên:
//
//   * hàm này là NGUỒN SỰ THẬT DUY NHẤT của trạng thái riêng tư;
//   * core/privacy.js contactStates() gọi nó, envelope() chỉ ĐÓNG GÓI
//     (không còn dòng logic nào tự suy ra trạng thái);
//   * câu WHERE của GET /members gọi nó cho bộ lọc job/area_id;
//   * contact_read (migration 015) cũng gọi nó, nên bốn trường liên hệ và bốn
//     trường hồ sơ đi qua CÙNG MỘT CỬA thật sự, không phải "cùng cửa" trên
//     giấy.
//
// KHÔNG phải SECURITY DEFINER, và đó là chủ ý: hàm chỉ đọc members,
// privacy_settings, contact_requests — ba bảng app_role vốn đã SELECT được.
// Thêm một hàm chạy bằng quyền owner là thêm một mặt tấn công mà Ruling T10-a
// vừa dạy phải đếm cẩn thận. Hàm này không mở thêm gì cả.
//
// CHỐT CHẶN CỘNG ĐỒNG nằm ngay trong hàm (lần thứ sáu của họ lỗi này đã đủ để
// coi là luật): người xem và người bị xem khác cộng đồng ⇒ 'closed'. Người bị
// xem không tồn tại cũng ⇒ 'closed'. Nghi ngờ thì đóng.
//
// ĐÁNH SỐ 012b: điều kiện an toàn của Ruling T9-d được thoả và phải nói rõ —
// hàm này chỉ phụ thuộc members (004), privacy_settings + contact_requests
// (006), tức TOÀN BỘ nằm trước 012. Trên một CSDL đã chạy tới 025, knex sẽ xếp
// nó vào batch mới ở CUỐI thay vì xen giữa; vì không phụ thuộc gì ở 013–025
// nên kết quả giống hệt. Trên CSDL trắng nó chạy đúng vị trí 012b.

const FN = `
  CREATE OR REPLACE FUNCTION fn_privacy_state(p_viewer uuid, p_target uuid, p_field text)
  RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
  DECLARE v_level text; v_cid uuid; v_viewer_cid uuid; v_status text;
  BEGIN
    IF p_viewer IS NULL OR p_target IS NULL OR p_field IS NULL THEN RETURN 'closed'; END IF;

    SELECT community_id INTO v_cid        FROM members WHERE id = p_target;
    SELECT community_id INTO v_viewer_cid FROM members WHERE id = p_viewer;
    -- IS DISTINCT FROM chứ không phải <>: người xem hoặc người bị xem không tồn
    -- tại thì community_id là NULL, mà NULL <> x cho ra NULL (không phải TRUE)
    -- nên phép so trần sẽ LỌT. Cùng bẫy đã ghi ở migration 012a.
    IF v_cid IS NULL OR v_viewer_cid IS DISTINCT FROM v_cid THEN RETURN 'closed'; END IF;

    IF p_viewer = p_target THEN RETURN 'self'; END IF;

    SELECT level INTO v_level FROM privacy_settings
     WHERE member_id = p_target AND field_key = p_field AND community_id = v_cid;
    -- Thiếu cấu hình mặc định là 'closed', không phải 'public'. Trường lạ
    -- (không nằm trong tám field_key) cũng rơi vào đây — mặc định an toàn.
    v_level := coalesce(v_level, 'closed');

    IF v_level = 'public' THEN RETURN 'visible'; END IF;
    IF v_level = 'closed' THEN RETURN 'closed';  END IF;

    -- còn lại: 'on_consent' — trạng thái do đơn xin quyết định
    SELECT status INTO v_status FROM contact_requests
     WHERE requester_id = p_viewer AND target_id = p_target
       AND field_key = p_field AND community_id = v_cid;

    RETURN CASE v_status
             WHEN 'approved' THEN 'visible'
             WHEN 'pending'  THEN 'requested'
             WHEN 'denied'   THEN 'denied'
             ELSE 'can_request'
           END;
  END $fn$;
`;

export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(FN);
  await knex.raw(`GRANT EXECUTE ON FUNCTION fn_privacy_state(uuid, uuid, text) TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`DROP FUNCTION IF EXISTS fn_privacy_state(uuid, uuid, text);`);
}
