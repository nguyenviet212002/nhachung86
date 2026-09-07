# Sảnh Cờ — Kernel (mở rộng api/games) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện `api/src/modules/games/` thành Kernel đầy đủ cho Sảnh Cờ: 3 luật cờ tướng còn thiếu, phòng với khách vào bằng link không cần tài khoản, đồng hồ đếm ngược, cầu hoà, mất kết nối, rời phòng — hai người chơi thật đấu trọn ván qua web, không cần Engine (Pikafish) vẫn chạy được đầy đủ.

**Architecture:** Mở rộng module `api/src/modules/games/` đang có (không tạo service mới). Thành viên vẫn dùng `requireAuth`/JWT như cũ; khách-qua-link dùng token ngắn hạn gắn với đúng 1 ván (middleware mới `requireAuthOrGuestToken`), theo đúng khuôn "actor có thể null" đã có sẵn trong `withActor`/`audit.log`/các trigger CSDL (`nullif(current_setting('app.actor_id', true), '')::uuid`). Mọi thứ re-validate ở server — không tin báo cáo từ client cho hết giờ/mất kết nối.

**Tech Stack:** Node/Express, Postgres 16 (knex `trx.raw`), Vitest + supertest, SSE (`core/realtime.js`) đã có sẵn.

**Spec:** `docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md` (mục 2-5, 7). Phần Engine/Pikafish (mục 1, 6) và giao diện web là phạm vi của các plan sau — plan này chỉ Kernel.

## Global Constraints

- Mọi hành vi mới (hết giờ, mất kết nối, hoà, kết thúc ván) đều **tính lại ở server**, không tin giá trị client gửi lên — đúng nguyên tắc fail-closed của spec và đúng cách `move()` hiện có đang làm.
- Không thêm dependency mới — `crypto` (node built-in), `uuid`, các module `core/*`/`middleware/*` đã có là đủ.
- Actor `null` (khách) là trường hợp **đã được hỗ trợ sẵn** ở tầng CSDL (`withActor(null, fn)`, `audit.log` với `actorId: null`) — không cần cơ chế actor giả lập nào khác.
- `audit.detail` **không bao giờ chứa văn bản tự do của người dùng** (tên khách tự gõ, v.v.) — chỉ định danh/enum/số đếm, đúng luật đã canh trong `core/audit.js` (`assertSafeDetail`).
- Theo đúng convention hiện có của `api/games`: mọi UPDATE làm thay đổi trạng thái đều có `WHERE` điều kiện + `RETURNING` + kiểm `if (!row) throw INVALID_STATE(...)` để chống ghi đè race.
- File test nối vào bộ có sẵn: luật thuần ở `api/tests/t40-chess-rules.test.js`, route/service ở file mới `api/tests/t42-games-rooms.test.js` (theo đúng khuôn `t41-games-api.test.js`: `resetDb()`, tạo `communities`/`members` bằng `trx.raw`, ký JWT bằng `jwt.sign({sub,cid,typ:'access'}, config.JWT_SECRET,...)`, gọi qua `supertest(app)`).

---

### Task 1: `hashBoard` — khoá chuẩn hoá thế cờ

**Files:**
- Modify: `api/src/modules/games/rules.js` — thêm hàm sau `applyMove`
- Test: `api/tests/t40-chess-rules.test.js`

**Interfaces:**
- Produces: `hashBoard(board, turn) -> string`. Task 2 và Task 6 dùng hàm này.

- [ ] **Step 1: Viết test trước**

Thêm vào cuối `api/tests/t40-chess-rules.test.js` (trong `describe('T40 chess rules engine', ...)` hoặc `describe` mới ngay sau):

```js
describe('T40 hashBoard', () => {
  it('cùng thế cờ + cùng lượt cho cùng 1 khoá', () => {
    const b1 = rules.initBoard();
    const b2 = rules.initBoard();
    expect(rules.hashBoard(b1, 'r')).toBe(rules.hashBoard(b2, 'r'));
  });

  it('khác lượt đi thì khoá khác nhau dù cùng thế cờ', () => {
    const b = rules.initBoard();
    expect(rules.hashBoard(b, 'r')).not.toBe(rules.hashBoard(b, 'b'));
  });

  it('đổi vị trí 1 quân thì khoá đổi theo', () => {
    const b1 = rules.initBoard();
    const b2 = rules.clone(b1);
    b2[6][0] = null;
    b2[5][0] = { side: 'r', type: 'soldier' };
    expect(rules.hashBoard(b1, 'r')).not.toBe(rules.hashBoard(b2, 'r'));
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t40-chess-rules -t hashBoard`
Expected: FAIL — `rules.hashBoard is not a function`

- [ ] **Step 3: Cài đặt**

Thêm vào cuối `api/src/modules/games/rules.js`:

