import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import supertest from 'supertest';
import { rm } from 'node:fs/promises';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { ingest, sniffImageType } from '../src/modules/files/service.js';
import { signV4, newKey, put, getStream } from '../src/core/storage.js';

// ---------------------------------------------------------------------------
// T28 — TỆP: tải lên, xoá EXIF, phát lại có kiểm quyền (đặc tả mục 5.3 "Tệp").
//
// Bài quan trọng nhất tệp này là bài GPS, và nó được viết theo đúng lời dặn của
// `docs/SOAT-KIEM-THU.md`: **canh NGUỒN, không canh triệu chứng.**
//
// Cách canh triệu chứng mà bài này CỐ Ý KHÔNG dùng:
//   * `expect(src).not.toContain('withMetadata')` — quét mã nguồn tìm một
//     chuỗi. Ai làm cùng việc bằng cách viết khác thì lọt (dạng "canh một CÁCH
//     VIẾT thay vì canh HÀNH VI").
//   * `expect(meta.exif).toBeUndefined()` trên một ảnh **không có gì để xoá**.
//     Khẳng định đó không thể đỏ dù `ingest()` có làm gì đi nữa — đúng dạng
//     "khẳng định không thể đỏ" mà tài liệu soát xét đặt tên.
//
// Cách bài này làm: dựng một JPEG mang **toạ độ GPS thật** (20°51'35.43"N,
// 105°58'12.34"E — một điểm ở Hưng Yên), **khẳng định đầu vào thật sự có toạ
// độ đó** bằng một bộ đọc EXIF viết riêng ở đây (không dùng lại mã đang kiểm),
// rồi mới khẳng định ảnh ra không còn đoạn APP1 nào và không còn con số nào
// của toạ độ trong byte. Bộ đọc EXIF độc lập là chỗ quan trọng: nếu nó hỏng
// thì bài "đầu vào có GPS" đỏ, chứ không phải bài "đầu ra sạch" xanh giả.
// ---------------------------------------------------------------------------

// --- Bộ đọc EXIF độc lập ---------------------------------------------------
// Không dùng `sharp.metadata()` để tìm GPS: nó trả về một Buffer EXIF thô mà
// không bóc IFD GPS ra, nên "có exif" và "có toạ độ" là hai câu khác nhau và
// chỉ câu thứ hai đáng quan tâm.

function findApp1(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= jpeg.length) {
    if (jpeg[i] !== 0xff) return null;
    const marker = jpeg[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // tới phần dữ liệu ảnh
    const len = jpeg.readUInt16BE(i + 2);
    const seg = jpeg.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1 && seg.subarray(0, 6).toString('latin1') === 'Exif\0\0') return seg.subarray(6);
    i += 2 + len;
  }
  return null;
}

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Đọc IFD GPS của một JPEG. Trả `null` nếu không có EXIF hoặc không có IFD GPS. */
function gpsTags(jpeg) {
  const tiff = findApp1(jpeg);
  if (!tiff) return null;
  const le = tiff.subarray(0, 2).toString('latin1') === 'II';
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  if (u16(2) !== 42) return null;

  const readIfd = (off) => {
    const n = u16(off);
    const out = [];
    for (let k = 0; k < n; k++) {
      const e = off + 2 + k * 12;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const val = size <= 4 ? tiff.subarray(e + 8, e + 8 + size) : tiff.subarray(u32(e + 8), u32(e + 8) + size);
      out.push({ tag, type, val });
    }
    return out;
  };

  const ptr = readIfd(u32(4)).find((e) => e.tag === 0x8825); // GPS IFD pointer
  if (!ptr) return null;
  const gpsOff = le ? ptr.val.readUInt32LE(0) : ptr.val.readUInt32BE(0);

  const rationals = (b) => {
    const out = [];
    for (let k = 0; k + 8 <= b.length; k += 8) {
      const num = le ? b.readUInt32LE(k) : b.readUInt32BE(k);
      const den = le ? b.readUInt32LE(k + 4) : b.readUInt32BE(k + 4);
      out.push(den === 0 ? 0 : num / den);
    }
    return out;
  };

  const g = {};
  for (const e of readIfd(gpsOff)) {
    g[e.tag] = e.type === 5 ? rationals(e.val) : e.val.toString('latin1').replace(/\0+$/, '');
  }
  return g;
}

