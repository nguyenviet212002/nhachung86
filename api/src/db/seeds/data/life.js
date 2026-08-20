import { id } from '../ids.js';
import { COMMUNITY_ID, areaAt } from './community.js';
import { byCode } from './tree.js';
import { monthsAgo } from './tree.js';

// ---------------------------------------------------------------------------
// Phần đời sống của cộng đồng — đặc tả mục 12.3: 7 tín hiệu, 5 nhu cầu việc,
// 5 yêu cầu giúp nhau, 4 hoạt động (2 có tổng kết), 12 bút toán quỹ (2 cái ≥ 1
// triệu có đủ chữ ký), 2 khoản vay.
// ---------------------------------------------------------------------------

const m = (c) => byCode[c].id;

/**
 * 7 tín hiệu, mỗi chặng một cái.
 *
 * Lệch có chủ đích khỏi đặc tả: đặc tả mô tả vòng đời "created → archived",
 * nhưng `signals.status` (migration 014) chỉ có năm giá trị
 * `open/converging/closed/done/cancelled` — không có `created`, không có
 * `archived`. Bảy tín hiệu dưới đây phủ hết năm trạng thái ấy, hai trạng thái
 * đông việc nhất (`open`, `done`) có hai cái để còn thấy được biến thể khẩn
 * cấp và biến thể đã dẫn tới một bản ghi việc.
 *
 * `respond_by` của mọi tín hiệu còn mở đều ở TƯƠNG LAI. Cố ý: nếu dữ liệu mẫu
 * gieo sẵn một tín hiệu quá hạn trả lời thì tác vụ hằng giờ (Task 18) sẽ đóng
 * nó ngay lần chạy đầu, rồi lần seed sau lại mở ra — hai bên giằng nhau mãi
 * trên cùng một hàng. Dữ liệu cho tác vụ ấy do bài kiểm thử tự dựng.
 */
export const SIGNALS = [
  ['SIG-001', 'giup_gap', 'Cần người trông giúp cửa hàng buổi chiều', 'open', true, 3],
  ['SIG-002', 'can_nang_luc', 'Tìm thợ ốp lát nhận việc dài hạn', 'open', false, 14],
  ['SIG-003', 'keu_goi', 'Góp sách vở đầu năm học cho các cháu', 'converging', false, 21],
  ['SIG-004', 'tim_nguoi', 'Tìm người biết làm hồ sơ vay ngân hàng', 'closed', false, null],
  ['SIG-005', 'chia_se_co_hoi', 'Xưởng may tuyển 5 người, ưu tiên anh em 86', 'done', false, null],
  ['SIG-006', 'giup_gap', 'Nhà bị dột sau bão, cần lợp lại mái', 'done', true, null],
  ['SIG-007', 'can_nang_luc', 'Cần người dạy kèm tiếng Anh cấp hai', 'cancelled', false, null],
].map(([codeStr, type, title, status, urgent, days], i) => ({
  id: id('signal:' + codeStr),
  community_id: COMMUNITY_ID,
  code: codeStr,
  created_by: m('M' + String(2 + i).padStart(2, '0')),
  type,
  title,
  body: 'Nội dung tín hiệu mẫu, viết đủ dài để thử tìm kiếm tiếng Việt có dấu.',
  area_id: areaAt(i),
  urgent,
  ask: 'Ai giúp được nhắn lại giúp trước ngày hẹn.',
  respond_by: days === null ? null : futureDays(days),
  status,
}));

function futureDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  d.setUTCHours(3, 0, 0, 0);
  return d.toISOString();
}

/** 5 nhu cầu việc làm. */
export const JOB_NEEDS = [
  ['Cần thợ điện nước cho nhà mới xây', 'thoi_vu', 'open'],
  ['Tuyển hai người phụ xưởng may', 'dai_han', 'open'],
  ['Tìm người nhận cỗ cưới 20 mâm', 'thoi_vu', 'filled'],
  ['Cần kế toán làm sổ theo quý', 'hop_tac', 'open'],
  ['Nhận cháu học nghề cơ khí', 'hoc_nghe', 'closed'],
].map(([title, jobType, status], i) => ({
  id: id('job_need:' + i),
  community_id: COMMUNITY_ID,
  poster_id: m('M' + String(10 + i).padStart(2, '0')),
  title,
  description: 'Mô tả công việc mẫu.',
  terms: 'Thoả thuận theo ngày công.',
  area_id: areaAt(i + 2),
  job_type: jobType,
  status,
}));