```js
const PIECE_CODE = { general: 'ge', advisor: 'ad', elephant: 'el', horse: 'ho', chariot: 'ch', cannon: 'ca', soldier: 'so' };
// Khoá chuẩn hoá 1 thế cờ + lượt đi, dùng đếm số lần lặp thế (mục 3 spec
// Kernel/Engine). KHÔNG phải băm mật mã — chuỗi so bằng trực tiếp được, tránh
// hẳn rủi ro đụng độ băm thay vì phải chọn thuật toán "đủ tốt".
export function hashBoard(board, turn) {
  let out = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      out += p ? p.side + PIECE_CODE[p.type] : '...';
    }
  }
  return out + '#' + turn;
}
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules -t hashBoard`
Expected: PASS (3/3)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/games/rules.js api/tests/t40-chess-rules.test.js
git commit -m "feat(cotuong): thêm hashBoard — khoá chuẩn hoá thế cờ cho phát hiện lặp"
```

---

### Task 2: `detectRepetition` + `detectNoCaptureDraw` — 3 luật còn thiếu

**Files:**
- Modify: `api/src/modules/games/rules.js`
- Test: `api/tests/t40-chess-rules.test.js`

**Interfaces:**
- Consumes: không (thuần, nhận mảng lịch sử đã dựng sẵn — không tự đọc CSDL)
- Produces: `detectRepetition(moveHistory) -> {reason:'truong-chieu', loser:'r'|'b'} | {reason:'hoa-3-lan', loser:null} | null`, `detectNoCaptureDraw(moveHistory) -> boolean`, `GIOI_HAN_60 = 120`. `moveHistory`: mảng theo đúng thứ tự đã đi, mỗi phần tử `{side:'r'|'b', isCheck:boolean, captured:boolean, boardHash:string}`. **Task 6 dựng mảng này từ `game_moves` + nước vừa áp rồi gọi cả hai hàm.**

- [ ] **Step 1: Viết test trước**

Thêm vào `api/tests/t40-chess-rules.test.js`:

```js
describe('T40 detectRepetition / detectNoCaptureDraw', () => {
  const m = (side, isCheck, boardHash, captured = false) => ({ side, isCheck, captured, boardHash });

  it('boardHash mới nhất mới xuất hiện 2 lần thì chưa tính là lặp', () => {
    const h = [m('r', false, 'A'), m('b', false, 'B'), m('r', false, 'A')];
    expect(rules.detectRepetition(h)).toBe(null);
  });

  it('lặp lần 3, không bên nào chiếu liên tục trong chu kỳ → hoà', () => {
    const h = [
      m('r', false, 'start'),
      m('b', false, 'B1'),
      m('r', false, 'C1'),
      m('b', false, 'start'),
      m('r', false, 'C1'),
      m('b', false, 'start'),
    ];
    expect(rules.detectRepetition(h)).toEqual({ reason: 'hoa-3-lan', loser: null });
  });

  it('lặp lần 3, đúng 1 bên chiếu ở mọi nước của mình trong chu kỳ → bên đó thua (trường chiếu)', () => {
    const h = [
      m('r', false, 'start'),
      m('b', false, 'B1'),
      m('r', true, 'C1'),
      m('b', false, 'start'),
      m('r', true, 'C1'),
      m('b', false, 'start'),
    ];
    expect(rules.detectRepetition(h)).toEqual({ reason: 'truong-chieu', loser: 'r' });
  });

  it('60 nước không ăn quân (120 bán nước) thì hoà', () => {
    const h = Array.from({ length: 120 }, (_, i) => m(i % 2 === 0 ? 'r' : 'b', false, 'x' + i));
    expect(rules.detectNoCaptureDraw(h)).toBe(true);
  });

  it('chưa đủ 120 bán nước thì chưa hoà', () => {
    const h = Array.from({ length: 119 }, (_, i) => m(i % 2 === 0 ? 'r' : 'b', false, 'x' + i));
    expect(rules.detectNoCaptureDraw(h)).toBe(false);
  });

  it('có 1 nước ăn quân trong 120 nước gần nhất thì đếm lại từ đó, chưa hoà', () => {
    const h = Array.from({ length: 130 }, (_, i) => m(i % 2 === 0 ? 'r' : 'b', false, 'x' + i, i === 20));
    expect(rules.detectNoCaptureDraw(h)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t40-chess-rules -t "detectRepetition|detectNoCaptureDraw"`
Expected: FAIL — `rules.detectRepetition is not a function`

- [ ] **Step 3: Cài đặt**

Thêm vào cuối `api/src/modules/games/rules.js`:

```js
// Ba luật Kernel còn thiếu (mục 3 spec Kernel/Engine). Cả hai hàm THUẦN — nhận
// lịch sử nước đã áp (đã gồm nước vừa xong ở cuối mảng), không tự đọc CSDL.

// Đếm boardHash mới nhất đã xuất hiện bao nhiêu lần. Lần thứ 3 → xét chu kỳ
// lặp (dải nước giữa 2 lần xuất hiện gần nhất) để phân biệt hoà thường và
// trường chiếu: một bên chiếu ở MỌI nước của chính bên đó suốt chu kỳ thì bên
// đó thua, không phải hoà. Cả hai bên cùng chiếu liên tục (hiếm, spec gốc
// không nói rõ) — xử hoà làm mặc định an toàn.
export function detectRepetition(moveHistory) {
  const n = moveHistory.length;
  if (n === 0) return null;
  const latestHash = moveHistory[n - 1].boardHash;
  const occurrenceIdx = [];
  for (let i = 0; i < n; i++) if (moveHistory[i].boardHash === latestHash) occurrenceIdx.push(i);
  if (occurrenceIdx.length < 3) return null;

  const cycleStart = occurrenceIdx[occurrenceIdx.length - 2] + 1;
  const cycleEnd = occurrenceIdx[occurrenceIdx.length - 1];
  const cycleMoves = moveHistory.slice(cycleStart, cycleEnd + 1);

  const checksEveryOwnMove = (side) => {
    const own = cycleMoves.filter((mv) => mv.side === side);
    return own.length > 0 && own.every((mv) => mv.isCheck);
  };
  const redPerpetual = checksEveryOwnMove('r');
  const blackPerpetual = checksEveryOwnMove('b');
  if (redPerpetual && !blackPerpetual) return { reason: 'truong-chieu', loser: 'r' };
  if (blackPerpetual && !redPerpetual) return { reason: 'truong-chieu', loser: 'b' };
  return { reason: 'hoa-3-lan', loser: null };
}

// GIOI_HAN_60 = 120 bán nước không ăn quân (đúng số đo trong spec Kernel/Engine).
export const GIOI_HAN_60 = 120;
export function detectNoCaptureDraw(moveHistory) {
  let streak = 0;
  for (let i = moveHistory.length - 1; i >= 0; i--) {
    if (moveHistory[i].captured) break;
    streak++;
  }
  return streak >= GIOI_HAN_60;
}
```

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules`
Expected: toàn bộ file PASS (kể cả các test cũ đã có từ trước)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/games/rules.js api/tests/t40-chess-rules.test.js
git commit -m "feat(cotuong): thêm detectRepetition/detectNoCaptureDraw — 3 luật Kernel còn thiếu"
```

---

### Task 3: Migration 057 — mở rộng `games`/`game_moves`

**Files:**
- Create: `api/src/db/migrations/057_games_rooms_clock.js`

**Interfaces:**
- Produces: toàn bộ cột mới trên `games`/`game_moves` liệt kê ở mục 2 spec. Task 5-11 dùng trực tiếp các cột này.

- [ ] **Step 1: Viết migration**

Tạo `api/src/db/migrations/057_games_rooms_clock.js`:

```js
// Mở rộng games/game_moves cho Kernel Sảnh Cờ: phòng có khách vào bằng link
// (không cần tài khoản), đồng hồ đếm ngược, cầu hoà, mất kết nối, máy đi hộ,
// và 2 cột hỗ trợ 3 luật còn thiếu (lặp thế/trường chiếu/60 nước).
// Xem docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md.
//
// invite_token_hash lưu SHA-256 của token — không lưu token thô, cùng khuôn
// modules/invites/token.js (link mời bảo lãnh, migration 031) chứ không phải
// mã ngắn kiểu "G-4a91" như bản nháp NHACCON6789: khách vào phòng bằng BẤM
// LINK (không gõ tay), nên không có lý do đánh đổi độ khó đoán lấy độ ngắn.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE games ALTER COLUMN black_member_id DROP NOT NULL;
    ALTER TABLE games ADD COLUMN black_guest_name text;
    ALTER TABLE games ADD COLUMN black_guest_token uuid;
    ALTER TABLE games ADD COLUMN invite_token_hash text UNIQUE;
    ALTER TABLE games ADD COLUMN red_time_ms int NOT NULL DEFAULT 600000;
    ALTER TABLE games ADD COLUMN black_time_ms int NOT NULL DEFAULT 600000;
    ALTER TABLE games ADD COLUMN turn_started_at timestamptz;
    ALTER TABLE games ADD COLUMN second_joined_at timestamptz;
    ALTER TABLE games ADD COLUMN red_ready_at timestamptz;
    ALTER TABLE games ADD COLUMN black_ready_at timestamptz;
    ALTER TABLE games ADD COLUMN draw_offered_by text CHECK (draw_offered_by IS NULL OR draw_offered_by IN ('r','b'));
    ALTER TABLE games ADD COLUMN disconnected_side text CHECK (disconnected_side IS NULL OR disconnected_side IN ('r','b'));
    ALTER TABLE games ADD COLUMN disconnected_at timestamptz;
    ALTER TABLE games ADD COLUMN red_ai_level text CHECK (red_ai_level IS NULL OR red_ai_level IN ('sieu','thong-minh','xuat-sac'));
    ALTER TABLE games ADD COLUMN black_ai_level text CHECK (black_ai_level IS NULL OR black_ai_level IN ('sieu','thong-minh','xuat-sac'));

    ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
    ALTER TABLE games ADD CONSTRAINT games_end_reason_check
      CHECK (end_reason IS NULL OR end_reason IN (
        'chieu-bi','het-nuoc-di','resign','declined','bat-tuong',
        'hoa-3-lan','hoa-60-nuoc','truong-chieu','het-gio','mat-ket-noi','roi-phong','hoa-thoa-thuan'
      ));

    ALTER TABLE game_moves ADD COLUMN is_check boolean NOT NULL DEFAULT false;
    ALTER TABLE game_moves ADD COLUMN board_hash text;

    DROP INDEX idx_games_active_pair;
    CREATE UNIQUE INDEX idx_games_active_pair
      ON games (community_id, LEAST(red_member_id, black_member_id), GREATEST(red_member_id, black_member_id))
      WHERE status IN ('pending', 'active') AND black_member_id IS NOT NULL;
  `);
}

// Lưu ý: dòng cuối SET NOT NULL sẽ lỗi nếu còn phòng-khách (black_member_id
// NULL) tồn tại lúc lùi migration — chấp nhận được, down() giả định môi
// trường sạch (test/dev reset), giống down() của 048 (DROP TABLE thẳng).
export async function down(knex) {
  await knex.raw(`
    DROP INDEX idx_games_active_pair;
    CREATE UNIQUE INDEX idx_games_active_pair
      ON games (community_id, LEAST(red_member_id, black_member_id), GREATEST(red_member_id, black_member_id))
      WHERE status IN ('pending', 'active');

    ALTER TABLE game_moves DROP COLUMN board_hash;
    ALTER TABLE game_moves DROP COLUMN is_check;

    ALTER TABLE games DROP CONSTRAINT games_end_reason_check;
    ALTER TABLE games ADD CONSTRAINT games_end_reason_check
      CHECK (end_reason IS NULL OR end_reason IN ('chieu-bi','het-nuoc-di','resign','declined','bat-tuong'));

    ALTER TABLE games DROP COLUMN black_ai_level;
    ALTER TABLE games DROP COLUMN red_ai_level;
    ALTER TABLE games DROP COLUMN disconnected_at;
    ALTER TABLE games DROP COLUMN disconnected_side;
    ALTER TABLE games DROP COLUMN draw_offered_by;
    ALTER TABLE games DROP COLUMN black_ready_at;
    ALTER TABLE games DROP COLUMN red_ready_at;
    ALTER TABLE games DROP COLUMN second_joined_at;
    ALTER TABLE games DROP COLUMN turn_started_at;
    ALTER TABLE games DROP COLUMN black_time_ms;
    ALTER TABLE games DROP COLUMN red_time_ms;
    ALTER TABLE games DROP COLUMN invite_token_hash;
    ALTER TABLE games DROP COLUMN black_guest_token;
    ALTER TABLE games DROP COLUMN black_guest_name;
    ALTER TABLE games ALTER COLUMN black_member_id SET NOT NULL;
  `);
}
```

- [ ] **Step 2: Chạy migration**

Run: `docker compose exec api npm run migrate`
Expected: log hiện `057_games_rooms_clock.js` đã chạy, không lỗi.

- [ ] **Step 3: Kiểm rollback rồi chạy lại (xác nhận `down()` đúng)**

Run: `docker compose exec api npx knex migrate:rollback --step 1 && docker compose exec api npm run migrate`
Expected: cả hai lệnh chạy sạch, không lỗi. (Môi trường test/dev hiện chưa có phòng-khách nào nên `down()` không vướng dòng SET NOT NULL.)

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/057_games_rooms_clock.js
git commit -m "feat(cotuong): migration mở rộng games/game_moves cho phòng, đồng hồ, máy đi hộ"
```

---

### Task 4: Middleware `requireAuthOrGuestToken`

**Files:**
- Modify: `api/src/middleware/auth.js` — tách `authenticateMemberToken` dùng lại được
- Create: `api/src/middleware/gameAuth.js`
- Test: `api/tests/t42-games-rooms.test.js` (file mới)

**Interfaces:**
- Consumes: `config.JWT_SECRET`, `knex` — đã có
- Produces: `authenticateMemberToken(token) -> Promise<{actor} | {error}>` (dùng lại trong `requireAuth`), `requireAuthOrGuestToken(req,res,next)` — set `req.actor = {id, communityId, roles, permissions, guestToken}` (`id=null, guestToken=<token>` cho khách). **Task 5 dùng middleware này thay `requireAuth` cho các route trong phòng.**

- [ ] **Step 1: Viết test trước (route tạm để kiểm middleware — sẽ dùng lại nguyên vẹn khi Task 5 gắn middleware này vào route thật)**

Tạo `api/tests/t42-games-rooms.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, alice, aliceToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(
    `INSERT INTO communities (code, name) VALUES ('t42-rooms', 'T42 Rooms') RETURNING id`
  );
  cid = community.id;
  const { rows: [row] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T42', 'member') RETURNING id`,
    [cid]
  );
  alice = row.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});

afterAll(async () => { await db.destroy(); });

describe('T42 tạo phòng — requireAuthOrGuestToken qua GET /:id', () => {
  it('JWT thành viên hợp lệ vẫn xem được ván (đường thành viên không đổi hành vi)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
  });

  it('không có Authorization header thì 401', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).get(`/api/v1/games/${created.body.id}`).expect(401);
  });

  it('token khách khớp black_guest_token của đúng ván thì xem được', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app)
      .post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách T42' }).expect(201);
    await supertest(app).get(`/api/v1/games/${joined.body.id}`)
      .set(auth(joined.body.guest_token)).expect(200);
  });

  it('token khách của ván KHÁC thì bị từ chối', async () => {
    const roomA = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const roomB = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joinedA = await supertest(app)
      .post(`/api/v1/games/rooms/${roomA.body.invite_token}/join`)
      .send({ guest_name: 'Khách A' }).expect(201);
    await supertest(app).get(`/api/v1/games/${roomB.body.id}`)
      .set(auth(joinedA.body.guest_token)).expect(401);
  });
});
```

Đây là test cho **hành vi cuối cùng** của Task 4+5+6 gộp lại (route `/rooms`, `/rooms/:token/join`, và `GET /:id` gắn `requireAuthOrGuestToken` chưa tồn tại tới hết Task 6) — chạy sẽ FAIL ở Step 2 vì thiếu cả 3, đúng ý "thất bại trước". Task 5 và 6 sẽ làm nốt phần còn thiếu để toàn bộ file này PASS.

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms`
Expected: FAIL — `POST /api/v1/games/rooms` trả 404 (route chưa tồn tại)

