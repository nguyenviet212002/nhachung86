import { id } from '../ids.js';
import { COMMUNITY_ID, areaAt } from './community.js';

// ---------------------------------------------------------------------------
// Cây bảo lãnh 52 người — đặc tả mục 12.2.
//
// Một gốc, rồi bốn tầng dưới nó. `created_at` lùi ngày trải 2019 → 2026 để
// LỊCH SỬ TỰ NÓ HỢP LỆ: không ai vượt 3 lượt bảo lãnh trong bất kỳ cửa sổ 12
// tháng trượt nào. Kiểm được bằng mắt trong bảng dưới (ngày của cùng một người
// bảo lãnh cách nhau ít nhất năm tháng), và kiểm được bằng máy vì chính
// `fn_guarantee_quota` chạy trên từng dòng lúc seed — nếu bảng này sai, seed
// đỏ chứ không âm thầm gieo một lịch sử phạm luật.
//
// NGÀY TUYỆT ĐỐI hay NGÀY TƯƠNG ĐỐI: phần lịch sử dùng ngày tuyệt đối, đúng
// như đặc tả vẽ. Nhưng ba đơn "chạm hạn mức" của M07 và hai đơn bị từ chối của
// M09/M10 phải nằm TRONG 12 tháng gần nhất mới có nghĩa, mà "gần nhất" thì
// trôi theo ngày chạy seed. Chúng dùng mốc tương đối (`monthsAgo`), nếu không
// thì bộ dữ liệu mẫu tự hết hạn vào một ngày nào đó và bài test hạn mức chuyển
// sang xanh giả.
// ---------------------------------------------------------------------------

export function monthsAgo(n, day = 15) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n, day);
  d.setUTCHours(3, 0, 0, 0);
  return d.toISOString();
}

const NAMES = [
  'Nguyễn Văn Hùng', 'Trần Thu Hà', 'Phạm Minh Tuấn', 'Nguyễn Thị Lan',
  'Bùi Đức Anh', 'Lê Quốc Bảo', 'Đỗ Văn Sơn', 'Vũ Thị Hồng',
  'Ngô Thị Hiền', 'Phạm Văn Dũng', 'Lê Quang Minh', 'Trần Thị Lan',
  'Vũ Minh Hải', 'Nguyễn Đình Khoa', 'Hoàng Thị Nga', 'Đặng Văn Thắng',
  'Lý Thị Mai', 'Trịnh Văn Cường', 'Phan Thị Thuý', 'Dương Văn Lộc',
  'Nguyễn Thị Bình', 'Tạ Quang Huy', 'Đỗ Thị Nhung', 'Mai Văn Trung',
  'Hoàng Văn Kiên', 'Nguyễn Thị Vân', 'Lê Thị Hoa', 'Trần Văn Nam',
  'Bùi Thị Thanh', 'Vũ Văn Long', 'Nguyễn Văn Tài', 'Phạm Thị Yến',
  'Đinh Văn Phúc', 'Nguyễn Thị Nhàn', 'Lê Văn Sáng', 'Trần Thị Kim',
  'Hoàng Văn Đại', 'Nguyễn Thị Loan', 'Phạm Văn Quý', 'Đỗ Văn Hiếu',
  'Lê Thị Hạnh', 'Trần Văn Tiến', 'Nguyễn Văn Chiến', 'Vũ Thị Đào',
  'Bùi Văn Toàn', 'Nguyễn Thị Tuyết', 'Phạm Văn Lâm', 'Lê Văn Cảnh',
  'Trần Thị Ngọc', 'Nguyễn Văn Hoà', 'Đặng Thị Xuân', 'Hoàng Văn Sinh',
];

// Danh mục nhóm ngành dùng chung cho dữ liệu mẫu và Trung tâm năng lực.
// Đây vẫn là dữ liệu minh hoạ, không phải số liệu thật của Hội.
export const JOB_GROUPS = [
  'Điện — nước dân dụng',
  'Xây dựng, sửa chữa',
  'Cơ khí, cửa sắt',
  'Nội thất, mộc, nhôm kính',
  'Sơn, chống thấm, hoàn thiện',
  'Vận tải, giao hàng',
  'Sửa xe, máy móc',
  'Nông nghiệp, chăn nuôi',
  'Cây cảnh, môi trường',
  'Ẩm thực, thực phẩm',
  'May mặc, thời trang',
  'Làm đẹp, dịch vụ cá nhân',
  'Chăm sóc trẻ và người cao tuổi',
  'Dạy kèm, đào tạo',
  'Công nghệ, thiết kế, truyền thông',
  'Kế toán, thuế',
  'Kinh doanh, bán hàng',
  'Tư vấn pháp lý',
  'Y tế, chăm sóc sức khỏe',
  'Du lịch, lưu trú',
];