/** 5 yêu cầu giúp nhau, hai cái có suất để thử `fn_aid_slot_capacity`. */
export const AID_REQUESTS = [
  ['Cần người chở đồ giúp ngày chuyển nhà', 'normal', 'queued', 2],
  ['Nhà bị dột, cần người lợp lại mái', 'urgent', 'matched', 3],
  ['Cần người trông cháu buổi sáng một tuần', 'normal', 'done', 0],
  ['Xin giúp dựng rạp đám hiếu', 'urgent', 'closed', 0],
  ['Cần người đưa đi khám ở tỉnh', 'normal', 'queued', 1],
].map(([title, urgency, status, slots], i) => ({
  id: id('aid_request:' + i),
  community_id: COMMUNITY_ID,
  requester_id: m('M' + String(20 + i).padStart(2, '0')),
  title,
  description: 'Mô tả yêu cầu giúp nhau mẫu.',
  area_id: areaAt(i + 4),
  urgency,
  status,
  slots: slots === 0 ? [] : [{
    id: id('aid_slot:' + i),
    community_id: COMMUNITY_ID,
    aid_request_id: id('aid_request:' + i),
    title: 'Suất giúp việc',
    needed: slots,
    // Một người nhận suất — hàng này đi qua `trg_ast_1_self_only`, nên seed
    // phải đóng dấu đúng người đó chứ không phải người tạo yêu cầu.
    takers: [m('M' + String(30 + i).padStart(2, '0'))],
  }],
}));

/**
 * 4 hoạt động, 2 đã có tổng kết.
 *
 * THỨ TỰ GHI LÀ MỘT PHẦN CỦA DỮ LIỆU: `trg_activity_summary_required`
 * (migration 017) từ chối tạo một hoạt động dùng quỹ khi trong cộng đồng còn
 * một hoạt động dùng quỹ ĐÃ XONG mà CHƯA có bản tổng kết. Nên hai hoạt động
 * dùng quỹ đã xong phải được ghi kèm bản tổng kết NGAY sau nó, trước khi hoạt
 * động dùng quỹ tiếp theo ra đời. Đảo thứ tự là seed đỏ — và đỏ đúng lý do.
 */
export const ACTIVITIES = [
  {
    key: 'act-tet', title: 'Gặp mặt đầu xuân Bính Dần',
    category: 'gap_mat', uses_fund: true, status: 'done',
    starts_at: '2026-02-14T02:00:00Z', ends_at: '2026-02-14T10:00:00Z',
    summary: { body: 'Gặp mặt 47 người, chi phí thuê hội trường và nước uống.', total_spent: '4200000' },
  },
  {
    key: 'act-trung-thu', title: 'Trung thu cho các cháu',
    category: 'thien_nguyen', uses_fund: true, status: 'done',
    starts_at: '2025-09-28T10:00:00Z', ends_at: '2025-09-28T14:00:00Z',
    summary: { body: 'Tặng 120 suất quà, có bản kê chi tiết kèm theo.', total_spent: '9800000' },
  },
  {
    key: 'act-bong-da', title: 'Giải bóng đá giao hữu các khu vực',
    category: 'the_thao', uses_fund: false, status: 'done',
    starts_at: '2026-05-10T00:00:00Z', ends_at: '2026-05-10T09:00:00Z',
    summary: null,
  },
  {
    key: 'act-hoc-bong', title: 'Trao học bổng đầu năm học',
    category: 'thien_nguyen', uses_fund: true, status: 'planned',
    starts_at: futureDays(30), ends_at: futureDays(31),
    summary: null,
  },
].map((a, i) => ({
  ...a,
  id: id('activity:' + a.key),
  community_id: COMMUNITY_ID,
  description: 'Mô tả hoạt động mẫu.',
  area_id: areaAt(i),
  created_by: m('M01'),
  summary_id: a.summary ? id('activity_summary:' + a.key) : null,
}));

