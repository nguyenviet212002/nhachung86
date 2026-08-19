import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { pinoHttpOptions } from '../src/middleware/httpLogger.js';

// Hồi quy cho phát hiện soát xét (Important, vòng sửa 2): default error
// serializer của pino-http copy MỌI thuộc tính enumerable của lỗi gốc —
// trong đó `.detail` là chỗ PostgreSQL in giá trị cột thật khi vi phạm ràng
// buộc (vd. "Key (phone)=(0912345678) already exists."). Vòng sửa 1 lần đầu
// làm nhánh `errorHandler.js` gọi `req.log.error({ err })` sống thật (trước
// đó là no-op vì thiếu middleware) — nên nếu serializer không lọc, đây chính
// là đường rò số điện thoại/CCCD/địa chỉ ra log máy chủ.
//
// Bài test này KHÔNG mock hàm log rồi kiểm tham số truyền vào — vậy chỉ kiểm
// cái ta đưa vào, không phải cái thực sự được ghi ra. Thay vào đó, dựng một
// pino instance THẬT với đúng `serializers` đang cấu hình cho production
// (import từ middleware/httpLogger.js, không viết lại), ghi vào một stream
// trong bộ nhớ, cho lỗi đi qua đúng errorHandler thật, rồi soi NỘI DUNG ĐàGHI
// (chuỗi JSON cuối cùng) — kể cả sau khi tự JSON.stringify lại toàn bộ output
// để bắt trường hợp giá trị bị lồng ở đâu đó không ngờ tới.

function memoryStream() {
  let buf = '';
  return {
    write(chunk) {
      buf += chunk;
      return true;
    },
    get content() {
      return buf;
    },
  };
}

function fakeRes() {
  return {
    statusCode: undefined,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('T20 log máy chủ không được làm lộ dữ liệu cá nhân qua err.detail của PostgreSQL', () => {
  it('số điện thoại trong err.detail không xuất hiện ở bất kỳ đâu trong log đã ghi, nhưng code/message thì có', () => {
    const stream = memoryStream();
    // Ép level 'error' bất kể LOG_LEVEL của môi trường test (.env.test đặt
    // 'silent') — bài này kiểm NỘI DUNG serializer lọc ra, không phải việc
    // level lọc log; t19 đã phủ "có lời gọi log thật sự xảy ra" ở mức level
    // thật của môi trường. Vẫn dùng đúng `serializers` thật từ httpLogger.js.
    const logger = pino({ ...pinoHttpOptions, level: 'error' }, stream);

    // Mô phỏng lỗi PostgreSQL thật khi vi phạm CHECK/UNIQUE constraint trên
    // cột số điện thoại: node-postgres gắn .detail/.hint/.where/.table/...
    // là thuộc tính enumerable thường trực trên đối tượng Error.
    // Cố ý dùng một mã lỗi PostgreSQL KHÔNG nằm trong tập mapPgError() đã biết
    // (không phải 23505/23503/42501, message không khớp BY_MESSAGE) — đây
    // chính xác là nhánh "!mapped" mà soát xét chỉ ra (errorHandler.js, gọi
    // req.log.error({ err }, 'lỗi không lường trước') với lỗi GỐC nguyên vẹn).
    // (23505 bị mapPgError() bắt riêng thành AppError('DUPLICATE', ...) không
    // mang theo .detail — không đi qua đường rò này, nên không dùng ở đây.)
    const err = new Error('new row for relation "member_contacts" violates check constraint "phone_format_chk"');
    err.code = '23514'; // check_violation — không nằm trong danh sách mapPgError() xử lý riêng
    err.detail = 'Failing row contains (a1b2c3, 0912345678, ...).';
    err.hint = 'Kiểm tra định dạng số điện thoại.';
    err.where = 'SQL statement "INSERT INTO member_contacts (id, phone) VALUES ($1, $2)"';
    err.table = 'member_contacts';
    err.column = 'phone';
    err.constraint = 'phone_format_chk';
    err.severity = 'ERROR';
    err.routine = 'ExecConstraints';

    const req = { log: logger };
    const res = fakeRes();

    errorHandler(err, req, res, () => {});

    // Client vẫn phải nhận lỗi an toàn (không lộ .detail ra response).
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL');

    const logged = stream.content;
    expect(logged.length).toBeGreaterThan(0); // phải thật sự có ghi log — không phải bài test rỗng

    // Chuỗi thô của dòng log, VÀ dán lại qua JSON.stringify một lần nữa để
    // bắt cả trường hợp giá trị bị lồng sâu ở một khóa không ngờ tới.
    const reserialized = JSON.stringify(JSON.parse(logged));

    expect(logged).not.toContain('0912345678');
    expect(reserialized).not.toContain('0912345678');
    // Toàn bộ .detail/.hint/.where không được xuất hiện — không chỉ riêng
    // số điện thoại. .detail thực tế còn chứa các giá trị cột khác (id).
    expect(logged).not.toContain('Failing row contains');
    expect(logged).not.toContain(err.hint);
    expect(logged).not.toContain('INSERT INTO member_contacts');

    // code và message PHẢI có mặt — chứng minh ta không "sửa" bằng cách vứt
    // hết đi, log vẫn đủ để chẩn đoán sự cố. constraint/table/column cũng giữ
    // lại vì đó là TÊN lược đồ, không phải giá trị dữ liệu.
    expect(logged).toContain('23514');
    expect(logged).toContain('violates check constraint');
    expect(logged).toContain('phone_format_chk');
  });
});