// [mã, người bảo lãnh, ngày gia nhập]. null = gốc của cộng đồng.
const ROWS = [
  ['M01', null, '2019-03-10'],
  ['M02', 'M01', '2019-06-12'], ['M03', 'M01', '2019-09-18'], ['M04', 'M01', '2020-01-20'],

  ['M05', 'M02', '2020-03-14'], ['M06', 'M02', '2020-09-08'], ['M07', 'M02', '2021-04-22'],
  ['M08', 'M03', '2020-05-19'], ['M09', 'M03', '2020-11-03'], ['M10', 'M03', '2021-06-15'],
  ['M11', 'M04', '2021-02-09'], ['M12', 'M04', '2021-08-24'], ['M13', 'M04', '2021-12-06'],

  ['M14', 'M05', '2022-02-11'], ['M15', 'M05', '2022-07-19'], ['M16', 'M05', '2023-03-05'],
  ['M17', 'M05', '2024-01-16'],
  ['M18', 'M06', '2022-04-08'], ['M19', 'M06', '2022-10-21'], ['M20', 'M06', '2023-06-13'],
  ['M21', 'M06', '2024-05-02'],
  // M22 là đơn 'approved' trong ba đơn chạm hạn mức của M07 — mốc tương đối.
  ['M22', 'M07', monthsAgo(10)],
  ['M23', 'M08', '2022-03-17'], ['M24', 'M08', '2022-11-09'], ['M25', 'M08', '2023-08-25'],
  ['M26', 'M09', '2022-05-06'], ['M27', 'M09', '2023-01-30'], ['M28', 'M09', '2023-10-12'],
  ['M29', 'M10', '2022-06-28'], ['M30', 'M10', '2023-02-14'], ['M31', 'M10', '2023-11-20'],
  ['M32', 'M11', '2022-08-03'], ['M33', 'M11', '2023-04-27'], ['M34', 'M11', '2024-02-08'],
  ['M35', 'M12', '2022-09-15'], ['M36', 'M12', '2023-05-11'], ['M37', 'M12', '2024-03-19'],
  ['M38', 'M13', '2022-12-01'], ['M39', 'M13', '2023-07-07'], ['M40', 'M13', '2024-04-23'],

  ['M41', 'M14', '2025-01-14'], ['M42', 'M15', '2025-02-25'], ['M43', 'M16', '2025-04-09'],
  ['M44', 'M17', '2025-05-21'], ['M45', 'M18', '2025-07-02'], ['M46', 'M19', '2025-08-18'],
  ['M47', 'M20', '2025-10-06'], ['M48', 'M21', '2025-11-27'], ['M49', 'M22', '2026-01-15'],
  ['M50', 'M23', '2026-02-24'], ['M51', 'M24', '2026-04-11'], ['M52', 'M25', '2026-06-03'],
];

const iso = (s) => (s.includes('T') ? s : s + 'T03:00:00Z');

export const MEMBERS = ROWS.map(([code, ref, joined], i) => ({
  code,
  id: id('member:' + code),
  community_id: COMMUNITY_ID,
  full_name: NAMES[i],
  birth_year: 1986,
  // Miền `.invalid` là miền cấp cao được RFC 2606 dành riêng cho ví dụ và
  // KHÔNG BAO GIỜ phân giải được. Dữ liệu mẫu không được mang địa chỉ có thật
  // của người thật, và cũng không được mang địa chỉ trông thật tới mức có ai
  // đó gửi thư vào đó.
  email: code.toLowerCase() + '@nhachung.invalid',
  job: JOB_GROUPS[i % JOB_GROUPS.length],
  area_id: areaAt(i),
  referrer_code: ref,
  referrer_id: ref ? id('member:' + ref) : null,
  joined_at: iso(joined),
  // Số điện thoại giả, khác nhau từng người (idx_contacts_phone là UNIQUE theo
  // cộng đồng).
  phone: '0900' + String(100000 + i).slice(1),
  idx: i,
}));

export const byCode = Object.fromEntries(MEMBERS.map((m) => [m.code, m]));

/**
 * Đơn gia nhập. Mỗi thành viên có người bảo lãnh cần MỘT đơn đã duyệt kèm
 * `met_confirmed_at` — không phải cho đẹp: `trg_member_status_gate` (migration
 * 010) là constraint trigger hoãn tới COMMIT, nó tra đúng hàng này theo
 * `member_id`. Không có đơn thì không có thành viên.
 */
