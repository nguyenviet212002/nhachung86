import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// CORS — đặc tả mục 5.1 dòng 736: "CORS chỉ cho `binhdan1986.com`".
//
// KHÔNG có `*` ở bất kỳ nhánh nào. Giá trị trả về luôn là ĐÚNG chuỗi Origin mà
// client gửi lên và ta đã công nhận, không phải một ký tự đại diện: `*` biến
// mọi trang trên Internet thành nơi gọi được API này, và nó cũng không hợp lệ
// khi có thông tin xác thực.
//
// `CORS_ORIGIN` cho phép nhiều gốc ngăn bởi dấu phẩy (production một gốc; lúc
// phát triển hay cần thêm `http://localhost:5173`). Đối chiếu là SO KHỚP ĐÚNG
// CHUỖI, không phải `startsWith`/regex: `startsWith('https://binhdan1986.com')`
// nhận cả `https://binhdan1986.com.ke-gian.vn`.
// ---------------------------------------------------------------------------
const ALLOWED = config.CORS_ORIGIN.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOW_HEADERS = 'authorization, content-type';
const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export function cors(req, res, next) {
  // `Vary: Origin` đặt cho MỌI phản hồi, kể cả phản hồi không có Origin. Thiếu
  // nó thì một proxy đứng giữa có thể phục vụ lại bản đã cache (có
  // Access-Control-Allow-Origin của gốc hợp lệ) cho một gốc khác — tức bộ nhớ
  // đệm vô hiệu hóa chính chốt chặn này.
  res.vary('Origin');

  const origin = req.headers.origin;

  // Không có Origin: lời gọi cùng gốc, hoặc curl/máy chủ gọi máy chủ. CORS
  // không nói gì về trường hợp này — đi tiếp, không thêm header nào.
  if (!origin) {
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }

  const allowed = ALLOWED.includes(origin);

  if (allowed) {
    res.set('Access-Control-Allow-Origin', origin);
    // KHÔNG đặt Access-Control-Allow-Credentials: xác thực đi bằng
    // `Authorization: Bearer`, không bằng cookie. Bật cờ đó là mở thêm quyền
    // mà không ai cần.
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', ALLOW_METHODS);
      res.set('Access-Control-Allow-Headers', ALLOW_HEADERS);
      res.set('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    return next();
  }

  // ----- Origin lạ -----
  //
  // Preflight thì TỪ CHỐI THẲNG bằng 403: đây là câu hỏi "tôi có được gọi
  // không?" và câu trả lời là không. Mọi lời gọi đổi trạng thái của API này
  // đều kéo theo preflight (thân JSON `content-type: application/json` và/hoặc
  // header `Authorization`), nên đây là chỗ chặn có thật chứ không phải hình
  // thức.
  if (req.method === 'OPTIONS') {
    return res.status(403).json({
      error: { code: 'CORS_ORIGIN_NOT_ALLOWED', message: 'Gốc yêu cầu không được phép gọi API này.' },
    });
  }

  // Yêu cầu "đơn giản" (GET không có header lạ) không có preflight nên nó vẫn
  // tới được đây. Ta KHÔNG chặn nó bằng 403, và nói rõ vì sao: một client
  // không phải trình duyệt hoàn toàn có thể gửi kèm Origin, chặn thẳng là hỏng
  // những thứ chẳng liên quan gì tới bảo mật. Thứ thật sự phải giữ là TRANG
  // KHÁC KHÔNG ĐỌC ĐƯỢC PHẢN HỒI — và điều đó có được bằng cách không phát
  // Access-Control-Allow-Origin: trình duyệt vứt bỏ phản hồi trước khi mã
  // JavaScript của trang đó nhìn thấy một byte nào.
  return next();
}