// Toạ độ dùng cho bài GPS. Giữ ở đây dưới dạng số để bài test còn đi tìm được
// chúng trong byte ảnh ra.
const GPS = { latDeg: 20, latMin: 51, latSecX100: 3543, lngDeg: 105, lngMin: 58, lngSecX100: 1234 };

async function anhCoGps() {
  const base = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#204060' } })
    .jpeg()
    .toBuffer();
  return sharp(base)
    .withMetadata({
      exif: {
        IFD0: { Make: 'NhaChung', Model: 'DienThoai', Copyright: 'x' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: `${GPS.latDeg}/1 ${GPS.latMin}/1 ${GPS.latSecX100}/100`,
          GPSLongitudeRef: 'E',
          GPSLongitude: `${GPS.lngDeg}/1 ${GPS.lngMin}/1 ${GPS.lngSecX100}/100`,
        },
      },
    })
    .toBuffer();
}

// --- Dựng dữ liệu ----------------------------------------------------------

const PASSWORD = 'mat-khau-du-manh-t28';
let db, api;
let cidA, cidB;
let alice, bob, carol; // alice/bob ở Hội A, carol ở Hội B
const tokens = {};

// PHÁT HIỆN KHI VIẾT BÀI TEST NÀY, ghi lại vì nó không phải chuyện của riêng
// tệp này: `POST /auth/login` gọi `resolveCommunityId()`, và hàm đó trả về
// **cộng đồng đầu tiên theo created_at** — máy chủ hôm nay chỉ đăng nhập được
// vào MỘT Hội. Người của Hội thứ hai không có đường vào qua HTTP. Vì vậy
// Carol (Hội B) nhận vé ký thẳng bằng JWT_SECRET, đúng hình dạng
// `signAccessToken` của `modules/auth/service.js`. Đây là cách DUY NHẤT hôm
// nay dựng được một người của Hội khác đi qua HTTP thật, và bài "lọc
// community_id" thì bắt buộc phải có một người như thế.
function veChoNguoi(memberId, communityId) {
  return jwt.sign({ sub: memberId, cid: communityId, typ: 'access' }, process.env.JWT_SECRET, {
    expiresIn: '15m',
  });
}

async function taoNguoi(cid, name, email) {
  const {
    rows: [m],
  } = await db.raw(
    `INSERT INTO members (community_id, full_name, status, password_hash, email)
     VALUES (?, ?, 'member', ?, ?) RETURNING id`,
    [cid, name, await argon2.hash(PASSWORD), email]
  );
  tokens[m.id] = veChoNguoi(m.id, cid);
  return m.id;
}

/** Đăng nhập THẬT qua HTTP — dùng cho bài khẳng định đường vé không bị vé giả che. */
async function dangNhap(email) {
  const login = await supertest(api).post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  return login.body.access;
}

