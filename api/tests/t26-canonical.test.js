import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { canonical } from '../src/core/twoPerson.js';

// ---------------------------------------------------------------------------
// T26 — `canonical()` phải nổ chứ không được im lặng
//
// Vì sao có tệp này: lượt 14 phát hiện `canonical()` nén mọi `Date` thành `{}`
// (`typeof new Date() === 'object'` mà `Object.keys(date)` RỖNG), làm cả cơ chế
// chống "dữ liệu đổi giữa hai chữ ký" (đặc tả mục 7.3) rỗng ruột — hai lần băm
// luôn bằng nhau nên không thay đổi nào bị phát hiện.
//
// Nhưng lỗi THẬT không phải quên nhánh `Date`. Lỗi thật là hàm gặp thứ nó
// không hiểu thì **im lặng trả về `{}`**. Vá riêng `Date` là chữa triệu chứng.
//
// Và lý do nó suýt lọt: bài kiểm duy nhất chạm nhánh đó dùng `config` — một
// object thuần do người viết test tự dựng — nên **không bao giờ đi qua chỗ
// hỏng**. Test dựng bằng tay chỉ kiểm được những kiểu người viết test nghĩ ra.
//
// Nên tệp này có hai nửa:
//   1. danh sách trắng: mọi kiểu ngoài danh sách phải NÉM, không được thành `{}`;
//   2. hàng THẬT từ CSDL: duyệt các bảng mà `pending_actions` đụng tới, lấy hàng
//      thật, đưa qua `canonical()`. Nửa này bắt được cả họ hàng chưa ai nghĩ ra.
// ---------------------------------------------------------------------------

let db;
beforeAll(async () => {
  db = await resetDb();
});
afterAll(async () => {
  await db.destroy();
});

describe('T26.1 danh sách trắng — gặp thứ lạ thì NÉM, không im lặng', () => {
  it('nén Date thành chuỗi ISO, không thành {}', () => {
    const d = new Date('2026-08-20T10:11:12.131Z');
    expect(canonical(d)).toBe('2026-08-20T10:11:12.131Z');
    expect(canonical({ at: d })).toEqual({ at: '2026-08-20T10:11:12.131Z' });
  });

  it('hai mốc thời gian khác nhau cho hai kết quả khác nhau — đây là điều bản cũ làm hỏng', () => {
    const a = canonical({ updated_at: new Date('2026-08-20T10:00:00Z') });
    const b = canonical({ updated_at: new Date('2026-08-20T10:00:01Z') });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  // Bốn kiểu này đều cho `Object.keys()` rỗng hoặc hình dạng không ổn định.
  // Bản cũ biến tất cả thành `{}` — tức bốn giá trị khác nhau, một băm.
  it.each([
    ['Buffer', Buffer.from('0912345678')],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1, 2])],
    ['RegExp', /abc/],
  ])('từ chối %s thay vì nén thành {}', (_ten, gt) => {
    expect(() => canonical(gt)).toThrow(/chưa có luật chuẩn hoá/);
  });

  it('từ chối BigInt, NaN, Infinity — JSON.stringify sẽ nuốt hoặc bóp méo chúng', () => {
    expect(() => canonical(10n)).toThrow(/kiểu bigint/);
    expect(() => canonical(NaN)).toThrow(/không băm được/);
    expect(() => canonical(Infinity)).toThrow(/không băm được/);
  });

  it('từ chối undefined — nó bị JSON.stringify bỏ đi còn null thì không', () => {
    // Nếu cho qua: { a: 1, b: undefined } và { a: 1 } ra CÙNG một băm, tức hai
    // nội dung khác nhau được ký như một.
    expect(() => canonical({ a: 1, b: undefined })).toThrow(/undefined/);
    expect(canonical({ a: 1, b: null })).toEqual({ a: 1, b: null });
  });

  it('-0 và 0 cho cùng một kết quả — chuẩn hoá, không phải hai đường vào một băm', () => {
    expect(Object.is(canonical(-0), 0)).toBe(true);
  });

  it('thông điệp lỗi chỉ đúng đường dẫn tới trường vi phạm', () => {
    expect(() => canonical({ ho_so: { anh: Buffer.from('x') } })).toThrow(/\$\.ho_so\.anh/);
    expect(() => canonical({ ds: [1, new Map()] })).toThrow(/\$\.ds\[1\]/);
  });

  it('sắp khoá ổn định — cùng nội dung, khác thứ tự gõ, cùng một băm', () => {
    const x = canonical({ zzz: 1, a: 2, mm: { b: 3, aaaa: 4 } });
    const y = canonical({ a: 2, mm: { aaaa: 4, b: 3 }, zzz: 1 });
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
  });
});