export const JOIN_REQUESTS = MEMBERS.filter((m) => m.referrer_id).map((m) => ({
  id: id('join_request:' + m.code),
  community_id: COMMUNITY_ID,
  referrer_id: m.referrer_id,
  member_id: m.id,
  status: 'approved',
  step: 5,
  created_at: m.joined_at,
  met_at: m.joined_at,
  approved_by: id('member:M01'),
  reject: null,
  applicant: {
    full_name: m.full_name,
    birth_year: m.birth_year,
    email: m.email,
    job: m.job,
    area_id: m.area_id,
  },
}));

/**
 * Ba đơn CHẠM HẠN MỨC của M07 (đặc tả mục 12.2): đúng ba đơn còn tiêu suất
 * trong 12 tháng gần nhất — 'pending', 'met_confirmed', 'approved'. Đơn thứ tư
 * phải ném GUARANTEE_QUOTA_EXCEEDED; đó là dữ liệu cho T6 và cho T22.
 *
 * Đơn 'approved' chính là đơn của M22 ở bảng trên, nên ở đây chỉ còn hai đơn
 * chưa có thành viên tương ứng.
 *
 * Kèm hai đơn bị từ chối để có dữ liệu cho hai NHÁNH NGƯỢC NHAU của hạn mức:
 *   * M09 / 'referrer_misrepresented' — suất KHÔNG được trả lại (người khai
 *     gian mất suất vĩnh viễn);
 *   * M10 / 'not_ready' — suất ĐƯỢC trả lại (người bảo lãnh ngay tình không bị
 *     phạt vì quyết định của ban duyệt).
 */
export const EXTRA_REQUESTS = [
  {
    id: id('join_request:M07-pending'),
    referrer_code: 'M07', status: 'pending', step: 2,
    created_at: monthsAgo(1, 8), met_at: null, reject: null, member_id: null,
    approved_by: null,
    applicant: { full_name: 'Nguyễn Văn Đông', birth_year: 1986, job: JOB_GROUPS[0], area_id: areaAt(3) },
  },
  {
    id: id('join_request:M07-met'),
    referrer_code: 'M07', status: 'met_confirmed', step: 3,
    created_at: monthsAgo(5, 20), met_at: monthsAgo(4, 6), reject: null, member_id: null,
    approved_by: null,
    applicant: { full_name: 'Trần Văn Hải', birth_year: 1986, job: JOB_GROUPS[1], area_id: areaAt(5) },
  },
  {
    id: id('join_request:M09-rejected'),
    referrer_code: 'M09', status: 'rejected', step: 3,
    created_at: monthsAgo(2, 4), met_at: null, reject: 'referrer_misrepresented', member_id: null,
    approved_by: null,
    applicant: { full_name: 'Lê Văn Bốn', birth_year: 1986, job: JOB_GROUPS[2], area_id: areaAt(7) },
  },
  {
    id: id('join_request:M10-rejected'),
    referrer_code: 'M10', status: 'rejected', step: 2,
    created_at: monthsAgo(2, 18), met_at: null, reject: 'not_ready', member_id: null,
    approved_by: null,
    applicant: { full_name: 'Phạm Thị Năm', birth_year: 1986, job: JOB_GROUPS[3], area_id: areaAt(9) },
  },
].map((r) => ({ ...r, community_id: COMMUNITY_ID, referrer_id: id('member:' + r.referrer_code) }));

/**
 * Vai — đặc tả mục 6. Người gốc M01 mang cả `tech` lẫn `approver`: một cộng
 * đồng mới sinh chỉ có một người, và người đó phải mở được cửa cho những người
 * sau. M02/M03 là hai `approver` KHÁC NHAU để khung hai người ký có đủ hai con
 * người thật mà ký (mục 7.4: phần mềm chỉ biết đó là hai `member_id` khác
 * nhau, phần còn lại là việc của cộng đồng).
 */
export const ROLE_GRANTS = [
  ['M01', 'tech'], ['M01', 'approver'], ['M01', 'member'],
  ['M02', 'approver'], ['M02', 'member'],
  ['M03', 'approver'], ['M03', 'member'],
  ['M04', 'tech'], ['M04', 'member'],
  ['M05', 'content_ops'], ['M05', 'member'],
  ...MEMBERS
    .filter((m) => !['M01', 'M02', 'M03', 'M04', 'M05'].includes(m.code))
    .map((m) => [m.code, 'member']),
];
