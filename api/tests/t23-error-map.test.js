import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../src/core/errors.js';

// ---------------------------------------------------------------------------
// T23 — hai bảng thông điệp lỗi phải khớp nhau
//
// Máy chủ ném mã lỗi ở `api/src/core/errors.js`; trình duyệt dịch mã đó sang
// câu tiếng Việt ở `web/js/api.js`. Hai bảng nằm ở hai tầng khác nhau, hai
// người khác nhau sửa, và **không có gì bắt chúng đi cùng nhau** — cho tới bài
// test này.
//
// Vì sao nó đáng một tệp riêng: soát xét Task 12 phát hiện sáu mã lỗi mới do
// migration 025 ném ra không có mặt ở bảng nào cả. Chúng rơi qua `mapPgError()`
// → `return null` → `errorHandler` trả 500 "Lỗi hệ thống". Nghĩa là bốn trigger
// dựng ra để canh nguyên tắc 1 và 2 sẽ chặn đúng, nhưng người dùng không bao
// giờ biết mình vướng luật nào — họ chỉ thấy hệ thống hỏng, và sẽ bấm lại.
//
// Cách phát hiện lần đó là một người đọc mã và grep tay. Lần sau sẽ không có ai
// grep. Nên luật này phải nằm trong suite, không nằm trong trí nhớ.
//
// LẦN THỨ HAI, VÀ NÓ LÀ LỖI CỦA CHÍNH BÀI TEST NÀY. Soát xét Task 13 tìm thấy
// **19** mã mới do 11 migration ném ra, vẫn vắng mặt ở cả hai bảng — và bài test
// này **không bắt được**, dù nó ra đời đúng để bắt loại lỗi đó.
//
// Lý do: nó so bảng JS với bảng JS. Cả hai cùng thiếu thì nó vẫn xanh. Nó canh
// *triệu chứng* (hai bảng lệch nhau) chứ không canh *nguồn* (SQL ném ra mã nào).
// Một cái lưới căng giữa hai cái cột mà cá bơi phía trên cả hai.
//
// Nguồn sự thật là `RAISE EXCEPTION '<MÃ>'` trong `src/db/migrations/`. Bài test
// giờ đọc thẳng từ đó. Thêm trigger mới mà quên khai báo mã ⇒ đỏ ngay, không đợi
// ai grep.
// ---------------------------------------------------------------------------

const errorsSrc = readFileSync(fileURLToPath(new URL('../src/core/errors.js', import.meta.url)), 'utf8');
const apiJsSrc = readFileSync(fileURLToPath(new URL('../../web/js/api.js', import.meta.url)), 'utf8');

// Mã mà máy chủ THẬT SỰ gửi ra dây là phần tử thứ hai của mỗi dòng BY_MESSAGE —
// KHÔNG phải khoá. Khoá là tên ngoại lệ PostgreSQL (thứ `mapPgError` đi tìm
// trong chuỗi lỗi thô); mã gửi ra client có thể khác hẳn, ví dụ
// Ví dụ: `NO_ACTOR` → `INTERNAL`, lỗi constraint đơn chưa duyệt → `JOIN_APPROVAL_REQUIRED`.
// So nhầm hai thứ này sẽ cho ra một bài test xanh mà canh sai đối tượng.
function serverCodes() {
  const block = errorsSrc.slice(errorsSrc.indexOf('const BY_MESSAGE'), errorsSrc.indexOf('export function mapPgError'));
  const codes = new Set();
  for (const m of block.matchAll(/\[\s*\d{3}\s*,\s*'([A-Z0-9_]+)'/g)) codes.add(m[1]);
  return codes;
}

function clientCodes() {
  const start = apiJsSrc.indexOf('MESSAGES');
  const block = apiJsSrc.slice(start, apiJsSrc.indexOf('};', start));
  const codes = new Set();
  for (const m of block.matchAll(/^\s*([A-Z0-9_]+)\s*:/gm)) codes.add(m[1]);
  return codes;
}

// Khoá của BY_MESSAGE là tên ngoại lệ PostgreSQL — thứ `mapPgError` đi tìm bằng
// `raw.includes(key)` trong chuỗi lỗi thô.
function messageKeys() {
  const block = errorsSrc.slice(errorsSrc.indexOf('const BY_MESSAGE'), errorsSrc.indexOf('export function mapPgError'));
  const keys = new Set();
  for (const m of block.matchAll(/^\s{2}([A-Z0-9_]+)\s*:\s*\[/gm)) keys.add(m[1]);
  return keys;
}

// Mọi mã mà tầng CSDL thật sự ném ra. Đây là NGUỒN, không phải bản sao của nguồn.
function raisedInMigrations() {
  const dir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
  const codes = new Map(); // mã -> tệp đầu tiên ném nó
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/RAISE\s+EXCEPTION\s+'([A-Z0-9_]+)'/g)) {
      if (!codes.has(m[1])) codes.set(m[1], f);
    }
  }
  return codes;
}