- [ ] **Step 3: Tách `authenticateMemberToken` khỏi `requireAuth` trong `api/src/middleware/auth.js`**

Thay toàn bộ nội dung `requireAuth` (giữ nguyên `requireRole` và mọi import ở đầu file) bằng:

```js
// Đọc JWT, tra vai + quyền hiện tại. Tách riêng khỏi requireAuth để
// requireAuthOrGuestToken (middleware/gameAuth.js) dùng lại được — không sao
// chép câu SQL lần thứ hai (một nguồn tra vai duy nhất).
export async function authenticateMemberToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
    if (payload.typ !== 'access') {
      return { error: new AppError('TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.', { status: 401 }) };
    }
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return { error: new AppError('TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn.', { status: 401 }) };
    }
    return { error: new AppError('TOKEN_INVALID', 'Phiên đăng nhập không hợp lệ.', { status: 401 }) };
  }

  const { rows } = await knex.raw(
    `SELECT m.status, r.key AS role_key, p.key AS permission_key
       FROM members m
       LEFT JOIN member_roles mr ON mr.member_id = m.id AND mr.community_id = m.community_id
       LEFT JOIN roles r ON r.id = mr.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE m.id = ? AND m.community_id = ?`,
    [payload.sub, payload.cid]
  );
  if (!rows.length || rows[0].status !== 'member') {
    return { error: new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không còn hiệu lực.', { status: 401 }) };
  }
  return {
    actor: {
      id: payload.sub,
      communityId: payload.cid,
      roles: [...new Set(rows.map((r) => r.role_key).filter(Boolean))],
      permissions: [...new Set(rows.map((r) => r.permission_key).filter(Boolean))],
    },
  };
}

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
  const { actor, error } = await authenticateMemberToken(token);
  if (error) return next(error);
  req.actor = actor;
  next();
}
```

- [ ] **Step 4: Tạo `api/src/middleware/gameAuth.js`**

```js
import { AppError } from '../core/errors.js';
import { knex } from '../db/knex.js';
import { authenticateMemberToken } from './auth.js';

// Đăng nhập thành viên (như requireAuth) HOẶC token khách gắn với đúng ván cờ
// trong :id — dùng cho các route trong phòng cờ mà khách-không-tài-khoản
// cũng phải gọi được (mục 4.1 spec Kernel/Engine). Đặt SAU
// validate(idParamSchema,'params') trên mọi route dùng middleware này, để
// :id đã chắc là uuid hợp lệ trước khi đưa vào câu SQL dưới đây.
export async function requireAuthOrGuestToken(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));

  const { actor, error } = await authenticateMemberToken(token);
  if (actor) {
    req.actor = { ...actor, guestToken: null };
    return next();
  }
  // Không phải JWT thành viên hợp lệ — thử nhánh khách. `error` (hết hạn/sai
  // token) bị bỏ qua ở đây có chủ đích: một JWT thành viên hỏng và một token
  // khách đúng hình dạng khác nhau ngay từ nguồn, không phải cùng một lỗi.
  void error;

  const gameId = req.params.id;
  if (!gameId) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));
  const { rows: [game] } = await knex.raw(
    `SELECT community_id, black_guest_token FROM games WHERE id = ?`,
    [gameId]
  );
  if (!game || !game.black_guest_token || game.black_guest_token !== token) {
    return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập hoặc mã khách.', { status: 401 }));
  }
  req.actor = { id: null, communityId: game.community_id, roles: [], permissions: [], guestToken: token };
  next();
}
```

- [ ] **Step 5: Chạy test hiện có để xác nhận KHÔNG hỏng gì (chưa mong đợi t42 pass — route /rooms chưa tồn tại)**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api`
Expected: toàn bộ PASS — xác nhận refactor `auth.js` không đổi hành vi `requireAuth`/route thành viên hiện có.

- [ ] **Step 6: Commit**

```bash
git add api/src/middleware/auth.js api/src/middleware/gameAuth.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): tách authenticateMemberToken, thêm requireAuthOrGuestToken cho khách vào phòng"
```

---

### Task 5: Định tuyến lại `routes.js` theo từng route (bỏ `requireAuth` toàn cục) + `GAME_SELECT` chấp nhận khách

**Files:**
- Modify: `api/src/modules/games/routes.js` — toàn bộ nội dung
- Modify: `api/src/modules/games/service.js` — `GAME_SELECT`, `loadGame`, `get`, thêm `resolveSide`

**Interfaces:**
- Produces: `resolveSide(actor, game) -> 'r'|'b'|null` trong `service.js`. **Task 6-11 dùng hàm này thay vì so `actor.id` trực tiếp.**
- Consumes: `requireAuthOrGuestToken` (Task 4).

- [ ] **Step 1: Thay toàn bộ `api/src/modules/games/routes.js`**

```js
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireAuthOrGuestToken } from '../../middleware/gameAuth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { subscribeGame } from '../../core/realtime.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();

// EventSource không gắn được header Authorization — cho phép truyền token
// qua query string ?access_token=... cho riêng route /stream (giống hệt
// notifications/routes.js).
function streamToken(req, _res, next) {
  if (!req.headers.authorization && req.query.access_token) {
    req.headers.authorization = `Bearer ${req.query.access_token}`;
  }
  next();
}
router.use(rateLimit({ windowMs: 60_000, max: 120 }), streamToken);

