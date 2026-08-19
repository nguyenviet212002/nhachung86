import pinoHttp from 'pino-http';
import { config } from '../config/index.js';

// Phát hiện soát xét (Important, vòng sửa 2): pino-http mặc định dùng
// pino-std-serializers cho khóa `err`, và serializer đó copy MỌI thuộc tính
// enumerable của lỗi gốc (`for (const key in err)`) rồi còn gắn `.raw = err`
// giữ nguyên bản gốc thêm lần nữa. Lỗi PostgreSQL (qua node-postgres) gắn các
// thuộc tính `.detail`, `.hint`, `.where`, `.query`, `.internalQuery` — và
// `.detail` chính là chỗ Postgres in giá trị cột thật khi vi phạm ràng buộc
// (vd. `Key (phone)=(0912345678) already exists.`). Nếu không chặn, số điện
// thoại/CCCD/địa chỉ của thành viên sẽ lọt vào log máy chủ qua đường lỗi
// không lường trước (errorHandler.js nhánh `!mapped` → logError → req.log.error({ err })).
//
// Cách sửa: DANH SÁCH CHO PHÉP, không phải danh sách cấm. `redact` theo từng
// trường là chạy theo sau, vì Postgres/driver có thể gắn thêm thuộc tính khác
// mà ta chưa nghĩ tới. Serializer dưới đây dựng một object HOÀN TOÀN MỚI, chỉ
// copy đúng các trường không thể chứa giá trị dữ liệu người dùng:
//   - name/type, message, stack: mô tả lỗi, không phải dữ liệu.
//   - code, severity, routine: mã lỗi/mức độ/hàm nội bộ PostgreSQL, cố định.
//   - constraint, table, column: TÊN lược đồ (vd. "member_contacts_phone_key"),
//     không phải giá trị cột.
// KHÔNG bao giờ thêm `detail`, `hint`, `where`, `query`, `internalQuery`,
// `raw`, hay bất kỳ trường nào khác vào danh sách này dù có tiện cho việc gỡ
// lỗi đến đâu — đó chính xác là những chỗ Postgres in ra giá trị cột thật.
const ALLOWED_ERR_FIELDS = ['message', 'code', 'constraint', 'table', 'column', 'severity', 'routine', 'stack'];

export function errSerializer(err) {
  if (!err || typeof err !== 'object') return err;
  const out = {};
  // pino-http bọc serializer này quanh pino-std-serializers.err, nên `err`
  // nhận vào đây đã là bản đã serialize sẵn (dùng `.type` thay vì `.name`).
  const name = err.name ?? err.type;
  if (name !== undefined) out.name = name;
  for (const key of ALLOWED_ERR_FIELDS) {
    if (err[key] !== undefined) out[key] = err[key];
  }
  return out;
}

export const pinoHttpOptions = {
  level: config.LOG_LEVEL,
  redact: {
    // Vẫn giữ redact cho req/res: che thông tin nhạy cảm trong chính request
    // (không phải trong error) — hai cơ chế bổ sung nhau, không thay thế nhau.
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.headers["set-cookie"]'],
    remove: true,
  },
  serializers: { err: errSerializer },
};

export function httpLogger() {
  return pinoHttp(pinoHttpOptions);
}
