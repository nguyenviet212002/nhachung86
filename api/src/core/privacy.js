// Vỏ mỏng quanh luật riêng tư — và cố ý mỏng. Toàn bộ LUẬT nằm trong CSDL
// (fn_privacy_state, migration 012b; contact_read, migration 006/012a/015);
// tệp này chỉ chuyển tiếp lời gọi và ĐÓNG GÓI kết quả cho vỏ HTTP.
//
// TÁM TRƯỜNG, MỘT LUẬT (việc thừa kế (a) của Task 13, Ruling T11-f).
// privacy_settings nhận tám field_key. Bốn trường liên hệ nằm ở
// member_contacts và chỉ đọc được qua contact_read. Bốn trường hồ sơ
// (job, area, price, family) nằm rải rác ở members/capabilities và trước Task
// 13 KHÔNG AI ĐỌC MỨC CỦA CHÚNG — người dùng gạt nút "đóng" mà danh bạ vẫn trả
// đủ. Nay cả tám đi qua đúng một cửa: fn_privacy_state quyết trạng thái,
// envelope() dựng bao bì.
//
// Khác biệt DUY NHẤT giữa hai nhóm là `inline`: giá trị của trường liên hệ
// KHÔNG BAO GIỜ đi kèm bao bì (nguyên tắc 4 — một trang danh bạ 20 người không
// được rò 20 số điện thoại một lúc, và mỗi lượt xem phải là một hành động
// riêng có nhật ký). Giá trị của trường hồ sơ thì đi kèm khi được phép, vì nó
// LÀ nội dung của danh bạ và không có endpoint riêng nào để đọc.
//
// Khác biệt đó là DỮ LIỆU trong bảng dưới đây, không phải một nhánh `if` cho
// từng trường — tám trường mà hai luật khác nhau thì luật thứ hai sẽ trôi dạt
// khỏi luật thứ nhất, và không ai biết lúc nào.
export const CONTACT_FIELDS = ['phone', 'zalo', 'messenger', 'address'];
export const PROFILE_FIELDS = ['job', 'area', 'price', 'family'];

const FIELD_SPEC = Object.freeze({
  phone:     { inline: false },
  zalo:      { inline: false },
  messenger: { inline: false },
  address:   { inline: false },
  job:       { inline: true },
  area:      { inline: true },
  price:     { inline: true },
  family:    { inline: true },
});

export const FIELDS = Object.keys(FIELD_SPEC);

const VISIBLE_STATES = new Set(['self', 'visible']);

/**
 * Đọc một trường liên hệ của một người. Đường DUY NHẤT chạm tới
 * member_contacts. Phải chạy trong giao dịch mở qua withActor() vì contact_read
 * đọc app.actor_id qua current_setting().
 */
export async function readContact(trx, targetId, field) {
  const { rows } = await trx.raw('SELECT * FROM contact_read(?, ?)', [targetId, field]);
  return rows[0];
}

/**
 * MỘT truy vấn cho cả trang danh bạ, TÁM trường mỗi người. Danh sách không bao
 * giờ gọi contact_read, nên bài toán N+1 không tồn tại — xem mục 6 của spec.
 * Không chạm member_contacts, nên không có giá trị liên hệ nào rời khỏi đây.
 *
 * Trạng thái do fn_privacy_state (CSDL) tính, KHÔNG tính lại ở JS. Truy vấn
 * sinh đủ 8 hàng cho mỗi người (CROSS JOIN với danh sách trường) chứ không chỉ
 * những trường có cấu hình: thiếu hàng privacy_settings là chuyện thường
 * (trường lạ, dữ liệu cũ), và để chỗ đó thành `undefined` rồi trông vào người
 * gọi đoán đúng là cách rò dữ liệu.
 */
export async function contactStates(trx, viewerId, targetIds, communityId) {
  if (targetIds.length === 0) return new Map();
  // communityId là THAM SỐ BẮT BUỘC, không phải tuỳ chọn (Ruling T10-c). Bản
  // đầu (Task 6) chỉ lọc theo targetIds và dựa vào lời hứa "người gọi đã lọc
  // cộng đồng rồi" — đúng hình dạng lỗi đã lặp sáu lần trong dự án.
  if (!communityId) {
    throw new Error('contactStates() cần communityId — mọi truy vấn theo cộng đồng phải lọc community_id');
  }
  const { rows } = await trx.raw(
    `SELECT t.member_id, f.field_key, ps.level,
            cr.id AS request_id, cr.status AS request_status,
            fn_privacy_state(?, t.member_id, f.field_key) AS state
       FROM unnest(?::uuid[]) AS t(member_id)
       CROSS JOIN unnest(?::text[]) AS f(field_key)
       -- JOIN members: chốt chặn cộng đồng ở chính câu truy vấn, không chỉ
       -- trong hàm. Người không thuộc cộng đồng của người xem biến mất khỏi
       -- kết quả thay vì trả về một bao bì "closed" (đã lộ ra là họ tồn tại).
       JOIN members m ON m.id = t.member_id AND m.community_id = ?
       LEFT JOIN privacy_settings ps
         ON ps.member_id = t.member_id AND ps.field_key = f.field_key
        AND ps.community_id = ?
       LEFT JOIN contact_requests cr
         ON cr.target_id = t.member_id AND cr.field_key = f.field_key
        AND cr.requester_id = ? AND cr.community_id = ?`,
    [viewerId, targetIds, FIELDS, communityId, communityId, viewerId, communityId]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.member_id)) map.set(r.member_id, {});
    map.get(r.member_id)[r.field_key] = {
      level: r.level, state: r.state,
      requestId: r.request_id, requestStatus: r.request_status,
    };
  }
  return map;
}

/**
 * Dựng bao bì tám trường cho một hồ sơ (mục 5.2 spec). KHÔNG có luật nào ở đây:
 * `state` đến thẳng từ fn_privacy_state, hàm này chỉ quyết định giá trị nào
 * được đi kèm.
 *
 * Thiếu trạng thái (người gọi truyền map rỗng, người bị xem khác cộng đồng nên
 * bị JOIN loại, ...) ⇒ 'closed'. Mặc định phải là mặc định ĐÓNG: một lỗi lập
 * trình ở phía trên không được biến thành một lượt rò dữ liệu.
 *
 * `values` chỉ có tác dụng với bốn trường hồ sơ (`inline: true`). Truyền số
 * điện thoại vào đây cũng không ra được — bảng FIELD_SPEC chặn, không phải một
 * lời dặn trong tài liệu.
 */
export function envelope(stateForMember, values = {}) {
  const out = {};
  for (const [field, spec] of Object.entries(FIELD_SPEC)) {
    const s = stateForMember?.[field];
    const state = s?.state ?? 'closed';
    const allowed = spec.inline && VISIBLE_STATES.has(state);
    out[field] = {
      value: allowed ? (values[field] ?? null) : null,
      level: s?.level ?? null,
      state,
      request_id: s?.requestId ?? null,
    };
  }
  return out;
}

/** Lấy đúng một nhóm trường ra khỏi bao bì đầy đủ. */
export function pickFields(env, fields) {
  const out = {};
  for (const f of fields) out[f] = env[f];
  return out;
}