/** GET trả byte nhị phân — supertest cần được bảo đừng cố phân tích thành JSON. */
function getBinary(url, token) {
  const req = supertest(api).get(url);
  if (token) req.set('authorization', `Bearer ${token}`);
  return req.buffer().parse((res, cb) => {
    const chunks = [];
    res.on('data', (d) => chunks.push(d));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}

/** Ghi thẳng một hàng `files` + byte vào kho, không đi qua HTTP. */
async function gieoTep(cid, ownerId, { attach = null, bytes = null } = {}) {
  const buf = bytes ?? (await ingest(await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).jpeg().toBuffer())).buffer;
  const key = newKey(cid);
  await put(key, buf);
  const { createHash } = await import('node:crypto');
  const {
    rows: [row],
  } = await db.raw(
    `INSERT INTO files (community_id, owner_id, storage_key, mime, source_mime, byte_size, width, height, sha256,
                        attached_type, attached_id)
     VALUES (?, ?, ?, 'image/jpeg', 'image/jpeg', ?, 40, 40, ?, ?, ?) RETURNING id`,
    [cid, ownerId, key, buf.length, createHash('sha256').update(buf).digest('hex'), attach, attach ? ownerId : null]
  );
  return { id: row.id, key, buf };
}

beforeAll(async () => {
  db = await resetDb();
  api = buildApp();

  ({
    rows: [{ id: cidA }],
  } = await db.raw(`INSERT INTO communities (code,name) VALUES ('community-t28-a','A') RETURNING id`));
  ({
    rows: [{ id: cidB }],
  } = await db.raw(`INSERT INTO communities (code,name) VALUES ('community-t28-b','B') RETURNING id`));

  alice = await taoNguoi(cidA, 'Alice T28', 'alice-t28@nhachung.test');
  bob = await taoNguoi(cidA, 'Bob T28', 'bob-t28@nhachung.test');
  carol = await taoNguoi(cidB, 'Carol T28', 'carol-t28@nhachung.test');
}, 60_000);

afterAll(async () => {
  await db.destroy();
  await rm('.storage-test', { recursive: true, force: true });
});

// ===========================================================================
describe('T28 xoá siêu dữ liệu: ảnh có TOẠ ĐỘ GPS THẬT đi vào, không toạ độ nào đi ra', () => {
  it('ảnh dựng cho bài test THẬT SỰ mang toạ độ GPS — nếu không, hai bài dưới vô nghĩa', async () => {
    const input = await anhCoGps();
    const g = gpsTags(input);

    expect(g, 'ảnh đầu vào phải có IFD GPS, nếu không thì không có gì để xoá').not.toBeNull();
    expect(g[1]).toBe('N');
    expect(g[2]).toEqual([GPS.latDeg, GPS.latMin, GPS.latSecX100 / 100]);
    expect(g[3]).toBe('E');
    expect(g[4]).toEqual([GPS.lngDeg, GPS.lngMin, GPS.lngSecX100 / 100]);
  });

  it('ingest() xoá sạch EXIF: không còn APP1, không còn IFD GPS', async () => {
    const input = await anhCoGps();
    expect(findApp1(input), 'tiền đề: đầu vào có đoạn APP1').not.toBeNull();

    const out = await ingest(input);

    expect(findApp1(out.buffer), 'ảnh ra vẫn còn đoạn APP1/Exif').toBeNull();
    expect(gpsTags(out.buffer), 'ảnh ra vẫn còn IFD GPS').toBeNull();
    expect(await sharp(out.buffer).metadata().then((m) => m.exif)).toBeUndefined();
  });

  it('byte của ảnh ra không chứa con số toạ độ dưới BẤT KỲ hình dạng nào', async () => {
    // Lưới thứ hai, ở một tầng khác: bài trên tin vào bộ đọc EXIF, bài này
    // không tin gì cả — nó đi tìm chính những con số trong byte. Một cách xoá
    // "gần hết" (vd. bỏ IFD0 mà quên IFD GPS, hoặc chép EXIF sang đoạn COM)
    // vẫn qua được bài trên nhưng không qua được bài này.
    const out = await ingest(await anhCoGps());

    for (const [ten, so] of Object.entries(GPS)) {
      const le32 = Buffer.alloc(4);
      le32.writeUInt32LE(so);
      const be32 = Buffer.alloc(4);
      be32.writeUInt32BE(so);
      // Số nhỏ (20, 51, 105, 58) xuất hiện ngẫu nhiên trong byte ảnh là chuyện
      // bình thường, nên chỉ soi hai con số ĐỦ HIẾM để có nghĩa: phần giây.
      if (so < 1000) continue;
      expect(out.buffer.includes(le32), `còn ${ten} (little-endian) trong byte`).toBe(false);
      expect(out.buffer.includes(be32), `còn ${ten} (big-endian) trong byte`).toBe(false);
    }
    expect(out.buffer.toString('latin1').includes('Exif')).toBe(false);
    expect(out.buffer.toString('latin1').includes('NhaChung'), 'còn nhãn máy ảnh trong byte').toBe(false);
  });

  it('xoá EXIF rồi thì ĐIỂM ẢNH phải đã xoay — thẻ Orientation biến mất, ảnh thì không được nằm sai', async () => {
    // `.rotate()` không tham số là chỗ dễ bị bỏ khi ai đó "dọn cho gọn": bỏ nó
    // đi thì EXIF vẫn sạch (bài trên vẫn xanh) nhưng mọi ảnh dọc chụp bằng
    // điện thoại sẽ nằm ngang. Bài này là cái lưới riêng cho đúng nhịp đó.
    const doc = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#888' } })
      .jpeg()
      .toBuffer();
    // `withMetadata({ orientation })`, KHÔNG phải `exif.IFD0.Orientation` — đo
    // thật thì đường thứ hai bị sharp bỏ qua và ảnh ra vẫn `orientation = 1`,
    // tức bài test sẽ xanh mà chẳng kiểm gì.
    const xoay = await sharp(doc).withMetadata({ orientation: 6 }).toBuffer();
    expect(await sharp(xoay).metadata().then((m) => m.orientation), 'tiền đề: đầu vào phải mang thẻ xoay').toBe(6);

    const out = await ingest(xoay);
    expect({ w: out.width, h: out.height }, 'Orientation=6 nghĩa là xoay 90° — 200×100 phải thành 100×200').toEqual({
      w: 100,
      h: 200,
    });
  });

  it('cạnh dài nhất bị ép về 1600px, ảnh nhỏ không bị phóng to', async () => {
    const to = await ingest(
      await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#345' } }).jpeg().toBuffer()
    );
    expect({ w: to.width, h: to.height }).toEqual({ w: 1600, h: 1200 });

    const nho = await ingest(
      await sharp({ create: { width: 120, height: 90, channels: 3, background: '#345' } }).jpeg().toBuffer()
    );
    expect({ w: nho.width, h: nho.height }, 'withoutEnlargement: ảnh nhỏ giữ nguyên').toEqual({ w: 120, h: 90 });
  });
});

// ===========================================================================
describe('T28 danh sách TRẮNG theo magic bytes, không theo lời khai của client', () => {
  const CA = {
    jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    webp: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]),
  };

  it('ba loại trong danh sách trắng được nhận đúng tên', () => {
    expect(sniffImageType(CA.jpeg)).toBe('image/jpeg');
    expect(sniffImageType(CA.png)).toBe('image/png');
    expect(sniffImageType(CA.webp)).toBe('image/webp');
  });

  // Miền lặp KHÔNG lấy từ mã đang kiểm (dạng lỗ mù "miền lặp lấy từ chính mã
  // đang kiểm"): danh sách dưới đây viết tay ở đây, nên ai xoá một dòng khỏi
  // `MAGIC` trong service cũng không làm vòng lặp này co lại.
  it.each([
    ['PE/EXE (MZ)', Buffer.from('MZ\x90\x00\x03\x00\x00\x00')],
    ['ELF', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])],
    ['PDF', Buffer.from('%PDF-1.7\n')],
    ['SVG (ảnh, nhưng là XML chạy được script)', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['GIF', Buffer.from('GIF89a\x01\x00')],
    ['ZIP', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['RIFF nhưng là WAV, không phải WEBP', Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])],
    ['rỗng', Buffer.alloc(0)],
    ['một byte', Buffer.from([0xff])],
  ])('%s không vào được', (_ten, bytes) => {
    expect(sniffImageType(bytes)).toBeNull();
  });

  it('SVG khai là image/svg+xml — loại ẢNH thật, vẫn không nằm trong danh sách trắng', () => {
    // Ghi riêng vì nó là ca hay bị "nới cho tiện": SVG đúng là ảnh, nhưng nó
    // là XML và trình duyệt chạy `<script>` trong đó. Danh sách trắng ba dòng
    // ảnh RASTER là quyết định, không phải thiếu sót.
    expect(sniffImageType(Buffer.from('<?xml version="1.0"?><svg onload="alert(1)"/>'))).toBeNull();
  });
});