/**
 * 12 bút toán quỹ. Hai cái ≥ 1 triệu (ngưỡng `fund_two_approver_threshold`,
 * mặc định 1.000.000) có ĐỦ HAI CHỮ KÝ approver, và hai người ký đó KHÁC người
 * tạo bút toán — `fn_fund_valid_signatures` không đếm chữ ký của chính người
 * tạo, đúng tinh thần mục 7.4.
 *
 * `locked = true` cho hai bút toán lớn: sổ đã chốt. Hệ quả trực tiếp là chúng
 * chỉ ghi được MỘT LẦN (`trg_fund_entry_locked` chặn mọi UPDATE sau đó), nên
 * lần chạy seed thứ hai phải bỏ qua chứ không được `ON CONFLICT DO UPDATE`.
 */
// Mười bút toán còn lại đều DƯỚI một triệu — không phải chuyện thẩm mỹ:
// `fn_fund_two_approvers` so `abs(amount)` với ngưỡng, nên một khoản THU 3,5
// triệu cũng đòi hai chữ ký y như một khoản CHI 3,5 triệu. Đặc tả nói đúng hai
// bút toán ≥ 1 triệu, nên mười cái kia phải thật sự nhỏ hơn ngưỡng.
export const FUND_ENTRIES = [
  ['Thu quỹ tháng 01', '850000', '2026-01-05', false, null],
  ['Thu quỹ tháng 02', '900000', '2026-02-05', false, null],
  ['Chi nước uống buổi họp', '-320000', '2026-02-10', false, null],
  ['Chi in ấn giấy tờ', '-150000', '2026-02-18', false, null],
  ['Thu quỹ tháng 03', '880000', '2026-03-05', false, null],
  ['Chi thuê hội trường gặp mặt', '-4200000', '2026-02-15', true, ['M01', 'M02']],
  ['Thu ủng hộ của anh em xa', '640000', '2026-03-20', false, null],
  ['Chi quà trung thu cho các cháu', '-9800000', '2025-09-29', true, ['M02', 'M03']],
  ['Chi hoa viếng đám hiếu', '-500000', '2026-04-02', false, null],
  ['Thu quỹ tháng 04', '910000', '2026-04-05', false, null],
  ['Chi sửa loa đài dùng chung', '-780000', '2026-04-22', false, null],
  ['Thu lãi gửi ngân hàng', '210000', '2026-05-01', false, null],
].map(([purpose, amount, occurredOn, locked, signers], i) => ({
  id: id('fund_entry:' + i),
  community_id: COMMUNITY_ID,
  amount,
  purpose,
  occurred_on: occurredOn,
  activity_id: null,
  locked,
  // Người ghi sổ là M04 (`tech`), KHÔNG mang vai `approver` — nhờ vậy hai chữ
  // ký của bút toán lớn chắc chắn là của hai người khác.
  created_by: m('M04'),
  signers: (signers ?? []).map((c) => m(c)),
}));

/** 2 khoản vay TingTingVác. */
export const LOANS = [
  {
    key: 'loan-1', borrower: 'M15', amount: '15000000', status: 'disbursed',
    purpose: 'Mua máy hàn mới cho xưởng', due_on: '2026-12-31', disbursed_on: '2026-03-01',
    guarantors: ['M02', 'M05'],
  },
  {
    key: 'loan-2', borrower: 'M28', amount: '8000000', status: 'repaying',
    purpose: 'Sửa lại mái nhà sau bão', due_on: '2026-10-31', disbursed_on: '2026-01-15',
    guarantors: ['M03'],
  },
].map((l) => ({
  ...l,
  id: id('loan:' + l.key),
  community_id: COMMUNITY_ID,
  borrower_id: m(l.borrower),
  guarantor_ids: l.guarantors.map((c) => m(c)),
}));

export { monthsAgo };
