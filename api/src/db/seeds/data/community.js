import { id } from '../ids.js';

export const COMMUNITY_ID = id('community:binhdan1986');
export const COMMUNITY_CODE = 'binhdan1986';

/**
 * Chính sách của cộng đồng — đặc tả mục 15.1. KHÔNG con số nào ở đây được viết
 * cứng trong mã nguồn: cộng đồng thứ hai có quyền khác.
 *
 * Từ migration 028, cột này KHÔNG sửa được bằng một câu UPDATE trần, kể cả
 * bằng kết nối chủ sở hữu. Seed đặt nó lúc TẠO cộng đồng (INSERT không bị
 * trg_community_config_guard chặn — trigger đó chỉ nghe UPDATE); nếu về sau
 * giá trị mong muốn khác giá trị đang có, seed đi qua khung hai người ký, xem
 * `ensureConfig()` trong run.js.
 */
export const CONFIG = {
  birth_year: 1986,
  guarantee_quota_per_year: 3,
  guarantee_window_months: 12,
  manual_pair_quota: 6,
  manual_pair_window_months: 12,
  two_person_expiry_hours: 24,
  privacy_defaults: [
    { field_key: 'phone', level: 'on_consent' },
    { field_key: 'zalo', level: 'on_consent' },
    { field_key: 'messenger', level: 'public' },
    { field_key: 'address', level: 'closed' },
    { field_key: 'family', level: 'closed' },
    { field_key: 'job', level: 'public' },
    { field_key: 'area', level: 'public' },
    { field_key: 'price', level: 'public' },
  ],
};

/**
 * Danh mục hiện hành sau sắp xếp đơn vị hành chính năm 2025.
 *
 * Tên và thứ tự bám theo Nghị quyết 1666/NQ-UBTVQH15: 93 xã, 11 phường.
 * Toạ độ không phải dữ liệu bắt buộc của luồng đăng ký nên để null thay vì
 * tự bịa điểm đại diện. Các bản ghi cũ được giữ lại trong DB ở trạng thái
 * không hoạt động bởi migration 035 để không làm mất liên kết lịch sử.
 */
