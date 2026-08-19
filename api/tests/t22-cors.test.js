import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

// ---------------------------------------------------------------------------
// T22 — CORS (đặc tả mục 5.1 dòng 736: "CORS chỉ cho binhdan1986.com").
//
// Tên tệp KHÔNG phải `t19-cors` như kế hoạch viết: `t19-error-handler.test.js`
// đã tồn tại từ Task 3. Hai tệp cùng số là chuyện nhỏ cho tới ngày ai đó nhắc
// "bài t19" và không ai biết là bài nào.
//
// Trước Task 11, api/src/app.js KHÔNG có một dòng CORS nào — không phải cấu
// hình sai mà là không có. Chưa lộ ra vì mọi thứ đi qua Caddy cùng gốc và mọi
// bài test đều gọi supertest cùng tiến trình. Lớp vỏ lại hở đúng chỗ không ai
// thả lưới (Ruling T9-e).
// ---------------------------------------------------------------------------

const ALLOWED = config.CORS_ORIGIN;              // .env.test: http://localhost:5173
const FOREIGN = 'https://ke-gian.example.com';
// Gốc chỉ có tiền tố trùng. Nếu ai đó đổi phép so khớp sang `startsWith` cho
// "dễ chịu với subdomain" thì đúng gốc này lọt qua.
const PREFIX_ATTACK = ALLOWED + '.ke-gian.example.com';

let api;

beforeAll(() => {
  api = buildApp();
});

describe('T22 CORS — chỉ đúng domain, không bao giờ *', () => {
  it('CORS_ORIGIN của môi trường test là một gốc cụ thể, không phải *', () => {
    expect(ALLOWED).toBeTruthy();
    expect(ALLOWED).not.toBe('*');
  });

  it('preflight từ Origin ĐƯỢC PHÉP: 204, vọng lại đúng gốc đó, khai method và header', async () => {
    const res = await supertest(api)
      .options('/api/v1/auth/login')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(res.headers['access-control-allow-headers']).toContain('authorization');
    expect(res.headers['access-control-allow-headers']).toContain('content-type');
  });

  it('preflight từ Origin LẠ: 403, và KHÔNG phát access-control-allow-origin', async () => {
    const res = await supertest(api)
      .options('/api/v1/auth/login')
      .set('Origin', FOREIGN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('gốc chỉ TRÙNG TIỀN TỐ vẫn bị từ chối (so khớp đúng chuỗi, không startsWith)', async () => {
    const res = await supertest(api)
      .options('/api/v1/auth/login')
      .set('Origin', PREFIX_ATTACK)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('yêu cầu thật từ Origin ĐƯỢC PHÉP: có access-control-allow-origin đúng gốc', async () => {
    const res = await supertest(api).get('/api/v1/health').set('Origin', ALLOWED);

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('yêu cầu thật từ Origin LẠ: KHÔNG có access-control-allow-origin ⇒ trình duyệt vứt phản hồi', async () => {
    // Yêu cầu "đơn giản" không có preflight nên nó VẪN tới được máy chủ; thứ
    // phải giữ là trang lạ không ĐỌC được phản hồi. Vắng header này chính là
    // cách trình duyệt cưỡng chế điều đó. Khẳng định sự VẮNG MẶT, vì đó mới là
    // cơ chế thật — không phải mã trạng thái.
    const res = await supertest(api).get('/api/v1/health').set('Origin', FOREIGN);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('không lời gọi nào nhận được ký tự đại diện *', async () => {
    for (const origin of [ALLOWED, FOREIGN, PREFIX_ATTACK]) {
      const res = await supertest(api).get('/api/v1/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    }
  });

  it('luôn có Vary: Origin — nếu không, proxy đệm phản hồi của gốc hợp lệ rồi phát lại cho gốc lạ', async () => {
    const withOrigin = await supertest(api).get('/api/v1/health').set('Origin', ALLOWED);
    const withoutOrigin = await supertest(api).get('/api/v1/health');

    expect(withOrigin.headers.vary).toContain('Origin');
    expect(withoutOrigin.headers.vary).toContain('Origin');
  });

  it('không có Origin (curl, máy chủ gọi máy chủ) vẫn đi qua bình thường', async () => {
    const res = await supertest(api).get('/api/v1/health');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect([200, 503]).toContain(res.status);
  });
});
