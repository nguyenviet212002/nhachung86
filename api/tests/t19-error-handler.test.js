import { describe, it, expect, vi, afterEach } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';

// Hồi quy cho phát hiện soát xét (Important, vòng sửa 1): trước đây không
// middleware nào gắn `req.log` trong app.js, nên `req.log?.fatal(...)` trong
// errorHandler là no-op im lặng — kể cả khi app_role đụng 42501 (permission
// denied), đúng sự kiện mà toàn bộ kiến trúc này dựng ra để phát hiện. Bài
// test này khẳng định: (a) client vẫn nhận 500 chứ không phải 403, và (b) một
// lời gọi log THẬT SỰ xảy ra — cả khi req.log tồn tại (mô phỏng pino-http đã
// gắn đúng) lẫn khi nó vắng mặt (mô phỏng middleware bị gỡ nhầm — phải rơi về
// console.error, không được im lặng).

function makeRes() {
  const res = {
    statusCode: undefined,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function pgPermissionDeniedError() {
  const err = new Error('permission denied for table du_lieu_nhay_cam');
  err.code = '42501';
  return err;
}

describe('T19 errorHandler — 42501 không được biến mất im lặng', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('req.log gắn sẵn (mô phỏng pino-http đã wiring): trả 500 và gọi log.fatal thật', () => {
    const err = pgPermissionDeniedError();
    const req = { log: { fatal: vi.fn(), error: vi.fn() } };
    const res = makeRes();

    errorHandler(err, req, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.statusCode).not.toBe(403);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(req.log.fatal).toHaveBeenCalledTimes(1);
  });

  it('req.log KHÔNG tồn tại (middleware pino-http bị gỡ nhầm): vẫn trả 500 và rơi về console.error, không im lặng', () => {
    const err = pgPermissionDeniedError();
    const req = {};
    const res = makeRes();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    errorHandler(err, req, res, () => {});

    expect(res.statusCode).toBe(500);
    expect(res.statusCode).not.toBe(403);
    expect(res.body.error.code).toBe('INTERNAL');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