export const HUNG_YEN_2025_AREA_NAMES = [
  ['Xã Tân Hưng', 'xã'],
  ['Xã Hoàng Hoa Thám', 'xã'],
  ['Xã Tiên Lữ', 'xã'],
  ['Xã Tiên Hoa', 'xã'],
  ['Xã Quang Hưng', 'xã'],
  ['Xã Đoàn Đào', 'xã'],
  ['Xã Tiên Tiến', 'xã'],
  ['Xã Tống Trân', 'xã'],
  ['Xã Lương Bằng', 'xã'],
  ['Xã Nghĩa Dân', 'xã'],
  ['Xã Hiệp Cường', 'xã'],
  ['Xã Đức Hợp', 'xã'],
  ['Xã Ân Thi', 'xã'],
  ['Xã Xuân Trúc', 'xã'],
  ['Xã Phạm Ngũ Lão', 'xã'],
  ['Xã Nguyễn Trãi', 'xã'],
  ['Xã Hồng Quang', 'xã'],
  ['Xã Khoái Châu', 'xã'],
  ['Xã Triệu Việt Vương', 'xã'],
  ['Xã Việt Tiến', 'xã'],
  ['Xã Chí Minh', 'xã'],
  ['Xã Châu Ninh', 'xã'],
  ['Xã Yên Mỹ', 'xã'],
  ['Xã Việt Yên', 'xã'],
  ['Xã Hoàn Long', 'xã'],
  ['Xã Nguyễn Văn Linh', 'xã'],
  ['Xã Như Quỳnh', 'xã'],
  ['Xã Lạc Đạo', 'xã'],
  ['Xã Đại Đồng', 'xã'],
  ['Xã Nghĩa Trụ', 'xã'],
  ['Xã Phụng Công', 'xã'],
  ['Xã Văn Giang', 'xã'],
  ['Xã Mễ Sở', 'xã'],
  ['Xã Thái Thụy', 'xã'],
  ['Xã Đông Thụy Anh', 'xã'],
  ['Xã Bắc Thụy Anh', 'xã'],
  ['Xã Thụy Anh', 'xã'],
  ['Xã Nam Thụy Anh', 'xã'],
  ['Xã Bắc Thái Ninh', 'xã'],
  ['Xã Thái Ninh', 'xã'],
  ['Xã Đông Thái Ninh', 'xã'],
  ['Xã Nam Thái Ninh', 'xã'],
  ['Xã Tây Thái Ninh', 'xã'],
  ['Xã Tây Thụy Anh', 'xã'],
  ['Xã Tiền Hải', 'xã'],
  ['Xã Tây Tiền Hải', 'xã'],
  ['Xã Ái Quốc', 'xã'],
  ['Xã Đồng Châu', 'xã'],
  ['Xã Đông Tiền Hải', 'xã'],
  ['Xã Nam Cường', 'xã'],
  ['Xã Hưng Phú', 'xã'],
  ['Xã Nam Tiền Hải', 'xã'],
  ['Xã Đông Hưng', 'xã'],
  ['Xã Bắc Tiên Hưng', 'xã'],
  ['Xã Đông Tiên Hưng', 'xã'],
  ['Xã Nam Đông Hưng', 'xã'],
  ['Xã Bắc Đông Quan', 'xã'],
  ['Xã Bắc Đông Hưng', 'xã'],
  ['Xã Đông Quan', 'xã'],
  ['Xã Nam Tiên Hưng', 'xã'],
  ['Xã Tiên Hưng', 'xã'],
  ['Xã Quỳnh Phụ', 'xã'],
  ['Xã Minh Thọ', 'xã'],
  ['Xã Nguyễn Du', 'xã'],
  ['Xã Quỳnh An', 'xã'],
  ['Xã Ngọc Lâm', 'xã'],
  ['Xã Đồng Bằng', 'xã'],
  ['Xã A Sào', 'xã'],
  ['Xã Phụ Dực', 'xã'],
  ['Xã Tân Tiến', 'xã'],
  ['Xã Hưng Hà', 'xã'],
  ['Xã Tiên La', 'xã'],
  ['Xã Lê Quý Đôn', 'xã'],
  ['Xã Hồng Minh', 'xã'],
  ['Xã Thần Khê', 'xã'],
  ['Xã Diên Hà', 'xã'],
  ['Xã Ngự Thiên', 'xã'],
  ['Xã Long Hưng', 'xã'],
  ['Xã Kiến Xương', 'xã'],
  ['Xã Lê Lợi', 'xã'],
  ['Xã Quang Lịch', 'xã'],
  ['Xã Vũ Quý', 'xã'],
  ['Xã Bình Thanh', 'xã'],
  ['Xã Bình Định', 'xã'],
  ['Xã Hồng Vũ', 'xã'],
  ['Xã Bình Nguyên', 'xã'],
  ['Xã Trà Giang', 'xã'],
  ['Xã Vũ Thư', 'xã'],
  ['Xã Thư Trì', 'xã'],
  ['Xã Tân Thuận', 'xã'],
  ['Xã Thư Vũ', 'xã'],
  ['Xã Vũ Tiên', 'xã'],
  ['Xã Vạn Xuân', 'xã'],
  ['Phường Phố Hiến', 'phường'],
  ['Phường Sơn Nam', 'phường'],
  ['Phường Hồng Châu', 'phường'],
  ['Phường Mỹ Hào', 'phường'],
  ['Phường Đường Hào', 'phường'],
  ['Phường Thượng Hồng', 'phường'],
  ['Phường Thái Bình', 'phường'],
  ['Phường Trần Lãm', 'phường'],
  ['Phường Trần Hưng Đạo', 'phường'],
  ['Phường Trà Lý', 'phường'],
  ['Phường Vũ Phúc', 'phường'],
];

