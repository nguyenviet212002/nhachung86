import { v5 as uuidv5 } from 'uuid';

// Namespace cố định của dữ liệu mẫu — đặc tả mục 12.1.
//
// VÌ SAO KHÔNG CÓ MỘT ID NGẪU NHIÊN NÀO TRONG THƯ MỤC NÀY: `npm run seed` phải
// chạy được mười lần mà vẫn ra đúng một bộ dữ liệu. Điều kiện đủ cho việc đó
// là mỗi hàng có một id TẤT ĐỊNH suy ra từ một khoá ổn định, để lần chạy thứ
// hai gặp lại chính hàng cũ (ON CONFLICT (id)) chứ không đẻ ra hàng mới.
// gen_random_uuid() của CSDL, crypto.randomUUID() của Node, hay bất cứ thứ gì
// phụ thuộc đồng hồ đều phá tính chất đó — và phá một cách IM LẶNG: lần chạy
// thứ hai vẫn "thành công", chỉ là cộng đồng có 104 người thay vì 52.
const NS = '6f2a1c3e-8b4d-5f6a-9c1e-2d3b4a5c6d7e';

/** UUIDv5 tất định từ một khoá đọc được, vd. id('member:M07'). */
export const id = (key) => uuidv5(key, NS);

export default id;