router.post('/challenges', requireAuth, validate(schema.challengeSchema), async (req, res, next) => {
  try { res.status(201).json(await service.challenge({ actor: req.actor, opponentMemberId: req.body.opponent_member_id })); }
  catch (e) { next(e); }
});
router.post('/challenges/:id/accept', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.acceptChallenge({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/challenges/:id/decline', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.declineChallenge({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/quick-match', requireAuth, async (req, res, next) => {
  try { res.json(await service.quickMatch({ actor: req.actor })); } catch (e) { next(e); }
});
router.delete('/quick-match', requireAuth, async (req, res, next) => {
  try { res.json(await service.leaveQuickMatch({ actor: req.actor })); } catch (e) { next(e); }
});
router.get('/', requireAuth, validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try {
    res.json(await service.list({ actor: req.actor, status: req.query.status,
      mine: req.query.mine === 'true', page: req.query.page, limit: req.query.limit }));
  } catch (e) { next(e); }
});

router.get('/:id', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.get({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.get('/:id/stream', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try {
    await service.assertVisible({ actor: req.actor, id: req.params.id });
  } catch (e) { return next(e); }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ game_id: req.params.id })}\n\n`);
  const unsubscribe = subscribeGame(req.params.id, req.actor.id, res);
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(keepalive); unsubscribe(); });
});
router.post('/:id/moves', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, validate(schema.moveSchema), async (req, res, next) => {
  try { res.json(await service.move({ actor: req.actor, id: req.params.id, from: req.body.from, to: req.body.to })); }
  catch (e) { next(e); }
});
router.post('/:id/resign', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.resign({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

(Chưa có `/rooms`, `/rooms/:token/join`, `/ready`, `/timeout`, `/draw/*`, `/disconnect-timeout`, `/leave` — Task 6-11 nối thêm vào cuối file này.)

- [ ] **Step 2: Sửa `GAME_SELECT`/`loadGame`/`get` + thêm `resolveSide` trong `api/src/modules/games/service.js`**

Tìm khối `GAME_SELECT`/`loadGame` hiện tại (đầu file, sau các import):

```js
const GAME_SELECT = `
  SELECT g.id, g.status, g.board, g.turn, g.winner_member_id, g.end_reason,
         g.created_at, g.started_at, g.finished_at,
         g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
         g.black_member_id, b.full_name AS black_name, b.avatar_url AS black_avatar_url
    FROM games g
    JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
    JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id`;

async function loadGame(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ? AND g.community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}
```

Thay bằng:

```js
const GAME_SELECT = `
  SELECT g.id, g.community_id, g.status, g.board, g.turn, g.winner_member_id, g.end_reason,
         g.created_at, g.started_at, g.finished_at,
         g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
         g.black_member_id, COALESCE(b.full_name, g.black_guest_name) AS black_name, b.avatar_url AS black_avatar_url,
         g.black_guest_token, g.invite_token_hash,
         g.red_time_ms, g.black_time_ms, g.turn_started_at,
         g.second_joined_at, g.red_ready_at, g.black_ready_at,
         g.draw_offered_by, g.disconnected_side, g.disconnected_at,
         g.red_ai_level, g.black_ai_level
    FROM games g
    JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
    LEFT JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id`;

// khách/thành viên đang là bên nào trong VÁN NÀY — 'null === null' không được
// coi là trùng khớp (một khách chưa xác thực và một phòng chưa có khách đều
// có giá trị null, so trực tiếp actor.id===game.black_member_id sẽ SAI ở đây).
function resolveSide(actor, game) {
  if (actor.id && actor.id === game.red_member_id) return 'r';
  if (actor.id && actor.id === game.black_member_id) return 'b';
  if (actor.guestToken && game.black_guest_token && actor.guestToken === game.black_guest_token) return 'b';
  return null;
}

async function loadGame(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ? AND g.community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}
```

Tìm hàm `get` hiện tại:

```js
export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, created_at
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    return { ...game, moves };
  });
}
```

Thay bằng (bỏ `black_guest_token` khỏi kết quả trả cho client — đó là bí mật của riêng khách, không phải dữ liệu hiển thị):

```js
export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, created_at
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    const { black_guest_token, invite_token_hash, ...publicGame } = game;
    return { ...publicGame, moves };
  });
}
```

Tìm 2 chỗ tính `mySide` trong `move()` và `resign()`:

```js
const mySide = actor.id === game.red_member_id ? 'r' : actor.id === game.black_member_id ? 'b' : null;
```

Thay **cả hai chỗ** bằng:

```js
const mySide = resolveSide(actor, game);
```

- [ ] **Step 3: Chạy toàn bộ test cờ tướng hiện có — xác nhận không hỏng gì**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api`
Expected: toàn bộ PASS — hành vi cho thành viên (đường cũ) giữ nguyên 100%.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/games/routes.js api/src/modules/games/service.js
git commit -m "refactor(cotuong): tách middleware theo route, resolveSide dùng chung cho thành viên/khách"
```

---

### Task 6: `move()` — áp 3 luật còn thiếu + đồng hồ

**Files:**
- Modify: `api/src/modules/games/service.js` — toàn bộ hàm `move`
- Test: `api/tests/t40-chess-rules.test.js` hoặc `t42-games-rooms.test.js` (test tích hợp qua API)

**Interfaces:**
- Consumes: `rules.hashBoard`, `rules.detectRepetition`, `rules.detectNoCaptureDraw` (Task 1-2), cột `is_check`/`board_hash`/`red_time_ms`/`black_time_ms`/`turn_started_at` (Task 3), `resolveSide` (Task 5).
- Produces: `move()` sau task này áp cả luật lẫn đồng hồ trong **một** chỗ — không tách vì cả hai đều sửa cùng câu UPDATE, tách sẽ dễ lệch giữa 2 lần sửa.

- [ ] **Step 1: Viết test trước — trường chiếu xử thua đúng bên, đồng hồ trừ đúng thời gian đã dùng**

Thêm vào `api/tests/t42-games-rooms.test.js` (dùng lại `db`/`app`/`cid` từ `beforeAll` đã có ở Task 4 — thêm biến `bob`/`bobToken` vào cùng `beforeAll`):

```js
// Thêm vào cuối beforeAll() đã có, sau khi tạo alice:
const { rows: [bobRow] } = await db.raw(
  `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T42', 'member') RETURNING id`,
  [cid]
);
bob = bobRow.id;
bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
```

(Khai `let db, app, cid, alice, aliceToken, bob, bobToken;` ở đầu file thay dòng `let db, app, cid, alice, aliceToken;` hiện có.)

```js
describe('T42 move() — đồng hồ trừ thời gian đã dùng', () => {
  it('sau 1 nước đi, red_time_ms giảm đúng khoảng thời gian đã trôi qua', async () => {
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);

    await new Promise((r) => setTimeout(r, 50));
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);

    const detail = await supertest(app).get(`/api/v1/games/${challenge.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.red_time_ms).toBeLessThan(600000);
    expect(detail.body.red_time_ms).toBeGreaterThan(600000 - 5000); // trừ đúng ~50ms, không trừ nhầm hàng giây
    expect(detail.body.black_time_ms).toBe(600000); // Đen chưa đi, chưa trừ
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "đồng hồ trừ"`
Expected: FAIL — `detail.body.red_time_ms` là `undefined` (chưa trả về, `get()` chưa lộ trực tiếp field này ra ngoài `publicGame`) hoặc bằng đúng 600000 (chưa trừ)

- [ ] **Step 3: Thay toàn bộ hàm `move()` trong `api/src/modules/games/service.js`**

```js
export async function move({ actor, id, from, to }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (mySide !== game.turn) throw FORBIDDEN('Chưa tới lượt bạn.');
    const piece = game.board[from.r]?.[from.c];
    if (!piece || piece.side !== mySide) {
      throw new AppError('VALIDATION_FAILED', 'Ô xuất phát không có quân của bạn.', { status: 422 });
    }
    const legal = rules.legalMoves(game.board, from.r, from.c);
    if (!legal.some((m) => m.r === to.r && m.c === to.c)) {
      throw new AppError('VALIDATION_FAILED', 'Nước đi không hợp lệ.', { status: 422 });
    }
    const applied = rules.applyMove(game.board, from, to);
    let gameOver = applied.gameOver, winner = applied.winner, reason = applied.reason;

    const { rows: pastMoves } = await trx.raw(
      `SELECT side, is_check AS "isCheck", captured_type IS NOT NULL AS captured, board_hash AS "boardHash"
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    const newTurnIfContinuing = rules.opp(mySide);
    const newHash = rules.hashBoard(applied.board, gameOver ? game.turn : newTurnIfContinuing);
    const moveHistory = [...pastMoves, { side: mySide, isCheck: applied.checkOpp, captured: !!applied.captured, boardHash: newHash }];

    if (!gameOver) {
      const rep = rules.detectRepetition(moveHistory);
      if (rep) {
        gameOver = true; reason = rep.reason;
        winner = rep.loser ? rules.opp(rep.loser) : null;
      } else if (rules.detectNoCaptureDraw(moveHistory)) {
        gameOver = true; reason = 'hoa-60-nuoc'; winner = null;
      }
    }

    const newTurn = gameOver ? game.turn : newTurnIfContinuing;
    const winnerId = !gameOver ? null : winner === 'r' ? game.red_member_id : winner === 'b' ? game.black_member_id : null;

    const elapsedMs = game.turn_started_at ? Math.max(0, Date.now() - new Date(game.turn_started_at).getTime()) : 0;
    const preMoveTimeMs = mySide === 'r' ? game.red_time_ms : game.black_time_ms;
    const postMoveTimeMs = Math.max(0, preMoveTimeMs - elapsedMs);
    const movedTimeCol = mySide === 'r' ? 'red_time_ms' : 'black_time_ms';

    const { rows: [row] } = await trx.raw(
      `UPDATE games SET board = ?::jsonb, turn = ?, status = ?, winner_member_id = ?, end_reason = ?,
              finished_at = CASE WHEN ? THEN now() ELSE finished_at END,
              ?? = ?, turn_started_at = CASE WHEN ? THEN NULL ELSE now() END
        WHERE id = ? AND status = 'active' AND turn = ? RETURNING *`,
      [JSON.stringify(applied.board), newTurn, gameOver ? 'finished' : 'active',
       winnerId, gameOver ? reason : null, gameOver,
       movedTimeCol, postMoveTimeMs, gameOver,
       id, mySide]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const { rows: [seqRow] } = await trx.raw(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM game_moves WHERE game_id = ?`, [id]);
    await trx.raw(
      `INSERT INTO game_moves (community_id, game_id, seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, board_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [actor.communityId, id, seqRow.seq, mySide, from.r, from.c, to.r, to.c,
       applied.captured?.type ?? null, applied.checkOpp, newHash]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.move', targetType: 'game', targetId: id,
      detail: { side: mySide, from_r: from.r, from_c: from.c, to_r: to.r, to_c: to.c } });

    const opponentId = mySide === 'r' ? game.black_member_id : game.red_member_id;
    let notification = null;
    if (opponentId && !isWatchingGame(id, opponentId)) {
      const title = gameOver ? 'Ván cờ đã kết thúc' : 'Đến lượt bạn đi';
      const body = gameOver
        ? (winner === mySide ? 'Bạn đã thắng.' : winner ? 'Đối thủ đã thắng.' : 'Ván cờ kết thúc hoà.')
        : 'Đối thủ vừa đi một nước, tới lượt bạn.';
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'game_turn', ?, ?, 'game', ?) RETURNING *`,
        [actor.communityId, opponentId, actor.id, title, body, id]
      );
      notification = n;
    }
    return { board: applied.board, turn: newTurn, gameOver, winner, reason, captured: applied.captured, opponentId, notification };
  });

  publishToGame(id, 'move', { board: result.board, turn: result.turn, last_move: { from, to },
    captured: result.captured ? result.captured.type : null });
  if (result.gameOver) publishToGame(id, 'game_end', { winner: result.winner, reason: result.reason });
  if (result.notification) publishToMember(result.opponentId, 'notification', result.notification);
  return { board: result.board, turn: result.turn, status: result.gameOver ? 'finished' : 'active' };
}
```

Đổi so với bản cũ: `mySide` dùng `resolveSide` (Task 5 đã đổi); thêm khối tính `gameOver/winner/reason` qua 3 luật mới; `winnerId` xử rõ `winner === null` (hoà — bản cũ chỉ có ternary 2 nhánh, sẽ SAI thành `black_member_id` nếu winner null); thêm `??`/đồng hồ vào UPDATE; `INSERT game_moves` thêm `is_check, board_hash`; câu thông báo thêm nhánh hoà; `opponentId &&` chặn tạo notification khi đối thủ là khách (không có hộp thư).

- [ ] **Step 4: Chạy test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api t42-games-rooms`
Expected: toàn bộ PASS, kể cả `t41-games-api.test.js` cũ (đường thành viên-vs-thành viên không đổi hành vi bên ngoài).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/games/service.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): move() áp 3 luật còn thiếu + trừ đồng hồ mỗi nước"
```

---

### Task 7: Tạo phòng + khách vào phòng

**Files:**
- Modify: `api/src/modules/games/service.js` — thêm `createRoom`, `joinRoom`
- Modify: `api/src/modules/games/schema.js` — thêm `joinRoomSchema`
- Modify: `api/src/modules/games/routes.js` — thêm 2 route

**Interfaces:**
- Consumes: `newInviteToken`/`hashInviteToken` (`api/src/modules/invites/token.js`, đã có), `randomUUID` (`node:crypto`).
- Produces: `POST /rooms -> {id, invite_token}` (token thô CHỈ trả về đúng 1 lần), `POST /rooms/:token/join -> {id, guest_token}`. Task 8+ đọc `black_guest_name`/`second_joined_at` do `joinRoom` set.

- [ ] **Step 1: Viết test trước**

Thêm vào `api/tests/t42-games-rooms.test.js`:

```js
describe('T42 tạo phòng / vào phòng', () => {
  it('tạo phòng: chủ phòng cầm Đỏ, chưa có khách, trả về invite_token thô', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.invite_token).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url, entropy cao — không phải "G-xxxx"

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.red_member_id).toBe(alice);
    expect(detail.body.black_member_id).toBe(null);
    expect(detail.body.black_guest_token).toBeUndefined(); // bí mật của khách, không lộ ra response
  });

  it('vào phòng bằng token sai thì 404, đúng token thì set tên khách + phát guest_token', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/token-sai/join`).send({ guest_name: 'Ai đó' }).expect(404);

    const joined = await supertest(app)
      .post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Vui Vẻ' }).expect(201);
    expect(joined.body.guest_token).toBeTruthy();

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.black_name).toBe('Khách Vui Vẻ');
  });

  it('phòng đã có khách thì người thứ hai vào bằng cùng link bị từ chối', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Người 1' }).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Người 2' }).expect(409);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "tạo phòng"`
Expected: FAIL — `POST /api/v1/games/rooms` trả 404 (route chưa tồn tại)

- [ ] **Step 3: Thêm `joinRoomSchema` vào `api/src/modules/games/schema.js`**

Thêm cuối file:

```js
export const joinRoomSchema = z.object({ guest_name: z.string().trim().min(1).max(40) });
```

- [ ] **Step 4: Thêm `createRoom`/`joinRoom` vào `api/src/modules/games/service.js`**

Thêm import ở đầu file (cạnh các import hiện có):

```js
import { randomUUID } from 'node:crypto';
import { newInviteToken, hashInviteToken } from '../invites/token.js';
```

Thêm 2 hàm (đặt sau `resign`, cuối file):

```js
export async function createRoom({ actor }) {
  const rawToken = newInviteToken();
  const tokenHash = hashInviteToken(rawToken);
  const id = await withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO games (community_id, red_member_id, black_member_id, status, turn, invite_token_hash)
       VALUES (?, ?, NULL, 'pending', 'r', ?) RETURNING id`,
      [actor.communityId, actor.id, tokenHash]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.room_opened', targetType: 'game', targetId: row.id, detail: {} });
    return row.id;
  });
  return { id, invite_token: rawToken };
}

export async function joinRoom({ rawToken, guestName }) {
  const tokenHash = hashInviteToken(rawToken);
  const result = await withActor(null, async (trx) => {
    const { rows: [game] } = await trx.raw(
      `SELECT id, community_id, status, black_member_id, black_guest_name
         FROM games WHERE invite_token_hash = ?`,
      [tokenHash]
    );
    if (!game) throw NOT_FOUND();
    if (game.status !== 'pending' || game.black_member_id || game.black_guest_name) {
      throw INVALID_STATE('Phòng này đã có khách hoặc đã bắt đầu.');
    }
    const guestToken = randomUUID();
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET black_guest_name = ?, black_guest_token = ?, second_joined_at = now()
        WHERE id = ? AND status = 'pending' AND black_member_id IS NULL AND black_guest_name IS NULL
        RETURNING id`,
      [guestName, guestToken, game.id]
    );
    if (!row) throw INVALID_STATE('Phòng này đã có khách hoặc đã bắt đầu.');
    await auditLog(trx, { communityId: game.community_id, actorId: null,
      action: 'chess_game.guest_joined', targetType: 'game', targetId: game.id, detail: {} });
    return { gameId: game.id, guestToken };
  });
  return { id: result.gameId, guest_token: result.guestToken };
}
```

- [ ] **Step 5: Thêm 2 route vào cuối `api/src/modules/games/routes.js`**

```js
router.post('/rooms', requireAuth, async (req, res, next) => {
  try { res.status(201).json(await service.createRoom({ actor: req.actor })); } catch (e) { next(e); }
});
router.post('/rooms/:token/join', validate(schema.joinRoomSchema), async (req, res, next) => {
  try { res.status(201).json(await service.joinRoom({ rawToken: req.params.token, guestName: req.body.guest_name })); }
  catch (e) { next(e); }
});
```

(Không có `requireAuth`/`requireAuthOrGuestToken` trên route `join` — đúng ý "khách không cần đăng nhập". Vị trí khai báo trong file không quan trọng ở đây: `/rooms` và `/rooms/:token/join` khác hẳn hình dạng (số đoạn đường dẫn) so với `/:id` và `/:id/moves`, nên Express không thể nhầm giữa chúng dù đặt trước hay sau — chỉ đặt cạnh nhau cho dễ đọc.)

- [ ] **Step 6: Chạy test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t42-games-rooms`
Expected: toàn bộ PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/schema.js api/src/modules/games/routes.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): tạo phòng + khách vào phòng bằng link, không cần tài khoản"
```

---

### Task 8: Sẵn sàng — 4 trạng thái + dọn khách quá 30 giây

**Files:**
- Modify: `api/src/modules/games/service.js` — thêm `ready`, `evictStaleGuestIfNeeded`, sửa `loadGame`
- Modify: `api/src/modules/games/routes.js`

**Interfaces:**
- Produces: `POST /:id/ready`. `loadGame` sau task này TỰ dọn khách quá hạn trước khi trả về (mọi hàm gọi `loadGame` — `get`, `move`, `resign`, `ready`, và Task 9-11 sau này — đều được hưởng miễn phí).

- [ ] **Step 1: Viết test trước**

Thêm vào `api/tests/t42-games-rooms.test.js`:

```js
describe('T42 sẵn sàng — 4 trạng thái + hết 30 giây', () => {
  it('cả hai bấm sẵn sàng thì ván chuyển active, bàn cờ khởi tạo, Đỏ đi trước', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Sẵn Sàng' }).expect(201);

    const r1 = await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    expect(r1.body.active).toBe(false);
    const r2 = await supertest(app).post(`/api/v1/games/${created.body.id}/ready`)
      .set(auth(joined.body.guest_token)).expect(200);
    expect(r2.body.active).toBe(true);

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('active');
    expect(detail.body.turn).toBe('r');
    expect(detail.body.board[9][4]).toEqual({ side: 'r', type: 'general' });
  });

  it('bấm sẵn sàng lần 2 thì bị từ chối (409)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(409);
  });

  it('khách quá 30 giây không bấm sẵn sàng thì bị dọn khỏi phòng, chủ phòng ở lại — lần đọc kế tiếp tự phát hiện', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Chậm' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);

    // dựng thẳng lúc vào phòng lùi về quá khứ — mô phỏng "đã quá 30 giây" mà
    // không phải Sleep thật trong test (chậm, không cần thiết).
    await db.raw(`UPDATE games SET second_joined_at = now() - interval '31 seconds' WHERE id = ?`, [created.body.id]);

    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('pending');
    expect(detail.body.black_member_id).toBe(null);
    expect(detail.body.black_name).toBe(null);

    // token khách cũ không dùng được nữa (đã bị dọn)
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(401);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "sẵn sàng"`
Expected: FAIL — `POST /:id/ready` trả 404

- [ ] **Step 3: Sửa `loadGame`, thêm `evictStaleGuestIfNeeded` + `ready` trong `api/src/modules/games/service.js`**

Thay `loadGame` (đã sửa ở Task 5) bằng:

```js
async function loadGame(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ? AND g.community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return evictStaleGuestIfNeeded(trx, row);
}

// Luật 30 giây (mục 4.3 spec): khách không bấm sẵn sàng kịp thì bị đưa ra khỏi
// phòng — kiểm KIỂU LAZY ngay trong lần đọc/ghi tiếp theo, không cần job nền
// riêng. Chủ phòng không bị đuổi ("chủ phòng tuyệt đối") nên red_ready_at giữ
// nguyên — người đã bấm đúng phần mình không phải bấm lại khi khách sau đó bị
// dọn (mục IV.3 SANH_CO_GIAO_VIEC_DAY_DU.md: "người đã bấm ở lại"). GAME_SELECT
// có alias riêng cho từng cột (vd. black_name khác tên cột thật black_guest_name)
// nên không dùng RETURNING trực tiếp sau UPDATE được — đọc lại bằng chính
// GAME_SELECT thay vì cố khớp danh sách cột bằng tay.
async function evictStaleGuestIfNeeded(trx, game) {
  if (game.status !== 'pending' || !game.second_joined_at || game.black_ready_at) return game;
  const elapsedMs = Date.now() - new Date(game.second_joined_at).getTime();
  if (elapsedMs <= 30_000) return game;
  await trx.raw(
    `UPDATE games SET black_member_id = NULL, black_guest_name = NULL, black_guest_token = NULL, second_joined_at = NULL
      WHERE id = ? AND status = 'pending' AND second_joined_at = ?`,
    [game.id, game.second_joined_at]
  );
  const { rows: [fresh] } = await trx.raw(`${GAME_SELECT} WHERE g.id = ?`, [game.id]);
  return fresh ?? game;
}
```

Thêm hàm `ready` (cuối file, sau `joinRoom`):

```js
export async function ready({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'pending') throw INVALID_STATE('Ván này không còn ở bước chuẩn bị.');
    if (!game.black_member_id && !game.black_guest_name) throw INVALID_STATE('Chưa có đối thủ vào phòng.');
    const col = mySide === 'r' ? 'red_ready_at' : 'black_ready_at';
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET ?? = now() WHERE id = ? AND status = 'pending' AND ?? IS NULL
        RETURNING red_ready_at, black_ready_at`,
      [col, id, col]
    );
    if (!row) throw INVALID_STATE('Bạn đã bấm sẵn sàng rồi.');
    let becameActive = false;
    if (row.red_ready_at && row.black_ready_at) {
      const board = rules.initBoard();
      await trx.raw(
        `UPDATE games SET status = 'active', board = ?::jsonb, turn = 'r', started_at = now(), turn_started_at = now()
          WHERE id = ? AND status = 'pending'`,
        [JSON.stringify(board), id]
      );
      becameActive = true;
    }
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.ready', targetType: 'game', targetId: id, detail: { side: mySide } });
    return { becameActive };
  });
  if (result.becameActive) publishToGame(id, 'game_start', { turn: 'r' });
  return { ready: true, active: result.becameActive };
}
```

- [ ] **Step 4: Thêm route vào cuối `api/src/modules/games/routes.js`**

```js
router.post('/:id/ready', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.ready({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Chạy test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api t42-games-rooms`
Expected: toàn bộ PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): sẵn sàng vào trận, dọn khách quá 30 giây kiểu lazy"
```

---

### Task 9: Đồng hồ khi đọc + hết giờ

**Files:**
- Modify: `api/src/modules/games/service.js` — `computeRemainingMs`, `get`, thêm `claimTimeout`
- Modify: `api/src/modules/games/routes.js`

**Interfaces:**
- Produces: `GET /:id` trả thêm `red_time_remaining_ms`/`black_time_remaining_ms` (tính lúc đọc, KHÔNG lưu CSDL). `POST /:id/timeout`.

- [ ] **Step 1: Viết test trước**

Thêm vào `api/tests/t42-games-rooms.test.js`:

```js
describe('T42 đồng hồ — hết giờ', () => {
  async function activeGame(hostToken, hostId) {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(hostToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Đồng Hồ' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(hostToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    return { id: created.body.id, guestToken: joined.body.guest_token };
  }

  it('GET /:id trả thời gian còn lại giảm dần khi đang tới lượt, đứng yên khi không phải lượt', async () => {
    const { id } = await activeGame(aliceToken, alice);
    const d1 = await supertest(app).get(`/api/v1/games/${id}`).set(auth(aliceToken)).expect(200);
    expect(d1.body.red_time_remaining_ms).toBeLessThanOrEqual(600000);
    expect(d1.body.black_time_remaining_ms).toBe(600000); // chưa tới lượt Đen, đứng yên
  });

  it('gọi /timeout khi chưa thật sự hết giờ thì bị từ chối', async () => {
    const { id } = await activeGame(aliceToken, alice);
    await supertest(app).post(`/api/v1/games/${id}/timeout`).set(auth(aliceToken)).expect(409);
  });

  it('hết giờ thật (server tự tính lại, không tin client) thì bên kia thắng', async () => {
    // activeGame() để bàn cờ ở lượt Đỏ (turn='r') ngay sau ready(); lùi
    // turn_started_at khiến ĐỎ (chủ phòng, alice) hết giờ, nên bên thắng là
    // Đen — nhưng Đen ở đây là khách, không có member id để ghi vào
    // winner_member_id (đúng thiết kế mục 5: thắng vẫn xác định bằng bên 'r'/'b',
    // winner_member_id chỉ có giá trị khi bên thắng là một thành viên thật).
    const { id, guestToken } = await activeGame(aliceToken, alice);
    await db.raw(`UPDATE games SET turn_started_at = now() - interval '11 minutes' WHERE id = ?`, [id]);
    const res = await supertest(app).post(`/api/v1/games/${id}/timeout`).set(auth(guestToken)).expect(200);
    expect(res.body.status).toBe('finished');
    const detail = await supertest(app).get(`/api/v1/games/${id}`).set(auth(guestToken)).expect(200);
    expect(detail.body.end_reason).toBe('het-gio');
    expect(detail.body.winner_member_id).toBe(null);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "đồng hồ|hết giờ"`
Expected: FAIL — `red_time_remaining_ms` là `undefined`, `POST /:id/timeout` trả 404

- [ ] **Step 3: Thêm `computeRemainingMs`, sửa `get`, thêm `claimTimeout` trong `api/src/modules/games/service.js`**

Thêm hàm (cạnh `resolveSide`):

```js
// Không đếm ngược ở server — tính lại thời gian còn lại MỖI LẦN đọc, từ
// turn_started_at. Đứng yên khi ván chưa active, khi đang tạm dừng vì mất kết
// nối (Task 10), hoặc khi chưa ai đi nước nào (turn_started_at null).
function computeRemainingMs(game) {
  const remaining = { red: game.red_time_ms, black: game.black_time_ms };
  if (game.status !== 'active' || !game.turn_started_at || game.disconnected_side) return remaining;
  const elapsed = Date.now() - new Date(game.turn_started_at).getTime();
  const key = game.turn === 'r' ? 'red' : 'black';
  remaining[key] = Math.max(0, remaining[key] - elapsed);
  return remaining;
}
```

Sửa `get` (đã sửa ở Task 5) thành:

```js
export async function get({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, created_at
         FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    const remaining = computeRemainingMs(game);
    const { black_guest_token, invite_token_hash, ...publicGame } = game;
    return { ...publicGame, moves, red_time_remaining_ms: remaining.red, black_time_remaining_ms: remaining.black };
  });
}
```

Thêm `claimTimeout` (cuối file):

```js
export async function claimTimeout({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    if (game.disconnected_side) throw INVALID_STATE('Đồng hồ đang tạm dừng do mất kết nối.');
    const remaining = computeRemainingMs(game);
    const timedOutSide = remaining.red <= 0 ? 'r' : remaining.black <= 0 ? 'b' : null;
    if (!timedOutSide) throw INVALID_STATE('Chưa bên nào thật sự hết giờ.');
    const winnerSide = rules.opp(timedOutSide);
    const winnerId = winnerSide === 'r' ? game.red_member_id : game.black_member_id;
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'het-gio', winner_member_id = ?, finished_at = now()
        WHERE id = ? AND status = 'active' RETURNING id`,
      [winnerId, id]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.timeout', targetType: 'game', targetId: id, detail: { side: timedOutSide } });
    return { winnerSide };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'het-gio' });
  return { id, status: 'finished' };
}
```

- [ ] **Step 4: Thêm route**

```js
router.post('/:id/timeout', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.claimTimeout({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Chạy test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api t42-games-rooms`
Expected: toàn bộ PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): tính thời gian còn lại lúc đọc, /timeout server tự xác minh"
```

---

### Task 10: Cầu hoà + Mất kết nối

**Files:**
- Modify: `api/src/modules/games/service.js` — thêm `offerDraw`, `acceptDraw`, `declineDraw`, `markDisconnected`, `clearDisconnected`, sửa `assertVisible`
- Modify: `api/src/modules/games/routes.js` — thêm route + sửa `/:id/stream`

**Interfaces:**
- Produces: `POST /:id/draw/offer|accept|decline`, `POST /:id/disconnect-timeout`. `assertVisible` trả thêm `side` để route `/stream` biết có cần theo dõi mất-kết-nối cho kết nối này không (khán giả `side=null` thì không).

- [ ] **Step 1: Viết test trước**

Thêm vào `api/tests/t42-games-rooms.test.js`:

```js
describe('T42 cầu hoà', () => {
  async function activeGame() {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Cầu Hoà' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    return { id: created.body.id, guestToken: joined.body.guest_token };
  }

  it('cầu hoà rồi bên kia từ chối thì ván chạy tiếp', async () => {
    const { id, guestToken } = await activeGame();
    await supertest(app).post(`/api/v1/games/${id}/draw/offer`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${id}/draw/decline`).set(auth(guestToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('active');
    expect(detail.body.draw_offered_by).toBe(null);
  });

  it('cầu hoà rồi bên kia đồng ý thì ván kết thúc hoà', async () => {
    const { id, guestToken } = await activeGame();
    await supertest(app).post(`/api/v1/games/${id}/draw/offer`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${id}/draw/accept`).set(auth(guestToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.end_reason).toBe('hoa-thoa-thuan');
  });

  it('tự cầu hoà với chính mình (accept lời cầu hoà của mình) thì bị từ chối', async () => {
    const { id } = await activeGame();
    await supertest(app).post(`/api/v1/games/${id}/draw/offer`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${id}/draw/accept`).set(auth(aliceToken)).expect(409);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "cầu hoà"`
Expected: FAIL — 3 route `/draw/*` trả 404

- [ ] **Step 3: Thêm 3 hàm cầu hoà vào `api/src/modules/games/service.js`**

```js
export async function offerDraw({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET draw_offered_by = ? WHERE id = ? AND status = 'active' AND draw_offered_by IS NULL RETURNING id`,
      [mySide, id]
    );
    if (!row) throw INVALID_STATE('Đã có lời cầu hoà đang chờ.');
    const opponentSide = rules.opp(mySide);
    const opponentId = opponentSide === 'r' ? game.red_member_id : game.black_member_id;
    let notification = null;
    if (opponentId && !isWatchingGame(id, opponentId)) {
      const { rows: [n] } = await trx.raw(
        `INSERT INTO notifications (community_id, recipient_id, actor_id, kind, title, body, target_type, target_id)
         VALUES (?, ?, ?, 'game_turn', 'Đối thủ cầu hoà', 'Đối thủ vừa đề nghị hoà ván cờ.', 'game', ?) RETURNING *`,
        [actor.communityId, opponentId, actor.id, id]
      );
      notification = n;
    }
    return { mySide, opponentId, notification };
  });
  publishToGame(id, 'draw_offered', { by: result.mySide });
  if (result.notification) publishToMember(result.opponentId, 'notification', result.notification);
  return { offered: true };
}

export async function acceptDraw({ actor, id }) {
  await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (!game.draw_offered_by || game.draw_offered_by === mySide) {
      throw INVALID_STATE('Không có lời cầu hoà nào để nhận.');
    }
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'hoa-thoa-thuan', finished_at = now()
        WHERE id = ? AND status = 'active' AND draw_offered_by = ? RETURNING id`,
      [id, game.draw_offered_by]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.draw_accepted', targetType: 'game', targetId: id, detail: {} });
  });
  publishToGame(id, 'game_end', { winner: null, reason: 'hoa-thoa-thuan' });
  return { id, status: 'finished' };
}

export async function declineDraw({ actor, id }) {
  await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (!game.draw_offered_by || game.draw_offered_by === mySide) {
      throw INVALID_STATE('Không có lời cầu hoà nào để từ chối.');
    }
    await trx.raw(`UPDATE games SET draw_offered_by = NULL WHERE id = ? AND status = 'active'`, [id]);
  });
  publishToGame(id, 'draw_declined', {});
  return { declined: true };
}
```

- [ ] **Step 4: Thêm route cầu hoà**

```js
router.post('/:id/draw/offer', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.offerDraw({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/draw/accept', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.acceptDraw({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/:id/draw/decline', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.declineDraw({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Chạy test cầu hoà, xác nhận đạt**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "cầu hoà"`
Expected: PASS (3/3)

- [ ] **Step 6: Viết test mất kết nối**

Thêm dòng import sau `import { config } from '../src/config/index.js';` ở đầu `api/tests/t42-games-rooms.test.js` (test dưới đây gọi thẳng `service.markDisconnected`/`clearDisconnected`, xem lý do trong comment của `describe` block):

```js
import * as service from '../src/modules/games/service.js';
```

Thêm vào cuối `api/tests/t42-games-rooms.test.js`:

```js
describe('T42 mất kết nối', () => {
  // Kiểm markDisconnected/clearDisconnected trực tiếp (gọi hàm service, không
  // qua HTTP) — đóng/mở lại một kết nối SSE thật qua supertest không ổn định
  // (supertest/superagent không nghĩ cho luồng sống lâu như SSE), nên phần
  // LOGIC kiểm ở đây, còn phần "route /stream có gọi đúng 2 hàm này lúc
  // req.on('close') và lúc subscribe" xác nhận bằng đọc lại mã ở Step 9 (chỉ
  // 4 dòng nối, không thêm nhánh rẽ nào để có thể sai).
  it('markDisconnected set đúng bên + không ghi đè lần gọi thứ hai; clearDisconnected xoá cờ và dời turn_started_at', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách SSE' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    const gameId = created.body.id;

    await service.markDisconnected({ communityId: cid, gameId, side: 'r' });
    let detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe('r');
    const firstDisconnectedAt = detail.body.disconnected_at;

    await service.markDisconnected({ communityId: cid, gameId, side: 'b' }); // đã có người mất kết nối rồi — không ghi đè
    detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe('r');
    expect(detail.body.disconnected_at).toBe(firstDisconnectedAt);

    await service.clearDisconnected({ communityId: cid, gameId, side: 'r' });
    detail = await supertest(app).get(`/api/v1/games/${gameId}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.disconnected_side).toBe(null);
  });

  it('quá 1 phút mất kết nối thì /disconnect-timeout xử thua đúng bên', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Timeout' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    await db.raw(
      `UPDATE games SET disconnected_side = 'r', disconnected_at = now() - interval '61 seconds' WHERE id = ?`,
      [created.body.id]
    );
    await supertest(app).post(`/api/v1/games/${created.body.id}/disconnect-timeout`).set(auth(joined.body.guest_token)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.end_reason).toBe('mat-ket-noi');
  });

  it('chưa đủ 1 phút thì /disconnect-timeout bị từ chối', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Sớm' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);
    await db.raw(`UPDATE games SET disconnected_side = 'r', disconnected_at = now() WHERE id = ?`, [created.body.id]);
    await supertest(app).post(`/api/v1/games/${created.body.id}/disconnect-timeout`).set(auth(joined.body.guest_token)).expect(409);
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "mất kết nối"`
Expected: FAIL — `disconnected_side` vẫn `null` sau khi đóng kết nối (chưa gắn hook), `/disconnect-timeout` trả 404

- [ ] **Step 8: Thêm `markDisconnected`/`clearDisconnected`, sửa `assertVisible`, thêm `claimDisconnectTimeout` trong `api/src/modules/games/service.js`**

```js
export async function assertVisible({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    return { side: resolveSide(actor, game) };
  });
}

export async function markDisconnected({ communityId, gameId, side }) {
  await withActor(null, async (trx) => {
    await trx.raw(
      `UPDATE games SET disconnected_side = ?, disconnected_at = now()
        WHERE id = ? AND community_id = ? AND status = 'active' AND disconnected_side IS NULL`,
      [side, gameId, communityId]
    );
  });
  publishToGame(gameId, 'disconnected', { side });
}

export async function clearDisconnected({ communityId, gameId, side }) {
  const wasCleared = await withActor(null, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET disconnected_side = NULL, disconnected_at = NULL,
              turn_started_at = CASE WHEN turn = ? THEN now() ELSE turn_started_at END
        WHERE id = ? AND community_id = ? AND status = 'active' AND disconnected_side = ?
        RETURNING id`,
      [side, gameId, communityId, side]
    );
    return !!row;
  });
  if (wasCleared) publishToGame(gameId, 'reconnected', { side });
}

export async function claimDisconnectTimeout({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status !== 'active') throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    if (!game.disconnected_side) throw INVALID_STATE('Không có ai đang mất kết nối.');
    const elapsedMs = Date.now() - new Date(game.disconnected_at).getTime();
    if (elapsedMs < 60_000) throw INVALID_STATE('Chưa đủ 1 phút mất kết nối.');
    const loserSide = game.disconnected_side;
    const winnerSide = rules.opp(loserSide);
    const winnerId = winnerSide === 'r' ? game.red_member_id : game.black_member_id;
    const { rows: [row] } = await trx.raw(
      `UPDATE games SET status = 'finished', end_reason = 'mat-ket-noi', winner_member_id = ?, finished_at = now()
        WHERE id = ? AND status = 'active' AND disconnected_side = ? RETURNING id`,
      [winnerId, id, loserSide]
    );
    if (!row) throw INVALID_STATE('Ván cờ này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.disconnect_timeout', targetType: 'game', targetId: id, detail: { side: loserSide } });
    return { winnerSide };
  });
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'mat-ket-noi' });
  return { id, status: 'finished' };
}
```

- [ ] **Step 9: Sửa route `/:id/stream` + thêm route `/disconnect-timeout` trong `api/src/modules/games/routes.js`**

Thay route `/:id/stream` (đã có từ Task 5) bằng:

```js
router.get('/:id/stream', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  let visible;
  try {
    visible = await service.assertVisible({ actor: req.actor, id: req.params.id });
  } catch (e) { return next(e); }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ game_id: req.params.id })}\n\n`);
  const unsubscribe = subscribeGame(req.params.id, req.actor.id, res);
  const { side } = visible;
  const { communityId } = req.actor;
  if (side) service.clearDisconnected({ communityId, gameId: req.params.id, side }).catch(() => {});
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => {
    clearInterval(keepalive); unsubscribe();
    if (side) service.markDisconnected({ communityId, gameId: req.params.id, side }).catch(() => {});
  });
});
```

Thêm route mới:

```js
router.post('/:id/disconnect-timeout', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.claimDisconnectTimeout({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 10: Chạy toàn bộ test, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api t42-games-rooms`
Expected: toàn bộ PASS.

- [ ] **Step 11: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): cầu hoà + theo dõi mất kết nối qua SSE, xử thua sau 1 phút"
```

---

### Task 11: Rời phòng

**Files:**
- Modify: `api/src/modules/games/service.js` — thêm `leaveRoom`
- Modify: `api/src/modules/games/routes.js`

**Interfaces:**
- Produces: `POST /:id/leave` — chưa vào trận thì xoá phòng; đang đấu thì gọi thẳng `resign()` đã có.

- [ ] **Step 1: Viết test trước**

Thêm vào `api/tests/t42-games-rooms.test.js`:

```js
describe('T42 rời phòng', () => {
  it('chưa vào trận: chủ phòng rời thì phòng bị xoá hẳn', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(aliceToken)).expect(200);
    await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(aliceToken)).expect(404);
  });

  it('đang đấu: rời phòng tính như xin thua, ván vẫn còn (không bị xoá)', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${created.body.invite_token}/join`)
      .send({ guest_name: 'Khách Rời' }).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${created.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);

    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(aliceToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/games/${created.body.id}`).set(auth(joined.body.guest_token)).expect(200);
    expect(detail.body.status).toBe('finished');
    expect(detail.body.end_reason).toBe('resign');
  });

  it('người ngoài (không phải người chơi trong ván) không rời được', async () => {
    const created = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    await supertest(app).post(`/api/v1/games/${created.body.id}/leave`).set(auth(bobToken)).expect(403);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `docker compose exec api npx vitest run t42-games-rooms -t "rời phòng"`
Expected: FAIL — `POST /:id/leave` trả 404

- [ ] **Step 3: Thêm `leaveRoom` vào `api/src/modules/games/service.js`**

```js
export async function leaveRoom({ actor, id }) {
  const game = await withActor(actor.id, (trx) => loadGame(trx, actor.communityId, id));
  const mySide = resolveSide(actor, game);
  if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
  if (game.status === 'active') return resign({ actor, id });
  await withActor(actor.id, async (trx) => {
    await trx.raw(`DELETE FROM game_moves WHERE game_id = ?`, [id]);
    const { rows: [deleted] } = await trx.raw(
      `DELETE FROM games WHERE id = ? AND status = 'pending' RETURNING id`, [id]
    );
    if (!deleted) throw INVALID_STATE('Ván cờ này không còn ở bước chuẩn bị.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.room_closed', targetType: 'game', targetId: id, detail: {} });
  });
  return { id, status: 'deleted' };
}
```

- [ ] **Step 4: Thêm route**

```js
router.post('/:id/leave', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, async (req, res, next) => {
  try { res.json(await service.leaveRoom({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Chạy toàn bộ test cờ tướng, xác nhận đạt**

Run: `docker compose exec api npx vitest run t40-chess-rules t41-games-api t42-games-rooms`
Expected: toàn bộ PASS.

- [ ] **Step 6: Chạy toàn bộ bộ test của `api` một lần cuối — xác nhận không hỏng module nào khác**

Run: `docker compose exec api npm test`
Expected: toàn bộ PASS (mọi file `t*.test.js` trong repo, không riêng cờ tướng).

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/tests/t42-games-rooms.test.js
git commit -m "feat(cotuong): rời phòng — xoá thẳng nếu chưa vào trận, tính thua nếu đang đấu"
```

---

## Sau khi xong plan này

Kernel đã đủ cho **hai người chơi thật đấu trọn ván qua web** (tạo phòng → chia sẻ link → khách vào → cả hai sẵn sàng → đấu với đồng hồ thật, cầu hoà, mất kết nối, rời phòng đều đúng luật) — chạy hoàn toàn không cần Engine. Việc Engine (Pikafish) + "máy đi hộ" là plan riêng tiếp theo (mục 6 spec), phụ thuộc `service.move()` đã ổn định ở đây. Giao diện web là plan sau nữa, theo quyết định đã chốt lúc brainstorm.