/**
 * 34 tỉnh/thành sau sáp nhập 2025 (Nghị quyết 60-NQ/TW, hiệu lực từ
 * 01/07/2025) — 28 tỉnh + 6 thành phố trực thuộc trung ương. Đây là CẤP CHA
 * mới của cây khu vực: cộng đồng vốn dựng quanh Hưng Yên, nên "Tỉnh Hưng Yên"
 * nhận nguyên 104 xã/phường ở trên làm con; 33 tỉnh/thành còn lại CHƯA có danh
 * mục xã/phường chi tiết — thành viên ở nơi khác chọn tới cấp tỉnh, chi tiết
 * hơn bổ sung dần khi cộng đồng có người thật ở đấy (đặc tả bổ sung: "khu vực
 * không chỉ Hưng Yên mà toàn bộ Việt Nam").
 *
 * Thứ tự Bắc → Nam để màn chọn khu vực không xáo trộn ngẫu nhiên.
 */
export const PROVINCES_VN_2025 = [
  ['Thành phố Hà Nội', 'thanh-pho'],
  ['Tỉnh Cao Bằng', 'tinh'],
  ['Tỉnh Điện Biên', 'tinh'],
  ['Tỉnh Lai Châu', 'tinh'],
  ['Tỉnh Lạng Sơn', 'tinh'],
  ['Tỉnh Lào Cai', 'tinh'],
  ['Tỉnh Phú Thọ', 'tinh'],
  ['Tỉnh Quảng Ninh', 'tinh'],
  ['Tỉnh Sơn La', 'tinh'],
  ['Tỉnh Thái Nguyên', 'tinh'],
  ['Tỉnh Tuyên Quang', 'tinh'],
  ['Thành phố Hải Phòng', 'thanh-pho'],
  ['Tỉnh Bắc Ninh', 'tinh'],
  ['Tỉnh Hưng Yên', 'tinh'],
  ['Tỉnh Ninh Bình', 'tinh'],
  ['Tỉnh Thanh Hóa', 'tinh'],
  ['Tỉnh Nghệ An', 'tinh'],
  ['Tỉnh Hà Tĩnh', 'tinh'],
  ['Tỉnh Quảng Trị', 'tinh'],
  ['Thành phố Huế', 'thanh-pho'],
  ['Thành phố Đà Nẵng', 'thanh-pho'],
  ['Tỉnh Quảng Ngãi', 'tinh'],
  ['Tỉnh Gia Lai', 'tinh'],
  ['Tỉnh Đắk Lắk', 'tinh'],
  ['Tỉnh Khánh Hòa', 'tinh'],
  ['Tỉnh Lâm Đồng', 'tinh'],
  ['Tỉnh Đồng Nai', 'tinh'],
  ['Tỉnh Tây Ninh', 'tinh'],
  ['Thành phố Hồ Chí Minh', 'thanh-pho'],
  ['Tỉnh Đồng Tháp', 'tinh'],
  ['Tỉnh An Giang', 'tinh'],
  ['Tỉnh Vĩnh Long', 'tinh'],
  ['Thành phố Cần Thơ', 'thanh-pho'],
  ['Tỉnh Cà Mau', 'tinh'],
];

export const PROVINCE_AREAS = PROVINCES_VN_2025.map(([name], i) => ({
  id: id(`province:${name}`),
  community_id: COMMUNITY_ID,
  name,
  parent_id: null,
  lat: null,
  lng: null,
  is_active: true,
  idx: i,
}));

const HUNG_YEN_PROVINCE_ID = PROVINCE_AREAS.find((p) => p.name === 'Tỉnh Hưng Yên').id;

export const AREAS = HUNG_YEN_2025_AREA_NAMES.map(([name], i) => ({
  id: id(`area:${name}`),
  community_id: COMMUNITY_ID,
  name,
  parent_id: HUNG_YEN_PROVINCE_ID,
  lat: null,
  lng: null,
  is_active: true,
  idx: i,
}));

export const areaAt = (i) => AREAS[i % AREAS.length].id;

/** Toàn bộ hàng cần ghi vào bảng `areas`: 34 tỉnh/thành (gốc) + 104 xã/phường
 * của Hưng Yên (lá). `areaAt()` ở trên CỐ Ý chỉ cuộn qua `AREAS` (lá) — gán
 * area_id cấp tỉnh cho một member/applicant mẫu là sai (tỉnh không phải nơi ở
 * cụ thể), nên seed thành viên không được đổi sang dùng mảng này. */
export const ALL_AREAS = [...PROVINCE_AREAS, ...AREAS];