describe('T23 mọi mã lỗi CSDL ném ra đều phải dịch được', () => {
  it('mọi RAISE EXCEPTION trong migration đều có mặt trong BY_MESSAGE', () => {
    const raised = raisedInMigrations();
    const keys = messageKeys();
    expect(raised.size, 'không đọc được migration nào — bài test hỏng chứ không phải mã hỏng').toBeGreaterThan(20);

    const thieu = [...raised.entries()].filter(([code]) => !keys.has(code));
    expect(
      thieu.map(([code, file]) => `${code} (${file})`),
      'Những mã này CSDL ném ra được nhưng mapPgError() không biết, nên rơi qua ' +
        '`return null` và người dùng nhận HTTP 500 "Lỗi hệ thống" thay vì lý do thật. ' +
        'Trigger vẫn chặn đúng — chỉ là không ai hiểu vì sao bị chặn'
    ).toEqual([]);
  });

  it('không khoá nào là chuỗi con của khoá khác', () => {
    // `mapPgError` so bằng `raw.includes(key)` và trả về ngay khớp ĐẦU TIÊN theo
    // thứ tự khai báo. Nếu `NO_LOAN` đứng trước `NO_LOAN_GUARANTOR` thì ngoại lệ
    // thứ hai bị dịch thành thông điệp của cái thứ nhất — sai thầm lặng, không
    // ai thấy, vì vẫn có một câu tiếng Việt hiện ra.
    const keys = [...messageKeys()];
    const va_cham = [];
    for (const a of keys) for (const b of keys) if (a !== b && b.includes(a)) va_cham.push(`"${a}" nằm trong "${b}"`);
    expect(va_cham, 'khoá chồng nhau làm mapPgError dịch sai mà không báo lỗi').toEqual([]);
  });
});

describe('T23 bảng ánh xạ lỗi máy chủ và trình duyệt phải khớp', () => {
  it('mọi mã máy chủ có thể gửi ra đều có câu tiếng Việt ở web/js/api.js', () => {
    const server = serverCodes();
    const client = clientCodes();
    expect(server.size, 'không đọc được BY_MESSAGE — bài test này hỏng chứ không phải mã hỏng').toBeGreaterThan(10);

    const thieu = [...server].filter((c) => !client.has(c)).sort();
    expect(
      thieu,
      `Những mã này máy chủ gửi ra được nhưng trình duyệt không có câu để hiện, ` +
        `nên người dùng sẽ thấy câu chung chung đúng lúc cần biết lý do thật: ${thieu.join(', ')}`
    ).toEqual([]);
  });

  it('không có câu thừa ở trình duyệt cho mã máy chủ không bao giờ gửi', () => {
    const server = serverCodes();
    const client = clientCodes();

    // Ba nhóm hợp lệ không đến từ BY_MESSAGE, khai tường minh để danh sách trắng
    // này không âm thầm phình ra: (a) AppError ném thẳng trong service/middleware,
    // (b) mã chỉ có ở phía client, (c) mã của tầng HTTP.
    const ngoaiBangPg = new Set([
      'NETWORK',
      'RATE_LIMITED',
      'VALIDATION_FAILED',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'DUPLICATE',
      'INVALID_REFERENCE',
      'INTERNAL',
      'CORS_ORIGIN_NOT_ALLOWED',
    ]);

    const thua = [...client].filter((c) => !server.has(c) && !ngoaiBangPg.has(c));

    // Không khẳng định `thua` rỗng: mã ném thẳng bằng `new AppError(...)` trong
    // service là hợp lệ và nhiều. Chỉ khẳng định chúng CÓ THẬT ở đâu đó trong
    // `api/src` — một câu dịch cho mã không nơi nào ném ra là dấu vết của một
    // luồng đã bị xoá mà không ai dọn theo, và nó làm bảng này phình dần thành
    // thứ không ai dám động vào.
    const src = readAllSource();
    const khongAiNem = thua.filter((code) => !src.includes(`'${code}'`));
    expect(
      khongAiNem,
      `web/js/api.js dịch những mã mà không nơi nào trong api/src ném ra: ${khongAiNem.join(', ')}`
    ).toEqual([]);
  });
});

// Đọc toàn bộ mã nguồn máy chủ thành một chuỗi. Đọc tệp chứ không `import` —
// nạp module sẽ kéo theo tác dụng phụ (mở kết nối CSDL, đọc cấu hình), và bài
// test này chỉ cần văn bản.
function readAllSource() {
  const base = fileURLToPath(new URL('../src', import.meta.url));
  const out = [];
  const stack = [base];
  while (stack.length) {
    const p = stack.pop();
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) {
      for (const f of readdirSync(p)) stack.push(join(p, f));
    } else if (p.endsWith('.js')) {
      out.push(readFileSync(p, 'utf8'));
    }
  }
  return out.join('\n');
}

describe('T23 AppError giữ nguyên mã được truyền vào', () => {
  it('không âm thầm đổi mã thành INTERNAL', () => {
    const e = new AppError('REVIEWER_IS_PARTICIPANT', 'x', { status: 403 });
    expect(e.code).toBe('REVIEWER_IS_PARTICIPANT');
    expect(e.status).toBe(403);
  });
});