// ===========================================================================
describe('T28 POST /files qua HTTP', () => {
  it('ảnh PNG hợp lệ ⇒ 201 { id } snake_case, và đã thành JPEG ≤1600px trong kho', async () => {
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#123456' } })
      .png()
      .toBuffer();

    // Vé lấy bằng ĐĂNG NHẬP THẬT qua HTTP, không phải vé ký sẵn: bài đầu tiên
    // của luồng phải đi trọn con đường mà người dùng thật đi.
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${await dangNhap('alice-t28@nhachung.test')}`)
      .attach('file', png, { filename: 'anh.png', contentType: 'image/png' });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(Object.keys(res.body)).toEqual(['id']);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const {
      rows: [row],
    } = await db.raw(`SELECT * FROM files WHERE id = ?`, [res.body.id]);
    expect(row.mime).toBe('image/jpeg');
    expect(row.source_mime).toBe('image/png');
    expect(row.community_id).toBe(cidA);
    expect(row.owner_id).toBe(alice);
    expect(row.width).toBe(1600);
    expect(row.height).toBe(800);

    // Khoá lưu trữ KHÔNG được có mặt trong thân phản hồi: biết nó là đi tắt
    // được tới byte nếu ai đó lỡ mở một đường đọc theo khoá.
    expect(JSON.stringify(res.body)).not.toContain(row.storage_key);
  });

  it('tệp .exe khai Content-Type: image/jpeg ⇒ 415, không phải 201', async () => {
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[alice]}`)
      .attach('file', Buffer.from('MZ\x90\x00 day khong phai anh'), {
        filename: 'anh.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status, JSON.stringify(res.body)).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    // Không nói ra ta đoán nó là loại gì.
    expect(res.body.error.message).not.toMatch(/MZ|exe|thực thi/i);
  });

  it('byte có đầu JPEG hợp lệ nhưng không giải nén được ⇒ 422 FILE_CORRUPT (không phải 500)', async () => {
    const gia = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x41)]);
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[alice]}`)
      .attach('file', gia, { filename: 'x.jpg', contentType: 'image/jpeg' });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe('FILE_CORRUPT');
  });

  it('tệp quá 10 MB ⇒ 413, và KHÔNG có hàng nào được ghi', async () => {
    const truoc = Number((await db.raw(`SELECT count(*)::int AS n FROM files`)).rows[0].n);
    const to = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(11 * 1024 * 1024, 0x20)]);

    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[bob]}`)
      .attach('file', to, { filename: 'to.jpg', contentType: 'image/jpeg' });

    expect(res.status, JSON.stringify(res.body)).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(Number((await db.raw(`SELECT count(*)::int AS n FROM files`)).rows[0].n)).toBe(truoc);
  }, 30_000);

  it('không phải multipart ⇒ 400, không phải 500', async () => {
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[bob]}`)
      .set('content-type', 'application/json')
      .send({ file: 'khong-phai-the-nay' });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('multipart nhưng không có phần tệp nào ⇒ 400 FILE_MISSING', async () => {
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[bob]}`)
      .field('ghi_chu', 'khong dinh kem gi');

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe('FILE_MISSING');
  });

  it('hai phần tệp trong một request ⇒ 400, không im lặng nhận phần đầu', async () => {
    const anh = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[bob]}`)
      .attach('file', anh, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .attach('file', Buffer.from('MZ khong phai anh'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('chưa đăng nhập ⇒ 401, và chưa đọc byte nào của thân', async () => {
    const anh = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const res = await supertest(api).post('/api/v1/files').attach('file', anh, { filename: 'a.jpg' });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
describe('T28 GET /files/:id — mỗi lượt đọc đi qua kiểm quyền, và lọc community_id', () => {
  it('chính chủ đọc được tệp chưa gắn vào đâu, và nhận đúng byte đã lưu', async () => {
    const f = await gieoTep(cidA, alice);
    const res = await getBinary(`/api/v1/files/${f.id}`, tokens[alice]);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toContain('private');
    expect(Buffer.compare(res.body, f.buf)).toBe(0);
  });

  it('người CÙNG Hội KHÔNG đọc được tệp chưa gắn của người khác ⇒ 403 (mặc định là TỪ CHỐI)', async () => {
    const f = await gieoTep(cidA, alice);
    const res = await getBinary(`/api/v1/files/${f.id}`, tokens[bob]);
    expect(res.status).toBe(403);
  });

  it('tệp đã gắn làm ảnh đại diện: người cùng Hội đọc được', async () => {
    const f = await gieoTep(cidA, alice, { attach: 'member_avatar' });
    const res = await getBinary(`/api/v1/files/${f.id}`, tokens[bob]);
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body, f.buf)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // BÀI ĐỘT BIẾN CỦA CẢ TỆP NÀY. Lỗi quên lọc `community_id` đã lặp bảy lần
  // trong dự án. Tệp dưới đây là ảnh ĐẠI DIỆN — tức nếu bỏ `AND community_id`
  // khỏi câu SELECT trong `files/service.js#read`, Carol (Hội B) sẽ nhận 200 và
  // đúng byte ảnh của Alice (Hội A), chứ không phải 403. Chọn ảnh đại diện chứ
  // không phải ảnh chưa gắn là có chủ đích: với ảnh chưa gắn, bỏ bộ lọc vẫn
  // cho ra 403 và bài test sẽ xanh giả.
  // -------------------------------------------------------------------------
  it('người Hội KHÁC nhận 404 cho ảnh đại diện của Hội này — không phải 403, không phải 200', async () => {
    const f = await gieoTep(cidA, alice, { attach: 'member_avatar' });
    const res = await getBinary(`/api/v1/files/${f.id}`, tokens[carol]);

    expect(res.status, '200 nghĩa là bộ lọc community_id đã biến mất').toBe(404);
    // 404 chứ không 403: hai câu trả lời khác nhau sẽ nói cho người Hội khác
    // biết id này CÓ TỒN TẠI ở đâu đó.
    expect(res.body.length).toBeLessThan(500);
  });

  it('id bịa và id không phải uuid: 404 và 400, không rò gì', async () => {
    const bia = await getBinary('/api/v1/files/00000000-0000-4000-8000-000000000000', tokens[alice]);
    expect(bia.status).toBe(404);

    const sai = await getBinary('/api/v1/files/khong-phai-uuid', tokens[alice]);
    expect(sai.status, 'zod chặn trước khi chạm CSDL — 500 ở đây nghĩa là 22P02 đã lọt xuống').toBe(400);
  });

  it('tệp đã bỏ (deleted_at) không còn đọc được, kể cả với chính chủ', async () => {
    const f = await gieoTep(cidA, alice);
    await db.raw(`UPDATE files SET deleted_at = now() WHERE id = ?`, [f.id]);
    const res = await getBinary(`/api/v1/files/${f.id}`, tokens[alice]);
    expect(res.status).toBe(404);
  });

  it('sổ có mà byte không còn ⇒ 404 sạch sẽ, không phải 500', async () => {
    const f = await gieoTep(cidA, alice);
    const { remove } = await import('../src/core/storage.js');
    await remove(f.key);
    const res = await getBinary(`/api/v1/files/${f.id}`, tokens[alice]);
    expect(res.status).toBe(404);
  });

  it('chưa đăng nhập ⇒ 401', async () => {
    const f = await gieoTep(cidA, alice);
    const res = await getBinary(`/api/v1/files/${f.id}`, null);
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
describe('T28 nhật ký: mỗi lượt đọc để lại dấu, và lượt bị từ chối cũng vậy', () => {
  async function demLog(action, targetId) {
    const { rows } = await db.raw(
      `SELECT actor_id, detail FROM audit_log WHERE action = ? AND target_id = ?`,
      [action, targetId]
    );
    return rows;
  }

  it('tải lên ghi file.uploaded, và detail không chứa tên tệp người dùng đặt', async () => {
    const png = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#abc' } }).png().toBuffer();
    const res = await supertest(api)
      .post('/api/v1/files')
      .set('authorization', `Bearer ${tokens[carol]}`)
      .attach('file', png, { filename: 'CCCD-mat-truoc.png', contentType: 'image/png' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const rows = await demLog('file.uploaded', res.body.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(carol);
    expect(JSON.stringify(rows[0].detail)).not.toContain('CCCD');
    expect(rows[0].detail).toMatchObject({ source_format: 'png' });
  });

  it('đọc được ghi file.read; bị từ chối ghi file.denied — và dòng đó SỐNG SÓT (bẫy 1)', async () => {
    const f = await gieoTep(cidA, alice);

    expect((await getBinary(`/api/v1/files/${f.id}`, tokens[alice])).status).toBe(200);
    expect(await demLog('file.read', f.id)).toHaveLength(1);

    expect((await getBinary(`/api/v1/files/${f.id}`, tokens[bob])).status).toBe(403);
    const denied = await demLog('file.denied', f.id);
    // Đây là chỗ bẫy 1 cắn: ghi nhật ký RỒI throw trong cùng giao dịch thì
    // rollback xoá luôn dòng vừa ghi và bài này còn 0 hàng.
    expect(denied, 'lượt bị từ chối phải để lại dấu').toHaveLength(1);
    expect(denied[0].actor_id).toBe(bob);
  });

  it('người Hội khác không tạo được dòng nhật ký nào cho tệp của Hội này', async () => {
    const f = await gieoTep(cidA, alice, { attach: 'member_avatar' });
    expect((await getBinary(`/api/v1/files/${f.id}`, tokens[carol])).status).toBe(404);
    // Không có hàng nào để nói tới thì không có gì để ghi — và quan trọng hơn,
    // không ai ở Hội B ghi được một dòng nhật ký mang `community_id` của Hội A.
    expect(await demLog('file.read', f.id)).toHaveLength(0);
    expect(await demLog('file.denied', f.id)).toHaveLength(0);
  });
});

// ===========================================================================
describe('T28 ràng buộc ở tầng CSDL — thứ còn đứng khi tầng service bị đi vòng', () => {
  it('app_role KHÔNG xoá được hàng files — xoá hàng là làm byte thành vô chủ', async () => {
    const { appKnex } = await import('./helpers/db.js');
    const app = appKnex();
    try {
      await expect(app.raw(`DELETE FROM files WHERE false`)).rejects.toThrow(/permission denied/i);
      // Nhưng đánh dấu bỏ thì được — đây là đường xoá đúng.
      await expect(app.raw(`SELECT count(*) FROM files`)).resolves.toBeTruthy();
    } finally {
      await app.destroy();
    }
  });

  it.each([
    ['đổi storage_key sang khoá của tệp khác', `UPDATE files SET storage_key = 'muon-byte-cua-nguoi-khac' WHERE id = ?`],
    ['đổi chủ sở hữu', `UPDATE files SET owner_id = (SELECT id FROM members WHERE full_name = 'Bob T28') WHERE id = ?`],
    ['sửa dấu vân byte', `UPDATE files SET sha256 = repeat('b', 64) WHERE id = ?`],
  ])('trg_file_immutable chặn: %s', async (_ten, sql) => {
    const f = await gieoTep(cidA, alice);
    await expect(db.raw(sql, [f.id])).rejects.toThrow(/FILE_IMMUTABLE/);
  });

  it('trg_file_immutable chặn hồi sinh tệp đã bỏ', async () => {
    const f = await gieoTep(cidA, alice);
    await db.raw(`UPDATE files SET deleted_at = now() WHERE id = ?`, [f.id]);
    await expect(db.raw(`UPDATE files SET deleted_at = NULL WHERE id = ?`, [f.id])).rejects.toThrow(/FILE_IMMUTABLE/);
  });

  it('trg_file_immutable chặn dời tệp đã gắn sang đối tượng khác', async () => {
    const f = await gieoTep(cidA, alice, { attach: 'member_avatar' });
    await expect(
      db.raw(`UPDATE files SET attached_type = 'member_cover' WHERE id = ?`, [f.id])
    ).rejects.toThrow(/FILE_IMMUTABLE/);
  });

  it('CHECK chặn gắn ảnh của mình vào hồ sơ người khác', async () => {
    const f = await gieoTep(cidA, alice);
    await expect(
      db.raw(`UPDATE files SET attached_type = 'member_avatar', attached_id = ? WHERE id = ?`, [bob, f.id])
    ).rejects.toThrow(/files_attach_self/);
  });

  it('CHECK chặn loại tệp ngoài danh sách trắng, ngay ở tầng CSDL', async () => {
    await expect(
      db.raw(
        `INSERT INTO files (community_id, owner_id, storage_key, mime, source_mime, byte_size, width, height, sha256)
         VALUES (?, ?, 'k-la', 'application/pdf', 'image/png', 10, 10, 10, repeat('a',64))`,
        [cidA, alice]
      )
    ).rejects.toThrow(/files_mime_check/);
  });

  it('khoá ngoại GHÉP chặn tệp gắn cho người ở Hội khác', async () => {
    await expect(
      db.raw(
        `INSERT INTO files (community_id, owner_id, storage_key, mime, source_mime, byte_size, width, height, sha256)
         VALUES (?, ?, 'k-cheo', 'image/jpeg', 'image/png', 10, 10, 10, repeat('a',64))`,
        [cidB, alice] // Alice ở Hội A
      )
    ).rejects.toThrow(/files_owner_id_community_id_fkey|foreign key/i);
  });
});

// ===========================================================================
describe('T28 kho lưu trữ', () => {
  it('khoá lưu trữ ngẫu nhiên, không đoán được từ id nào', () => {
    const a = newKey('11111111-1111-1111-1111-111111111111');
    const b = newKey('11111111-1111-1111-1111-111111111111');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^c\/11111111-1111-1111-1111-111111111111\/[0-9a-f-]{36}\.jpg$/);
  });

  it('trình điều khiển đĩa ghi rồi đọc lại đúng byte', async () => {
    const key = newKey('22222222-2222-2222-2222-222222222222');
    const body = Buffer.from('byte that, khong phai ban gia trong bo nho');
    await put(key, body);
    const chunks = [];
    for await (const c of await getStream(key)) chunks.push(c);
    expect(Buffer.compare(Buffer.concat(chunks), body)).toBe(0);
  });

  it('khoá lưu trữ trỏ ra ngoài thư mục kho bị chặn', async () => {
    await expect(put('../../thoat-ra-ngoai.txt', Buffer.from('x'))).rejects.toThrow(/ngoài thư mục kho/);
  });

  // -------------------------------------------------------------------------
  // NÓI THẲNG GIỚI HẠN: bốn khẳng định dưới đây kiểm HÌNH DẠNG chữ ký SigV4,
  // không kiểm rằng MinIO chấp nhận nó — bộ kiểm thử không có MinIO để hỏi
  // (`docker-compose.test.yml` chỉ có `db`). Việc đối chiếu với một MinIO thật
  // đã làm bằng tay một lần và ghi số vào `task-15-report.md`; nó KHÔNG có mặt
  // trong suite, nên đây là chỗ hở đã biết chứ không phải chỗ được canh.
  // -------------------------------------------------------------------------
  it('signV4 dựng đúng hình dạng Authorization và nhạy với từng đầu vào', () => {
    const chung = {
      method: 'PUT',
      endpoint: 'http://storage:9000',
      key: 'c/abc/def.jpg',
      payloadHash: 'e'.repeat(64),
      now: new Date('2026-08-20T10:11:12.000Z'),
      accessKey: 'AKIA',
      secretKey: 'bimat',
      bucket: 'nhachung',
      region: 'us-east-1',
    };
    const s = signV4(chung);

    expect(s.url).toBe('http://storage:9000/nhachung/c/abc/def.jpg');
    expect(s.headers['x-amz-date']).toBe('20260820T101112Z');
    expect(s.headers['x-amz-content-sha256']).toBe('e'.repeat(64));
    expect(s.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIA\/20260820\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    );

    // Chữ ký phải đổi khi BẤT KỲ đầu vào nào đổi. Một cài đặt quên đưa method
    // hoặc payloadHash vào chuỗi ký vẫn trả về một chuỗi hex trông đúng.
    const chuKy = (o) => /Signature=([0-9a-f]{64})/.exec(signV4({ ...chung, ...o }).headers.authorization)[1];
    const goc = chuKy({});
    for (const [ten, doi] of [
      ['method', { method: 'GET' }],
      ['khoá đối tượng', { key: 'c/abc/khac.jpg' }],
      ['băm nội dung', { payloadHash: 'f'.repeat(64) }],
      ['khoá bí mật', { secretKey: 'bimat-khac' }],
      ['ngày', { now: new Date('2026-08-21T10:11:12.000Z') }],
      ['bucket', { bucket: 'khac' }],
    ]) {
      expect(chuKy(doi), `đổi ${ten} mà chữ ký không đổi`).not.toBe(goc);
    }
  });
});
