import { AppError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Đọc `multipart/form-data` — đúng một phần tệp, và không hơn.
//
// VÌ SAO VIẾT TAY THAY VÌ THÊM `busboy`: đây là toàn bộ nhu cầu của giai đoạn 1
// (một ảnh ≤ 10 MB cho `POST /files`), và một phụ thuộc mới ở tầng nhận byte
// chưa qua kiểm là một bề mặt tấn công mới phải theo dõi bản vá suốt đời dự
// án. Đổi lại: đoạn dưới đây phải đúng, nên nó có bài test riêng (`t28`) cho
// cả ca hỏng — thiếu boundary, thân rỗng, hai phần tệp, vượt giới hạn.
//
// ĐÁNH ĐỔI ĐÃ GHI NHẬN: nó gom cả phần vào bộ nhớ thay vì chảy thẳng xuống
// kho. Ở mức 10 MB và ~52 người thì không đáng kể, và nó đổi lấy một thứ thật:
// **magic bytes phải đọc được TRƯỚC khi có gì được ghi ra đĩa**. Một trình
// phân tích chảy thẳng sẽ ghi trước, kiểm sau — tức là có một khoảnh khắc tệp
// lạ đã nằm trong kho. Nếu về sau cần nhận video, phải đổi cách này, và khi ấy
// việc kiểm loại phải chuyển thành "đọc 32 byte đầu rồi mới mở đường ghi".
//
// GIỚI HẠN KÍCH THƯỚC ĐƯỢC ÉP TRONG LÚC ĐỌC, không phải sau khi đọc xong: một
// người gửi 2 GB không được phép làm đầy bộ nhớ máy chủ rồi mới bị từ chối.
// ---------------------------------------------------------------------------

const CRLF = Buffer.from('\r\n');
const CRLFCRLF = Buffer.from('\r\n\r\n');

function boundaryOf(contentType) {
  if (!contentType) return null;
  const [type, ...params] = contentType.split(';').map((s) => s.trim());
  if (type.toLowerCase() !== 'multipart/form-data') return null;
  for (const p of params) {
    const eq = p.indexOf('=');
    if (eq === -1) continue;
    if (p.slice(0, eq).trim().toLowerCase() !== 'boundary') continue;
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    return v || null;
  }
  return null;
}

// Đọc thân, có trần. Ba hành vi, và cái thứ hai là cái đắt tiền để học:
//
//   1. Vượt trần ⇒ **buông ngay** những gì đã giữ. Bộ nhớ máy chủ được bảo vệ
//      ở đây, không phải ở câu `if` cuối hàm.
//   2. Nhưng vẫn **đọc nốt rồi vứt**. Bản đầu cắt kết nối ngay (`req.destroy()`)
//      và nó sai theo cách chỉ chạy thật mới thấy: socket chết trước khi phản
//      hồi 413 kịp ra dây, client nhận `ECONNRESET` — người dùng thấy "mất
//      mạng" thay vì "ảnh quá nặng", đúng lúc câu giải thích là thứ duy nhất
//      giúp được họ. Bản thứ hai chỉ `pause()`, và vẫn hỏng y hệt vì Node đóng
//      socket khi phản hồi xong mà thân chưa đọc hết. Đọc nốt là cách duy nhất
//      để câu trả lời tới được nơi cần tới.
//   3. Trừ khi lượng phải vứt trở nên vô lý (`drainCap`). Người gửi 2 GB không
//      xứng đáng được lịch sự, và lúc đó cắt kết nối là câu trả lời đúng.
//
// Đánh đổi đã ghi nhận: giữa trần và `drainCap`, băng thông vẫn bị tiêu. Chỗ
// chặn thật cho việc đó là `uploadLimit` (6 lượt/phút mỗi người), không phải ở
// đây — một request đơn lẻ thì không có cách nào biết trước nó dài bao nhiêu
// khi client dùng `Transfer-Encoding: chunked` (và trình duyệt gửi FormData
// đúng như vậy, nên câu kiểm `Content-Length` ở dưới KHÔNG phải lưới chính).
async function readBody(req, maxBytes, { quaTruocKhiDoc = false } = {}) {
  const drainCap = maxBytes * 4;
  const chunks = [];
  let total = 0;
  let over = quaTruocKhiDoc;

  for await (const chunk of req) {
    total += chunk.length;
    if (!over && total > maxBytes) {
      over = true;
      chunks.length = 0;
    }
    if (over) {
      if (total > drainCap) {
        req.destroy();
        break;
      }
      continue;
    }
    chunks.push(chunk);
  }

  if (over) throw new AppError('FILE_TOO_LARGE', 'Tệp vượt quá dung lượng cho phép.', { status: 413 });
  return Buffer.concat(chunks, total);
}

function parseHeaders(raw) {
  const out = {};
  for (const line of raw.toString('utf8').split('\r\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

// Lấy giá trị của một tham số trong Content-Disposition. Chỉ nhận dạng có dấu
// nháy kép — dạng RFC 5987 (`filename*=UTF-8''…`) cố ý KHÔNG hỗ trợ vì tên tệp
// của client không được dùng vào việc gì ở đây (xem service: khoá lưu trữ do
// máy chủ sinh, phần mở rộng suy từ magic bytes).
function dispositionParam(value, name) {
  const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(value ?? '');
  return m ? m[1] : null;
}

function splitParts(body, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = body.indexOf(delim);
  if (pos === -1) throw new AppError('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.', { status: 400 });

  while (pos !== -1) {
    const after = pos + delim.length;
    // `--boundary--` là dấu chấm hết.
    if (body.slice(after, after + 2).equals(Buffer.from('--'))) break;

    const start = after + CRLF.length;
    const next = body.indexOf(delim, start);
    if (next === -1) throw new AppError('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.', { status: 400 });

    const raw = body.slice(start, next - CRLF.length); // bỏ CRLF đứng trước boundary sau
    const sep = raw.indexOf(CRLFCRLF);
    if (sep === -1) throw new AppError('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.', { status: 400 });

    parts.push({
      headers: parseHeaders(raw.slice(0, sep)),
      content: raw.slice(sep + CRLFCRLF.length),
    });
    pos = next;
  }
  return parts;
}

/**
 * Middleware. Đặt `req.file = { field, filename, client_mime, buffer }`.
 *
 * `client_mime` được giữ lại CÓ CHỦ ĐÍCH nhưng **không ai được tin nó** — nó
 * là lời khai của client. Tên trường nói thẳng điều đó để người đọc mã sau này
 * không nhầm nó với loại thật. Loại thật do `sniffImageType()` quyết định.
 */
export function singleFile({ field = 'file', maxBytes = 10 * 1024 * 1024 } = {}) {
  return async (req, _res, next) => {
    try {
      const boundary = boundaryOf(req.headers['content-type']);
      if (!boundary) {
        throw new AppError('VALIDATION_FAILED', 'Tải tệp phải gửi dạng multipart/form-data.', {
          status: 400,
          fields: { file: 'thiếu multipart/form-data hoặc thiếu boundary' },
        });
      }

      // Content-Length, KHI CÓ, cho biết trước là request này chắc chắn hỏng —
      // nên không giữ lại byte nào ngay từ chunk đầu. Nó KHÔNG được dùng để
      // trả lời sớm rồi thôi: bản đầu làm vậy và client nhận `ECONNRESET`, vì
      // phản hồi đi ra trong lúc người ta còn đang gửi 11 MB thì Node đóng
      // socket trước khi câu trả lời tới nơi. Nên nó chỉ là một gợi ý để bỏ
      // qua khâu gom bộ nhớ; việc đọc-rồi-vứt vẫn diễn ra như thường.
      //
      // Và nó KHÔNG phải lưới chính: trình duyệt gửi `FormData` bằng
      // `Transfer-Encoding: chunked`, không có `Content-Length` nào để đọc.
      const declared = Number(req.headers['content-length'] ?? 0);

      // +4096: phần bao bì multipart (boundary, header của phần) cũng nằm
      // trong thân, nên giới hạn thân phải rộng hơn giới hạn TỆP một chút,
      // nếu không một ảnh đúng 10 MB sẽ bị từ chối vì bao bì của chính nó.
      const body = await readBody(req, maxBytes + 4096, {
        quaTruocKhiDoc: declared > maxBytes + 4096,
      });
      const parts = splitParts(body, boundary);

      const files = parts.filter((p) => dispositionParam(p.headers['content-disposition'], 'filename') !== null);
      if (files.length === 0) {
        throw new AppError('FILE_MISSING', 'Chưa chọn tệp nào để tải lên.', { status: 400 });
      }
      // Hai phần tệp trong một request là một hình dạng không ai thiết kế ra.
      // Nhận phần đầu và bỏ qua phần sau là để một trong hai đi qua mà không ai
      // biết là cái nào — từ chối thẳng.
      if (files.length > 1) {
        throw new AppError('VALIDATION_FAILED', 'Mỗi lần chỉ tải lên được một tệp.', { status: 400 });
      }

      const part = files[0];
      const name = dispositionParam(part.headers['content-disposition'], 'name');
      if (name !== field) {
        throw new AppError('VALIDATION_FAILED', 'Dữ liệu gửi lên chưa hợp lệ.', {
          status: 400,
          fields: { [field]: `phần tệp phải mang tên "${field}"` },
        });
      }
      if (part.content.length > maxBytes) {
        throw new AppError('FILE_TOO_LARGE', 'Tệp vượt quá dung lượng cho phép.', { status: 413 });
      }
      if (part.content.length === 0) {
        throw new AppError('FILE_MISSING', 'Chưa chọn tệp nào để tải lên.', { status: 400 });
      }

      req.file = {
        field: name,
        filename: dispositionParam(part.headers['content-disposition'], 'filename'),
        client_mime: part.headers['content-type'] ?? null,
        buffer: part.content,
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}
