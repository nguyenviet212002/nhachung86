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
 * 12 khu vực — đúng danh sách `AREAS` của giao diện (`web/index.html:969`),
 * đúng thứ tự. lat/lng là toạ độ xấp xỉ trong tỉnh Hưng Yên, đủ để thử
 * `earthdistance`: chúng nằm cách nhau vài kilômét thật, không phải số bịa
 * cùng một điểm.
 */
export const AREAS = [
  ['TP. Hưng Yên', 20.6464, 106.0511],
  ['Xã Văn Giang', 20.9333, 105.9333],
  ['Xã Khoái Châu', 20.8333, 105.9667],
  ['Xã Yên Mỹ', 20.8833, 106.0333],
  ['Xã Ân Thi', 20.8000, 106.1000],
  ['Xã Kim Động', 20.7333, 106.0333],
  ['Xã Phù Cừ', 20.7000, 106.2333],
  ['Xã Tiên Lữ', 20.6667, 106.1333],
  ['Phường Lam Sơn', 20.6500, 106.0600],
  ['Xã Tân Hưng', 20.6800, 106.0200],
  ['Xã Bảo Khê', 20.6700, 106.0300],
  ['Phường Hiến Nam', 20.6550, 106.0450],
].map(([name, lat, lng], i) => ({
  id: id(`area:${name}`),
  community_id: COMMUNITY_ID,
  name,
  lat,
  lng,
  idx: i,
}));

export const areaAt = (i) => AREAS[i % AREAS.length].id;
