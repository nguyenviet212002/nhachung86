// Vỏ mỏng quanh contact_read (migration 006) — và cố ý mỏng. Đúng hai việc:
// chuyển tiếp lời gọi hàm SECURITY DEFINER, và dựng bao bì trạng thái cho cả
// một trang bằng MỘT truy vấn (không phải mỗi người một lời gọi contact_read).
// Mọi luật riêng tư — mức, đồng ý, ghi nhật ký — nằm trong CSDL, không lặp
// lại ở đây.
const FIELDS = ['phone', 'zalo', 'messenger', 'address'];

/**
 * Đọc đúng một trường liên hệ của đúng một người. Đường DUY NHẤT chạm tới
 * member_contacts. Phải chạy trong giao dịch mở qua withActor() vì contact_read
 * đọc app.actor_id qua current_setting().
 */
export async function readContact(trx, targetId, field) {
  const { rows } = await trx.raw('SELECT * FROM contact_read(?, ?)', [targetId, field]);
  return rows[0];
}

/**
 * MỘT truy vấn cho cả trang danh bạ. Danh sách không bao giờ gọi contact_read,
 * nên bài toán N+1 không tồn tại — xem mục 6 của spec. Chỉ đọc privacy_settings
 * và contact_requests (hai bảng thường, app_role đọc trực tiếp được) — không
 * chạm member_contacts, nên không có giá trị liên hệ nào rời khỏi hàm này.
 */
export async function contactStates(trx, viewerId, targetIds, communityId) {
  if (targetIds.length === 0) return new Map();
  // communityId là THAM SỐ BẮT BUỘC, không phải tuỳ chọn. Bản đầu (Task 6) chỉ
  // lọc theo targetIds và dựa vào lời hứa "người gọi đã lọc cộng đồng rồi" —
  // đúng hình dạng lỗi đã lặp năm lần trong dự án (Ruling T7-a, T8-d, hai chỗ
  // ở Task 9, mã mẫu contact_upsert). Tham số bắt buộc làm chỗ quên trở thành
  // lỗi thấy được ngay (SQL nhận NULL ⇒ không trả hàng nào) chứ không phải một
  // đường rò im lặng. Xem thêm migration 012a: cùng lỗ hổng, phía CSDL.
  if (!communityId) {
    throw new Error('contactStates() cần communityId — mọi truy vấn theo cộng đồng phải lọc community_id');
  }
  const { rows } = await trx.raw(
    `SELECT ps.member_id, ps.field_key, ps.level,
            cr.id AS request_id, cr.status AS request_status
       FROM privacy_settings ps
       LEFT JOIN contact_requests cr
         ON cr.target_id = ps.member_id AND cr.field_key = ps.field_key
        AND cr.requester_id = ? AND cr.community_id = ?
      WHERE ps.member_id = ANY(?) AND ps.field_key = ANY(?)
        AND ps.community_id = ?`,
    [viewerId, communityId, targetIds, FIELDS, communityId]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.member_id)) map.set(r.member_id, {});
    map.get(r.member_id)[r.field_key] = {
      level: r.level, requestId: r.request_id, requestStatus: r.request_status,
    };
  }
  return map;
}

/**
 * Dựng hình dạng `contacts` cho một hồ sơ trong danh sách (mục 5.2 spec).
 * value LUÔN null — giá trị thật chỉ ra ở GET /members/:id/contacts/:field,
 * endpoint đọc từng trường qua readContact()/contact_read. Đó là lý do một
 * trang danh bạ 20 người không sinh 60 lời gọi contact_read.
 */
export function envelope(stateForMember, { viewerId, targetId }) {
  const out = {};
  for (const field of FIELDS) {
    const s = stateForMember?.[field] ?? { level: 'closed' };
    let state;
    if (viewerId === targetId) state = 'self';
    else if (s.level === 'public') state = 'visible';
    else if (s.level === 'closed') state = 'closed';
    else if (s.requestStatus === 'approved') state = 'visible';
    else if (s.requestStatus === 'pending') state = 'requested';
    else if (s.requestStatus === 'denied') state = 'denied';
    else state = 'can_request';
    out[field] = { value: null, level: s.level, state, request_id: s.requestId ?? null };
  }
  return out;
}
