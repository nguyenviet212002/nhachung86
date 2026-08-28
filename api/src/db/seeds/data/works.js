import { id } from '../ids.js';
import { COMMUNITY_ID } from './community.js';
import { MEMBERS, byCode, JOB_GROUPS } from './tree.js';

// ---------------------------------------------------------------------------
// Bản ghi việc — đặc tả mục 12.3.
//
// Ba nhóm, và mỗi nhóm tồn tại vì một bài kiểm thử cụ thể:
//   * 60 bản ghi ĐỦ XÁC NHẬN — đủ để có người ở bậc Mầm, Đồng, Bạc
//     (`core/trust.js`: 0 / 5 / 20 việc);
//   * 3 bản ghi MỚI MỘT BÊN xác nhận — cạnh `worked_together` CHƯA được hình
//     thành, dữ liệu cho T1;
//   * 1 bản ghi `manual` CHƯA DUYỆT — không được cộng vào bậc, dữ liệu cho T12.
//
// THỨ TỰ GHI KHÔNG TUỲ NGHI: bản ghi → người tham gia → xác nhận. Ngược lại
// không chạy được, vì `trg_work_participants_frozen` (migration 025) đóng băng
// danh sách người tham gia ngay khi có xác nhận đầu tiên, và `fn_work_edge`
// chỉ sinh cạnh khi MỌI người tham gia đã ký.
// ---------------------------------------------------------------------------

const m = (code) => byCode[code].id;
const code = (i) => 'M' + String(i).padStart(2, '0');

const TITLES = [
  'Sửa đường điện nhà ngang',
  'Thay đường nước sân sau',
  'Dựng mái tôn che sân',
  'Hàn lại cổng sắt',
  'Soát sổ sách quý',
  'Kèm Toán cho cháu lớp 8',
  'Nấu cỗ giỗ họ',
  'Rà hợp đồng thuê mặt bằng',
  'Chở vật liệu về công trình',
  'Đổ bê tông sân trước',
  'Lắp bình nóng lạnh',
  'Sơn lại tường ngoài',
];

// `done_on` lùi ngày để lịch sử việc trải cùng khoảng với lịch sử người.
const doneOn = (i) => {
  const d = new Date(Date.UTC(2022, 0, 1));
  d.setUTCDate(d.getUTCDate() + i * 19);
  return d.toISOString().slice(0, 10);
};

const SOURCES = ['signal', 'connection', 'aid', 'activity'];

/**
 * Phân bố cặp người sao cho bậc uy tín có đủ ba mức thật:
 *   * M01 làm 20 việc  → Bạc  (ngưỡng 20)
 *   * M02 làm  8 việc  → Đồng (ngưỡng 5)
 *   * M03 làm  6 việc  → Đồng
 *   * M04 làm  5 việc  → Đồng
 *   * mọi người còn lại 1–2 việc → Mầm
 * Người NHẬN việc (`receiver`) luôn khác người LÀM (`doer`) — hai vai này là
 * hai chiều ngược nhau và `fn_trust_recount` đếm chúng riêng.
 */
function buildPairs() {
  const pairs = [];
  for (let i = 0; i < 20; i++) pairs.push(['M01', code(6 + i)]);          // 20
  for (let i = 0; i < 8; i++) pairs.push(['M02', code(26 + i)]);          // 8
  for (let i = 0; i < 6; i++) pairs.push(['M03', code(34 + i)]);          // 6
  for (let i = 0; i < 5; i++) pairs.push(['M04', code(40 + i)]);          // 5
  for (let i = 0; i < 18; i++) pairs.push([code(5 + i), code(45 + (i % 8))]); // 18
  return pairs;                                                           // 57
}

const PAIRS = buildPairs();

/** 57 bản ghi không phải `manual`, đủ xác nhận. */
export const FULL_WORKS = PAIRS.map(([doer, receiver], i) => ({
  id: id('work:full:' + i),
  community_id: COMMUNITY_ID,
  source_type: SOURCES[i % SOURCES.length],
  source_id: null,
  title: TITLES[i % TITLES.length],
  done_on: doneOn(i),
  created_by: m(doer),
  participants: [[m(doer), 'doer'], [m(receiver), 'receiver']],
  confirmers: [m(doer), m(receiver)],
  review: null,
}));