describe('T26.2 hàng THẬT từ CSDL — bắt cả họ hàng chưa ai nghĩ ra', () => {
  // Các bảng mà ảnh chụp của `pending_actions` đụng tới, cộng những bảng có
  // kiểu cột dễ sinh đối tượng lạ (jsonb, timestamptz, numeric, uuid[]).
  const BANG = ['members', 'communities', 'join_requests', 'pending_actions', 'audit_log', 'fund_entries'];

  it('không hàng thật nào bị rút gọn thành {} và không hàng nào ném lỗi kiểu', async () => {
    // Gieo tối thiểu để mỗi bảng có ít nhất một hàng đáng soi.
    const { rows: [c] } = await db.raw(
      `INSERT INTO communities (code,name,config) VALUES ('community-t26','X','{"a":1}'::jsonb) RETURNING id`);
    await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?,'Nguoi T26','member')`, [c.id]);

    const hong = [];
    for (const bang of BANG) {
      const { rows } = await db.raw(`SELECT * FROM ?? LIMIT 1`, [bang]);
      if (!rows.length) continue;
      const hang = rows[0];
      try {
        const ra = canonical(hang);
        // Đây là khẳng định trung tâm: hàng thật có cột thì kết quả phải có
        // khoá. Bản cũ trả `{}` cho `Date` — nếu tái diễn ở bất kỳ kiểu nào,
        // dòng này đỏ mà không cần ai đoán trước kiểu đó là gì.
        if (Object.keys(hang).length > 0 && Object.keys(ra).length === 0) {
          hong.push(`${bang}: hàng có ${Object.keys(hang).length} cột nhưng canonical() trả về {}`);
        }
        for (const [cot, gt] of Object.entries(hang)) {
          if (gt !== null && typeof gt === 'object' && !Array.isArray(gt)) {
            const rc = ra[cot];
            const rong = rc !== null && typeof rc === 'object' && Object.keys(rc).length === 0;
            const nguon = Object.keys(gt).length > 0 || gt instanceof Date;
            if (rong && nguon) hong.push(`${bang}.${cot}: ${gt.constructor?.name} bị nén thành {}`);
          }
        }
      } catch (e) {
        hong.push(`${bang}: canonical() ném — ${e.message}`);
      }
    }
    expect(hong, 'canonical() không xử lý được kiểu mà driver pg thật sự trả về').toEqual([]);
  });

  it('timestamptz đọc từ CSDL đi qua canonical() vẫn phân biệt được hai thời điểm', async () => {
    const { rows: [c] } = await db.raw(
      `INSERT INTO communities (code,name) VALUES ('community-t26b','Y') RETURNING id`);
    const { rows: [m1] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?,'Mot','member') RETURNING updated_at`, [c.id]);
    await db.raw(`SELECT pg_sleep(0.01)`);
    const { rows: [m2] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?,'Hai','member') RETURNING updated_at`, [c.id]);

    // Đây chính là đại lượng mà cơ chế mục 7.3 dựa vào. Bản cũ cho hai giá trị
    // này ra cùng `{}` — tức cơ chế đó đo một hằng số.
    expect(m1.updated_at).toBeInstanceOf(Date);
    expect(JSON.stringify(canonical(m1.updated_at))).not.toBe(JSON.stringify(canonical(m2.updated_at)));
  });
});