/**
 * 3 bản ghi `manual` ĐÃ DUYỆT — cùng với 57 bản trên là đúng 60 bản đủ xác
 * nhận. Người duyệt là M01 (`approver`) và M01 KHÔNG tham gia ba việc này:
 * `fn_work_review_gate` từ chối người duyệt là người trong cuộc.
 *
 * Chúng được ghi lúc đầu KHÔNG có `reviewed_by`/`reviewed_at`: cũng chính
 * trigger ấy từ chối một bản ghi `manual` sinh ra đã duyệt sẵn
 * (`MANUAL_REVIEW_BEFORE_WORK`) — việc phải xảy ra trước khi có người duyệt nó.
 */
export const MANUAL_REVIEWED = [
  ['M06', 'M07'], ['M08', 'M09'], ['M10', 'M11'],
].map(([a, b], i) => ({
  id: id('work:manual-reviewed:' + i),
  community_id: COMMUNITY_ID,
  source_type: 'manual',
  source_id: null,
  title: 'Ghi bù việc đã làm giúp nhau',
  done_on: doneOn(60 + i),
  created_by: m(a),
  participants: [[m(a), 'doer'], [m(b), 'receiver']],
  confirmers: [m(a), m(b)],
  review: { by: m('M01'), at: '2026-01-10T03:00:00Z' },
}));

/**
 * 3 bản ghi MỚI MỘT BÊN xác nhận — dữ liệu cho T1. Cạnh `worked_together`
 * không được xuất hiện chừng nào người thứ hai chưa ký.
 */
export const HALF_WORKS = [
  ['M14', 'M15'], ['M16', 'M17'], ['M18', 'M19'],
].map(([a, b], i) => ({
  id: id('work:half:' + i),
  community_id: COMMUNITY_ID,
  source_type: 'connection',
  source_id: null,
  title: 'Việc vừa xong, còn chờ bên kia xác nhận',
  done_on: doneOn(70 + i),
  created_by: m(a),
  participants: [[m(a), 'doer'], [m(b), 'receiver']],
  confirmers: [m(a)],                       // CỐ Ý thiếu một chữ ký
  review: null,
}));

/**
 * 1 bản ghi `manual` CHƯA DUYỆT — dữ liệu cho T12. Đủ hai chữ ký nhưng
 * `reviewed_at` còn trống, nên `fn_trust_recount` đếm nó vào `manual_works`
 * mà KHÔNG đếm vào `confirmed_works`. Đó là toàn bộ nội dung của mục 4.4:
 * `manual` là cửa đúc bậc uy tín, nên nó phải đi qua một người duyệt.
 */
export const MANUAL_PENDING = [
  {
    id: id('work:manual-pending:0'),
    community_id: COMMUNITY_ID,
    source_type: 'manual',
    source_id: null,
    title: 'Ghi bù việc đã làm, chưa có ai duyệt',
    done_on: doneOn(74),
    created_by: m('M12'),
    participants: [[m('M12'), 'doer'], [m('M13'), 'receiver']],
    confirmers: [m('M12'), m('M13')],
    review: null,
  },
];

export const ALL_WORKS = [...FULL_WORKS, ...MANUAL_REVIEWED, ...HALF_WORKS, ...MANUAL_PENDING];

/**
 * 148 năng lực rải theo danh mục nhóm ngành — đặc tả mục 12.3.
 *
 * ĐỌC KỸ TRƯỚC KHI TRÍCH DẪN: `148` và `7` là SỐ MINH HOẠ lấy từ giao diện
 * demo (đặc tả mục 15.2), không phải số liệu thật của Hội.
 *
 * Lệch có chủ đích khỏi đặc tả: đặc tả nói "vài cái `pending_review`", nhưng
 * `capabilities.status` chỉ nhận `draft`/`published`/`hidden` (migration 013)
 * — không có `pending_review` trong lược đồ. Dùng `draft` cho nhóm đó, vì đó
 * là trạng thái "chưa hiện ra cho cộng đồng" duy nhất mà bảng có.
 */
export const CAPABILITIES = Array.from({ length: 148 }, (_, i) => {
  const owner = MEMBERS[i % MEMBERS.length];
  return {
    id: id('capability:' + i),
    community_id: COMMUNITY_ID,
    member_id: owner.id,
    title: TITLES[i % TITLES.length] + ' — ' + JOB_GROUPS[i % JOB_GROUPS.length],
    description: 'Nhận việc trong khu vực, báo trước một ngày.',
    category: JOB_GROUPS[i % JOB_GROUPS.length],
    price: i % 5 === 0 ? 'Thoả thuận' : null,
    years_experience: 2 + (i % 15),
    status: i % 12 === 0 ? 'draft' : 'published',
  };
});
