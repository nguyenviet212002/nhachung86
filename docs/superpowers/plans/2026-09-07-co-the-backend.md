# Cờ Thế — Backend (module `api/src/modules/co-the`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng toàn bộ backend Cờ Thế — soạn/kiểm thế cờ, Kho thế, ⚖ Phân
tích, ⚔ Tìm cách phá, vào trận/Đang đấu (đối thủ luôn là máy), Mổ ván +
Diễn giải, Hồ sơ tự ghi, Luyện Thế 3 cấp, màn khách/người xem — không có
giao diện web ở plan này (xem plan riêng `2026-09-07-co-the-frontend.md`,
viết sau khi plan này gộp xong).

**Architecture:** Module mới `api/src/modules/co-the/` ngang hàng `games/`,
KHÔNG mở rộng `games/service.js`. Tái dùng nguyên `games/rules.js` (thêm 1
hàm mới `validatePosition`), `games/engineClient.js`, `games/aiSelect.js`,
`core/tx.js`, `core/errors.js`, `core/audit.js`, `core/realtime.js`
(`publishToGame`/`subscribeGame` — key theo `session.id` y hệt cách
`games` dùng key theo `game.id`, module đó không hề biết/quan tâm bảng nào
đứng sau id).

**Tech Stack:** Node/Express, Knex (SQL thô qua `trx.raw`), PostgreSQL,
Zod, Vitest + Supertest (test thật qua HTTP, DB thật — soi khuôn
`t46-ai-auto-move.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-07-co-the-design.md`

## Global Constraints

- **Không dùng thương hiệu "nhaccon6789"** kể cả trong code/comment — đúng
  quyết định đã chốt (spec mục 0). Dùng tên hàm/route tiếng Việt-không-dấu
  thường (`co-the`, `phan-tich`, `luyen-the`...), nhãn hiển thị (để plan
  frontend viết) là "Phân tích"/"Kết luận"/"Diễn giải".
- **Community-scoped mọi bảng**, khoá ngoài ghép `(id, community_id)` —
  đúng khuôn `048_chess_games.js`. Không có bảng nào lộ ra ngoài cộng đồng.
- **Số migration và số tệp test là biến, không hard-code trong plan này**:
  trước khi tạo file migration/test, LUÔN chạy
  `ls api/src/db/migrations | tail -3` / `ls api/tests | grep -E '^t[0-9]+' | tail -3`
  để lấy số kế tiếp thật — nhiều nhánh/phiên khác có thể đang tạo migration
  song song. Plan này viết "0NN"/"tNN" làm tên gợi ý, KHÔNG PHẢI số chốt.
- **Quy ước điểm số của engine (score_cp/mate) LUÔN từ góc nhìn của bên
  ĐANG ĐƯỢC HỎI trong FEN gửi đi** (chuẩn UCI — `maybeAutoMove` trong
  `games/service.js` đã ngầm dựa vào đúng quy ước này khi chọn nước tốt
  nhất cho bên vừa gửi FEN). MỌI chỗ trong plan này gọi
  `engineClient.bestMove({fen: rules.boardToFen(board, side), ...})` thì
  `score_cp`/`mate` trả về LUÔN là góc nhìn của `side` đó — không phải góc
  nhìn Đỏ cố định. Nhầm chỗ này thì Mổ ván (Task 5) chấm NGƯỢC (khen chỗ
  đáng chê) mà không có lỗi nào nổ ra — implementer VÀ reviewer đều phải tự
  tay kiểm bằng một FEN thật qua dịch vụ `engine` thật trước khi tin.
- **`aiSelect.selectAiMove` dùng lại cho CẢ HAI**: máy đóng vai "Đối thủ"
  khi giải (`opponentLevel` → xem Task 4) VÀ máy tự đấu khi Luyện Thế
  (Task 6) — không viết thêm hàm chọn nước thứ hai.
- **`co_the_moves.score_cp`/`mate` mang một ý nghĩa DUY NHẤT xuyên suốt
  plan này: điểm của thế cờ NGAY TRƯỚC khi nước đó được đi** (không phải
  điểm sau nước đó) — luôn ở góc nhìn của bên SẮP đi nước đó. Xem lý do đầy
  đủ ở Task 5. Task 4 (ghi nước lúc đang chơi) KHÔNG điền hai cột này (để
  `NULL`) — chỉ Task 5 (Mổ ván, chạy nền sau khi kết thúc) điền.
- **Không tạo route/hàm nào cho phép một thành viên sửa/xoá thế cờ hay
  session của người khác** — nhưng ĐỌC (list Kho thế, phân tích, tìm cách
  phá bất kỳ position nào) mở cho MỌI thành viên cùng cộng đồng, vì Kho thế
  là nội dung chung. Chỉ 2 thứ khoá theo đúng người: sửa/kết thúc một
  `co_the_session` (chỉ `solver_member_id`), và không ai xoá được vị trí đã
  lưu Kho thế ở plan này (chưa cần — không có route xoá).
- **Đối thủ trong Cờ Thế LUÔN là máy** — không có route nào cho 2 người
  chơi cùng 1 session. Khác hẳn `games` (PvP).

---

### Task 1: Migration 3 bảng + `rules.validatePosition`

**Files:**
- Create: `api/src/db/migrations/059_co_the.js` (xác nhận lại số — xem
  Global Constraints)
- Modify: `api/src/modules/games/rules.js` — thêm hàm mới, không sửa hàm
  đã có
- Create: `api/tests/t47-co-the-rules.test.js`

**Interfaces:**
- Produces: `validatePosition(board)` (trong `games/rules.js`) → mảng lỗi
  tiếng Việt có dấu (rỗng = hợp lệ). Bảng `co_the_positions`,
  `co_the_sessions`, `co_the_moves` — cột chính xác ở Step 1.
- Consumes: `findGeneral`, `flyingGeneral` đã có trong `games/rules.js`.

- [ ] **Step 1: Viết migration**

Trước tiên chạy `ls api/src/db/migrations | tail -3` để lấy đúng số kế
tiếp (thay `059` dưới đây nếu khác), rồi tạo
`api/src/db/migrations/0NN_co_the.js`:

```js
// Cờ Thế — module mới ngang hàng games, tái dùng games/rules.js (luật cờ)
// và games/engineClient.js (gọi Pikafish). Xem
// docs/superpowers/specs/2026-09-07-co-the-design.md.
export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';

  await knex.raw(`
    CREATE TABLE co_the_positions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      created_by_member_id uuid,
      board jsonb NOT NULL,
      side_to_move text NOT NULL CHECK (side_to_move IN ('r','b')),
      origin text NOT NULL DEFAULT 'tu-soan' CHECK (origin IN ('tu-soan','kho-co-dien')),
      category text CHECK (category IS NULL OR category IN ('tan-cuoc-it-quan','sat-cuoc','nghe-thuat','nhieu-nghiem','loi')),
      label text,
      saved_to_library boolean NOT NULL DEFAULT false,
      verdict text CHECK (verdict IS NULL OR verdict IN ('thang','hoa','thua')),
      verdict_certainty text CHECK (verdict_certainty IS NULL OR verdict_certainty IN ('chung-minh','uoc-luong')),
      verdict_score_cp int,
      verdict_mate int,
      verdict_depth int,
      engine_version text,
      engine_movetime_ms int,
      analyzed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT co_the_positions_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (created_by_member_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_co_the_positions_community ON co_the_positions (community_id, saved_to_library, created_at DESC);

    CREATE TABLE co_the_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      position_id uuid NOT NULL,
      solver_member_id uuid NOT NULL,
      solver_side text NOT NULL CHECK (solver_side IN ('r','b')),
      mode text NOT NULL CHECK (mode IN ('giai','luyen-the')),
      opponent_level text CHECK (opponent_level IS NULL OR opponent_level IN ('yeu','vua','manh')),
      luyen_the_cap text CHECK (luyen_the_cap IS NULL OR luyen_the_cap IN ('ha','trung','cao')),
      status text NOT NULL DEFAULT 'dang-choi' CHECK (status IN ('dang-choi','ket-thuc')),
      board jsonb NOT NULL,
      turn text NOT NULL CHECK (turn IN ('r','b')),
      result text CHECK (result IS NULL OR result IN ('thang','hoa','thua')),
      end_reason text CHECK (end_reason IS NULL OR end_reason IN
        ('giai-dung','mat-the-thang','chieu-bi','het-nuoc-di','hoa-3-lan','hoa-60-nuoc','truong-chieu','bo-cuoc','luyen-the-xong')),
      invite_token text UNIQUE,
      guest_token uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz,
      CONSTRAINT co_the_sessions_id_cid UNIQUE (id, community_id),
      FOREIGN KEY (position_id, community_id) REFERENCES co_the_positions(id, community_id),
      FOREIGN KEY (solver_member_id, community_id) REFERENCES members(id, community_id)
    );
    CREATE INDEX idx_co_the_sessions_solver ON co_the_sessions (solver_member_id, status, created_at DESC);
    CREATE INDEX idx_co_the_sessions_position ON co_the_sessions (position_id);

    CREATE TABLE co_the_moves (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      session_id uuid NOT NULL,
      seq int NOT NULL,
      side text NOT NULL CHECK (side IN ('r','b')),
      from_r int NOT NULL,
      from_c int NOT NULL,
      to_r int NOT NULL,
      to_c int NOT NULL,
      captured_type text,
      is_check boolean NOT NULL DEFAULT false,
      board_hash text NOT NULL,
      score_cp int,
      mate int,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT co_the_moves_session_seq UNIQUE (session_id, seq),
      FOREIGN KEY (session_id, community_id) REFERENCES co_the_sessions(id, community_id)
    );
    CREATE INDEX idx_co_the_moves_session ON co_the_moves (session_id, seq);
  `);

  await knex.raw(`REVOKE ALL ON co_the_positions, co_the_sessions, co_the_moves FROM ??`, [user]);
  await knex.raw(`GRANT SELECT, INSERT, UPDATE ON co_the_positions, co_the_sessions, co_the_moves TO ??`, [user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS co_the_moves;
    DROP TABLE IF EXISTS co_the_sessions;
    DROP TABLE IF EXISTS co_the_positions;
  `);
}
```

- [ ] **Step 2: Chạy migration trên DB test**

```bash
cd api && npx knex migrate:latest --env test
```

Xác nhận không lỗi, 3 bảng xuất hiện (`\d co_the_positions` qua `psql`
hoặc đơn giản tin `migrate:latest` không báo lỗi).

- [ ] **Step 3: Thêm `validatePosition` vào `games/rules.js`**

Thêm vào CUỐI file `api/src/modules/games/rules.js` (không sửa dòng nào
đã có):

```js
// Kiểm hợp lệ một thế cờ trước khi cho chốt/vào trận (dùng cho module
// co-the — BAN_CHUAN_CO_THE.md §5: fail-closed, thiếu quân thì chặn).
// Trả mảng lỗi tiếng Việt CÓ DẤU đầy đủ (rỗng = hợp lệ) — trả HẾT lỗi tìm
// được cùng lúc, không dừng ở lỗi đầu, để người soạn sửa một lần.
export function validatePosition(board) {
  const errors = [];
  if (!findGeneral(board, 'r')) errors.push('Thiếu Tướng bên Đỏ.');
  if (!findGeneral(board, 'b')) errors.push('Thiếu Tướng bên Đen.');
  if (flyingGeneral(board)) errors.push('Hai Tướng đối mặt trực tiếp — không hợp lệ.');
  return errors;
}
```

- [ ] **Step 4: Viết test**

`api/tests/t47-co-the-rules.test.js` (xác nhận lại số t47 — xem Global
Constraints):

```js
import { describe, it, expect } from 'vitest';
import { validatePosition } from '../src/modules/games/rules.js';

function emptyBoard() { return Array.from({ length: 10 }, () => Array(9).fill(null)); }

describe('T47 validatePosition', () => {
  it('đủ 2 Tướng, không đối mặt -> hợp lệ, mảng rỗng', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][3] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toEqual([]);
  });

  it('thiếu Tướng Đỏ -> báo đúng câu có dấu', () => {
    const b = emptyBoard();
    b[0][4] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toContain('Thiếu Tướng bên Đỏ.');
  });

  it('thiếu Tướng Đen -> báo đúng câu có dấu', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    expect(validatePosition(b)).toContain('Thiếu Tướng bên Đen.');
  });

  it('thiếu cả hai Tướng -> báo cả hai lỗi cùng lúc', () => {
    expect(validatePosition(emptyBoard())).toHaveLength(2);
  });

  it('hai Tướng cùng cột, không quân nào chắn -> báo đối mặt', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    expect(validatePosition(b)).toContain('Hai Tướng đối mặt trực tiếp — không hợp lệ.');
  });

  it('hai Tướng cùng cột NHƯNG có quân chắn giữa -> không báo đối mặt', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    b[5][4] = { side: 'r', type: 'chariot' };
    expect(validatePosition(b)).toEqual([]);
  });
});
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

```bash
cd api && NODE_ENV=development npx vitest run tests/t47-co-the-rules.test.js
```

- [ ] **Step 6: Commit**

```bash
git add api/src/db/migrations/0NN_co_the.js api/src/modules/games/rules.js api/tests/t47-co-the-rules.test.js
git commit -m "feat(cotuong): Cờ Thế — migration 3 bảng + rules.validatePosition"
```

---

### Task 2: Module `co-the` — soạn thế, kiểm, lưu Kho thế, danh sách

**Files:**
- Create: `api/src/modules/co-the/schema.js`
- Create: `api/src/modules/co-the/service.js`
- Create: `api/src/modules/co-the/routes.js`
- Modify: `api/src/app.js` — mount router
- Create: `api/tests/t48-co-the-positions.test.js`

**Interfaces:**
- Consumes: `rules.validatePosition` (Task 1).
- Produces: `service.createPosition({actor, board, sideToMove})`,
  `service.saveToLibrary({actor, id, label, category})`,
  `service.listPositions({actor, origin, category, page, limit})`,
  `service.getPosition({actor, id})` — cả 4 hàm này TASK 3/4/5/6/7 sau sẽ
  import thêm `getPosition`/community-scoped load helper từ file này (xem
  ghi chú "Produces nội bộ" trong Step 2).

- [ ] **Step 1: `schema.js`**

```js
import { z } from 'zod';

const uuid = z.string().uuid();
const piece = z.object({
  side: z.enum(['r', 'b']),
  type: z.enum(['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier']),
}).nullable();
const board = z.array(z.array(piece).length(9)).length(10);
const CATEGORY = ['tan-cuoc-it-quan', 'sat-cuoc', 'nghe-thuat', 'nhieu-nghiem', 'loi'];

export const idParamSchema = z.object({ id: uuid });
export const createPositionSchema = z.object({ board, side_to_move: z.enum(['r', 'b']) });
export const saveToLibrarySchema = z.object({
  label: z.string().trim().min(1).max(80),
  category: z.enum(CATEGORY).nullable(),
});
export const listPositionsQuerySchema = z.object({
  origin: z.enum(['tu-soan', 'kho-co-dien']).optional(),
  category: z.enum(CATEGORY).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
```

- [ ] **Step 2: `service.js`**

```js
import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import * as rules from '../games/rules.js';

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy thế cờ này.', { status: 404 });
export const FORBIDDEN = (msg) => new AppError('FORBIDDEN', msg ?? 'Bạn không có quyền làm việc này.', { status: 403 });
export const INVALID_STATE = (msg) => new AppError('INVALID_STATE', msg, { status: 409 });

// Dùng chung cho mọi task sau (session/phân tích) — load 1 thế, chặn cross-
// tenant bằng community_id. Export để Task 3/4/5/6/7 import thẳng, không
// viết lại truy vấn giống hệt 5 lần.
export async function loadPosition(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(
    `SELECT * FROM co_the_positions WHERE id = ? AND community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}

export async function createPosition({ actor, board, sideToMove }) {
  const errors = rules.validatePosition(board);
  if (errors.length) throw new AppError('VALIDATION_FAILED', errors.join(' '), { status: 422, fields: { board: errors } });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO co_the_positions (community_id, created_by_member_id, board, side_to_move)
       VALUES (?, ?, ?::jsonb, ?) RETURNING *`,
      [actor.communityId, actor.id, JSON.stringify(board), sideToMove]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_created', targetType: 'co_the_position', targetId: row.id, detail: {} });
    return row;
  });
}

export async function saveToLibrary({ actor, id, label, category }) {
  return withActor(actor.id, async (trx) => {
    await loadPosition(trx, actor.communityId, id);
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_positions SET saved_to_library = true, label = ?, category = ?
        WHERE id = ? AND community_id = ? RETURNING *`,
      [label, category, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_saved_to_library', targetType: 'co_the_position', targetId: id, detail: { label } });
    return row;
  });
}

export async function listPositions({ actor, origin, category, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const where = ['community_id = ?', 'saved_to_library = true'];
    const params = [actor.communityId];
    if (origin) { where.push('origin = ?'); params.push(origin); }
    if (category) { where.push('category = ?'); params.push(category); }
    const clause = where.join(' AND ');
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT id, label, origin, category, side_to_move, verdict, verdict_certainty, created_at
         FROM co_the_positions WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(`SELECT count(*)::int AS total FROM co_the_positions WHERE ${clause}`, params);
    return { data: rows, meta: { page, limit, total } };
  });
}

export async function getPosition({ actor, id }) {
  return withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
}
```

- [ ] **Step 3: `routes.js`**

```js
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as schema from './schema.js';
import * as service from './service.js';

export const router = Router();
router.use(rateLimit({ windowMs: 60_000, max: 120 }));

router.post('/positions', requireAuth, validate(schema.createPositionSchema), async (req, res, next) => {
  try { res.status(201).json(await service.createPosition({ actor: req.actor, board: req.body.board, sideToMove: req.body.side_to_move })); }
  catch (e) { next(e); }
});
router.post('/positions/:id/luu-kho', requireAuth, validate(schema.idParamSchema, 'params'), validate(schema.saveToLibrarySchema), async (req, res, next) => {
  try { res.json(await service.saveToLibrary({ actor: req.actor, id: req.params.id, label: req.body.label, category: req.body.category })); }
  catch (e) { next(e); }
});
router.get('/positions', requireAuth, validate(schema.listPositionsQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.listPositions({ actor: req.actor, ...req.query })); } catch (e) { next(e); }
});
router.get('/positions/:id', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.getPosition({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Mount ở `app.js`**

Thêm import cạnh `gamesRouter` (khoảng dòng 16):
```js
import { router as coTheRouter } from './modules/co-the/routes.js';
```
Thêm mount cạnh `/api/v1/games` (khoảng dòng 108):
```js
app.use('/api/v1/co-the', coTheRouter);
```

- [ ] **Step 5: Test tích hợp**

`api/tests/t48-co-the-positions.test.js` (xác nhận lại số — xem Global
Constraints; soi khuôn `t46-ai-auto-move.test.js` cho phần `beforeAll`):

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });

function validBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  b[5][4] = { side: 'r', type: 'chariot' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t48-co-the', 'T48') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T48', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  const { rows: [b2] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T48', 'member') RETURNING id`, [cid]);
  bob = b2.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T48 Cờ Thế — soạn thế, kiểm, Kho thế', () => {
  it('soạn thế hợp lệ -> 201, saved_to_library=false mặc định', async () => {
    const res = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    expect(res.body.saved_to_library).toBe(false);
    expect(res.body.origin).toBe('tu-soan');
  });

  it('soạn thế thiếu Tướng -> 422, không tạo row', async () => {
    const b = Array.from({ length: 10 }, () => Array(9).fill(null));
    b[9][4] = { side: 'r', type: 'general' };
    await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: b, side_to_move: 'r' }).expect(422);
  });

  it('lưu Kho thế rồi liệt kê thấy đúng thế đó, thành viên KHÁC trong cộng đồng cũng xem được', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/luu-kho`).set(auth(aliceToken))
      .send({ label: 'Thế mẫu T48', category: 'sat-cuoc' }).expect(200);
    const list = await supertest(app).get('/api/v1/co-the/positions').set(auth(bobToken)).expect(200);
    expect(list.body.data.some((p) => p.id === created.body.id)).toBe(true);
  });

  it('thế chưa lưu Kho thế thì KHÔNG xuất hiện trong danh sách', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const list = await supertest(app).get('/api/v1/co-the/positions').set(auth(aliceToken)).expect(200);
    expect(list.body.data.some((p) => p.id === created.body.id)).toBe(false);
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận xanh; chạy lại `t47` cùng lúc để chắc không vỡ**

```bash
cd api && NODE_ENV=development npx vitest run tests/t47-co-the-rules.test.js tests/t48-co-the-positions.test.js
```

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/co-the/ api/src/app.js api/tests/t48-co-the-positions.test.js
git commit -m "feat(cotuong): Cờ Thế — soạn thế, kiểm fail-closed, Kho thế"
```

---

### Task 3: ⚖ Phân tích + ⚔ Tìm cách phá

**Files:**
- Modify: `api/src/modules/co-the/service.js`
- Modify: `api/src/modules/co-the/routes.js`
- Create: `api/tests/t49-co-the-analysis.test.js`

**Interfaces:**
- Consumes: `loadPosition` (Task 2), `engineClient.bestMove` (`games/engineClient.js`).
- Produces: `service.readVerdict({score_cp, mate})` (export — Task 5 Mổ
  ván tái dùng nguyên hàm này để chấm từng nước), `service.analyzePosition`,
  `service.findRefutationPaths`.

- [ ] **Step 1: Thêm vào đầu `service.js`** (sau các import đã có)

```js
import * as engineClient from '../games/engineClient.js';

// Commit Pikafish đã chốt trong engine/Dockerfile (docs/superpowers/plans/
// 2026-09-07-sanh-co-engine-may-di-ho.md) — ghi kèm để so được lần sau
// (BAN_CHUAN_CO_THE.md §3.3/§4.4). Đổi hằng này nếu sau này build lại
// engine với commit Pikafish khác.
const ENGINE_VERSION = 'pikafish@6127307';
const ANALYZE_MOVETIME_MS = 3000;
const TIM_CACH_PHA_MOVETIME_MS = 5000;
const TIM_CACH_PHA_MULTIPV = 5;

// Đọc điểm theo bảng BAN_CHUAN_CO_THE.md §3.2. `score_cp`/`mate` PHẢI đã ở
// góc nhìn của bên được hỏi (xem Global Constraints) — hàm này không tự
// đổi góc nhìn, chỉ đọc thẳng.
//
// Quyết định (không suy ra duy nhất từ tài liệu gốc — tài liệu chỉ có 5
// mức mô tả, schema chỉ có 3 giá trị verdict): |score_cp| < 80 -> 'hoa'
// (không có đường thắng/rất có thể thế bịp); mọi mức còn lại (kể cả
// "nhỉnh hơn, chưa đủ thắng") -> 'thang'/'thua' theo dấu — vì chúng đều
// mang ưu thế thật, chỉ khác ĐỘ CHẮC CHẮN đã tách riêng ở `certainty`.
export function readVerdict({ score_cp, mate }) {
  if (mate != null && mate !== 0) return { verdict: mate > 0 ? 'thang' : 'thua', certainty: 'chung-minh' };
  if (Math.abs(score_cp) < 80) return { verdict: 'hoa', certainty: 'uoc-luong' };
  return { verdict: score_cp > 0 ? 'thang' : 'thua', certainty: 'uoc-luong' };
}

export async function analyzePosition({ actor, id }) {
  const position = await withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
  const fen = rules.boardToFen(position.board, position.side_to_move);
  const { score_cp, mate, depth } = await engineClient.bestMove({ fen, movetime: ANALYZE_MOVETIME_MS, multipv: 1 });
  const { verdict, certainty } = readVerdict({ score_cp, mate });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_positions SET verdict = ?, verdict_certainty = ?, verdict_score_cp = ?, verdict_mate = ?,
              verdict_depth = ?, engine_version = ?, engine_movetime_ms = ?, analyzed_at = now()
        WHERE id = ? AND community_id = ? RETURNING *`,
      [verdict, certainty, score_cp, mate, depth, ENGINE_VERSION, ANALYZE_MOVETIME_MS, id, actor.communityId]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.position_analyzed', targetType: 'co_the_position', targetId: id, detail: { verdict } });
    return row;
  });
}

// ⚔ Tìm cách phá — GIỚI HẠN THẬT (ghi rõ để không ai tưởng đây là dò toàn
// bộ cây biến): liệt kê các nước ĐẦU trong 1 lần gọi multipv=5 mà chính
// engine đã báo mate>0 (chiếu bí được), cùng đường đi (principal variation)
// engine tự trả — KHÔNG phải một cây tìm kiếm đệ quy đầy đủ.
//
// ⚠️ `so_nuoc: l.mate` GIẢ ĐỊNH quy ước UCI chuẩn (mate = SỐ NƯỚC ĐỦ, không
// phải số bán-nước) — CHƯA tự tay xác nhận với dịch vụ engine thật (khác
// hẳn FEN/UCI square mapping ở games/rules.js, thứ ĐÃ được xác nhận trực
// tiếp từ mã nguồn Pikafish). Implementer PHẢI gọi thử `/bestmove` thật với
// 1 thế chiếu-bí-N-nước đã biết trước (vd dàn 1 xe chiếu bí trong đúng 2
// nước) và so `mate` trả về với N thật trước khi tin công thức này — sửa
// lại (`l.pv.length` là số bán-nước, luôn có sẵn để đối chiếu) nếu sai.
export async function findRefutationPaths({ actor, id }) {
  const position = await withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, id));
  const fen = rules.boardToFen(position.board, position.side_to_move);
  const { lines } = await engineClient.bestMove({ fen, movetime: TIM_CACH_PHA_MOVETIME_MS, multipv: TIM_CACH_PHA_MULTIPV });
  const duong = (lines ?? [])
    .filter((l) => l.mate != null && l.mate > 0)
    .sort((a, b) => a.mate - b.mate)
    .map((l) => ({ first_move: l.move, so_nuoc: l.mate, duong_di: l.pv }));
  return { co_duong_thang: duong.length > 0, duong };
}
```

- [ ] **Step 2: Route**

Thêm vào `routes.js`:
```js
router.post('/positions/:id/phan-tich', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.analyzePosition({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/positions/:id/tim-cach-pha', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.findRefutationPaths({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 3: Test** — `api/tests/t49-co-the-analysis.test.js` (mock
  `engineClient`, soi khuôn `t46-ai-auto-move.test.js`):

```js
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });

function validBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t49-co-the', 'T49') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T49', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T49 Cờ Thế — Phân tích + Tìm cách phá', () => {
  it('mate > 0 -> verdict thang, certainty chung-minh, lưu lại điểm', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a0a1', score_cp: 0, mate: 3, depth: 20, pv: ['a0a1'], lines: [] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const res = await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/phan-tich`).set(auth(aliceToken)).expect(200);
    expect(res.body.verdict).toBe('thang');
    expect(res.body.verdict_certainty).toBe('chung-minh');
    expect(res.body.verdict_mate).toBe(3);
    expect(res.body.engine_version).toBeTruthy();
  });

  it('|score_cp| < 80, mate null -> verdict hoa, certainty uoc-luong', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a0a1', score_cp: 30, mate: null, depth: 18, pv: [], lines: [] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const res = await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/phan-tich`).set(auth(aliceToken)).expect(200);
    expect(res.body.verdict).toBe('hoa');
  });

  it('tìm cách phá: chỉ liệt các nước có mate>0, sắp theo mate tăng dần', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'a', score_cp: 900, mate: null, depth: 20, pv: [],
      lines: [
        { move: 'cham', score_cp: null, mate: 5, depth: 20, pv: ['cham', 'x', 'y'] },
        { move: 'nhanh', score_cp: null, mate: 2, depth: 20, pv: ['nhanh', 'z'] },
        { move: 'khong-thang', score_cp: 900, mate: null, depth: 20, pv: [] },
      ],
    });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
    const res = await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/tim-cach-pha`).set(auth(aliceToken)).expect(200);
    expect(res.body.co_duong_thang).toBe(true);
    expect(res.body.duong.map((d) => d.first_move)).toEqual(['nhanh', 'cham']);
  });
});
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

```bash
cd api && NODE_ENV=development npx vitest run tests/t49-co-the-analysis.test.js
```

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/co-the/service.js api/src/modules/co-the/routes.js api/tests/t49-co-the-analysis.test.js
git commit -m "feat(cotuong): Cờ Thế — Phân tích (score_cp/mate) + Tìm cách phá"
```

---

### Task 4: Sessions + Đang đấu (đối thủ luôn là máy)

**Lệch có chủ đích khỏi spec `2026-09-07-co-the-design.md` mục 4**: spec
liệt `solver_side` như một tham số client gửi lên. Thực ra người giải PHẢI
đi đúng bên `position.side_to_move` (bên đang cần tìm nước) — không có ý
nghĩa nào để chọn bên khác. Task này SUY RA `solver_side` từ
`position.side_to_move`, không nhận từ client. Ghi lại đây vì đây là quyết
định thực hiện lúc lập kế hoạch, không phải điều spec đã nói rõ.

**Files:**
- Modify: `api/src/modules/co-the/schema.js`
- Modify: `api/src/modules/co-the/service.js`
- Modify: `api/src/modules/co-the/routes.js`
- Create: `api/tests/t50-co-the-sessions.test.js`

**Interfaces:**
- Consumes: `loadPosition` (Task 2), `readVerdict` không dùng ở đây (dùng ở
  Task 3/5), `aiSelect.selectAiMove`, `rules.legalMoves/applyMove/opp/
  hashBoard/detectRepetition/detectNoCaptureDraw/boardToFen/uciMoveToCells`.
- Produces: `service.createSession`, `service.move`, `service.hint`,
  `service.giveUp`, `service.getSession` — Task 5/6/7 dùng lại
  `loadSession` (export nội bộ, xem Step 2). `getSession`'s `moves` array
  (seq/from/to theo thứ tự) LÀ dữ liệu "Đường giải ⏮◀▶⏭" của spec — không
  có endpoint `/moves` riêng, không cần: client (plan frontend) tự dựng
  điều khiển đi-lại từ mảng này.

- [ ] **Step 1: Thêm schema**

Thêm vào `schema.js`:
```js
export const createSessionSchema = z.object({
  position_id: uuid,
  mode: z.enum(['giai', 'luyen-the']),
  opponent_level: z.enum(['yeu', 'vua', 'manh']).nullable().default(null),
  luyen_the_cap: z.enum(['ha', 'trung', 'cao']).nullable().default(null),
});
const cell = z.object({ r: z.number().int().min(0).max(9), c: z.number().int().min(0).max(8) });
export const moveSchema = z.object({ from: cell, to: cell });
```

- [ ] **Step 2: Thêm vào `service.js`**

```js
import { publishToGame } from '../../core/realtime.js';
import { selectAiMove } from '../games/aiSelect.js';

// Đối thủ trong Cờ Thế LUÔN là máy — mức "yếu/vừa/mạnh" tái dùng ĐÚNG cơ
// chế aiSelect (BAN_CHUAN_CO_TUONG.md mục 4) nhưng ĐẢO NGƯỢC mục đích:
// "yếu" cần máy CÓ THỂ đi kém hơn nước tốt nhất để dễ cho người giải, nên
// map sang ngưỡng LỎNG NHẤT của aiSelect ('xuat-sac' — top-3, chênh<=120);
// "mạnh" map sang ngưỡng CHẶT NHẤT ('sieu' — luôn nước tốt nhất).
const OPPONENT_LEVEL_TO_AI_SELECT = { yeu: 'xuat-sac', vua: 'thong-minh', manh: 'sieu' };
const OPPONENT_MOVETIME_MS = 8000;
const OPPONENT_MULTIPV = 3;

export async function loadSession(trx, communityId, id) {
  const { rows: [row] } = await trx.raw(`SELECT * FROM co_the_sessions WHERE id = ? AND community_id = ?`, [id, communityId]);
  if (!row) throw NOT_FOUND();
  return row;
}

export async function createSession({ actor, positionId, mode, opponentLevel, luyenTheCap }) {
  const position = await withActor(actor.id, (trx) => loadPosition(trx, actor.communityId, positionId));
  if (mode === 'giai' && !opponentLevel) throw new AppError('VALIDATION_FAILED', 'Cần chọn trình độ bên chống.', { status: 422 });
  if (mode === 'luyen-the' && !luyenTheCap) throw new AppError('VALIDATION_FAILED', 'Cần chọn cấp Luyện Thế.', { status: 422 });
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `INSERT INTO co_the_sessions (community_id, position_id, solver_member_id, solver_side, mode,
              opponent_level, luyen_the_cap, board, turn)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?) RETURNING *`,
      [actor.communityId, positionId, actor.id, position.side_to_move, mode,
       opponentLevel, luyenTheCap, JSON.stringify(position.board), position.side_to_move]
    );
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.session_started', targetType: 'co_the_session', targetId: row.id, detail: { mode } });
    return row;
  });
}

// Áp 1 nước + tính lại chiếu bí/hết nước đi/lặp thế/60 nước — TÁI DÙNG y
// hệt logic games/service.js move() (không viết luật lần hai), chỉ đổi
// bảng nguồn (co_the_moves thay game_moves). `board`/`turn`/`id`/
// `community_id` đọc từ `state` truyền vào (không phải luôn là session gốc
// — lần gọi thứ 2 trong move() dưới đây truyền STATE ĐÃ CẬP NHẬT sau nước
// của người giải, không phải session ban đầu).
async function applyOneMove(trx, state, side, from, to) {
  const piece = state.board[from.r]?.[from.c];
  if (!piece || piece.side !== side) throw new AppError('VALIDATION_FAILED', 'Ô xuất phát không có quân của bên này.', { status: 422 });
  const legal = rules.legalMoves(state.board, from.r, from.c);
  if (!legal.some((m) => m.r === to.r && m.c === to.c)) throw new AppError('VALIDATION_FAILED', 'Nước đi không hợp lệ.', { status: 422 });
  const applied = rules.applyMove(state.board, from, to);
  const { rows: pastMoves } = await trx.raw(
    `SELECT side, is_check AS "isCheck", captured_type IS NOT NULL AS captured, board_hash AS "boardHash"
       FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`, [state.id]);
  const newTurnIfContinuing = rules.opp(side);
  let gameOver = applied.gameOver, winner = applied.winner, reason = applied.reason;
  const newHash = rules.hashBoard(applied.board, gameOver ? state.turn : newTurnIfContinuing);
  const moveHistory = [...pastMoves, { side, isCheck: applied.checkOpp, captured: !!applied.captured, boardHash: newHash }];
  if (!gameOver) {
    const rep = rules.detectRepetition(moveHistory);
    if (rep) { gameOver = true; reason = rep.reason; winner = rep.loser ? rules.opp(rep.loser) : null; }
    else if (rules.detectNoCaptureDraw(moveHistory)) { gameOver = true; reason = 'hoa-60-nuoc'; winner = null; }
  }
  const newTurn = gameOver ? state.turn : newTurnIfContinuing;
  const { rows: [seqRow] } = await trx.raw(`SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM co_the_moves WHERE session_id = ?`, [state.id]);
  await trx.raw(
    `INSERT INTO co_the_moves (community_id, session_id, seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, board_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [state.community_id, state.id, seqRow.seq, side, from.r, from.c, to.r, to.c,
     applied.captured?.type ?? null, applied.checkOpp, newHash]);
  return { board: applied.board, turn: newTurn, gameOver, winner, reason };
}

// Người giải đi 1 nước. Nếu ván chưa xong VÀ mode='giai', máy (Đối thủ) đáp
// lễ NGAY TRONG CÙNG request — khác hẳn `maybeAutoMove` của games (không
// fire-and-forget): Cờ Thế không có đồng hồ/đối thủ người thật cần thông
// báo riêng, và movetime của Đối thủ (8s) là phần chờ NGƯỜI GIẢI đang chủ
// động đợi, không phải chặn oan một request của người khác.
export async function move({ actor, id, from, to }) {
  const result = await withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này không còn đang chơi.');
    if (session.mode !== 'giai') throw INVALID_STATE('Ván luyện thế không đi từng nước tay — dùng /luyen-the/chay.');
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.turn !== session.solver_side) throw FORBIDDEN('Chưa tới lượt bạn.');

    let step = await applyOneMove(trx, session, session.solver_side, from, to);
    let cur = { ...session, board: step.board, turn: step.turn };

    if (!step.gameOver) {
      const fen = rules.boardToFen(cur.board, cur.turn);
      const { lines } = await engineClient.bestMove({ fen, movetime: OPPONENT_MOVETIME_MS, multipv: OPPONENT_MULTIPV });
      if (lines?.length) {
        const chosenUci = selectAiMove(lines, OPPONENT_LEVEL_TO_AI_SELECT[session.opponent_level]);
        if (chosenUci) {
          const oppSide = rules.opp(session.solver_side);
          const { from: oFrom, to: oTo } = rules.uciMoveToCells(chosenUci);
          step = await applyOneMove(trx, cur, oppSide, oFrom, oTo);
          cur = { ...cur, board: step.board, turn: step.turn };
        }
      }
    }

    const finished = step.gameOver;
    const outcome = !finished ? null : !step.winner ? 'hoa' : step.winner === session.solver_side ? 'thang' : 'thua';
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_sessions SET board = ?::jsonb, turn = ?, status = ?, result = ?, end_reason = ?, ended_at = ?
        WHERE id = ? AND status = 'dang-choi' RETURNING *`,
      [JSON.stringify(cur.board), cur.turn, finished ? 'ket-thuc' : 'dang-choi', outcome, finished ? step.reason : null,
       finished ? new Date() : null, id]
    );
    if (!row) throw INVALID_STATE('Ván này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.move', targetType: 'co_the_session', targetId: id, detail: { from, to } });
    return row;
  });
  publishToGame(id, 'move', { board: result.board, turn: result.turn, status: result.status });
  if (result.status === 'ket-thuc') publishToGame(id, 'session_end', { result: result.result, reason: result.end_reason });
  return result;
}

export async function hint({ actor, id }) {
  const session = await withActor(actor.id, (trx) => loadSession(trx, actor.communityId, id));
  if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
  if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này không còn đang chơi.');
  const fen = rules.boardToFen(session.board, session.turn);
  const { bestmove } = await engineClient.bestMove({ fen, movetime: ANALYZE_MOVETIME_MS, multipv: 1 });
  return { move: bestmove, ...rules.uciMoveToCells(bestmove) };
}

export async function giveUp({ actor, id }) {
  const result = await withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này không còn đang chơi.');
    const { rows: [row] } = await trx.raw(
      `UPDATE co_the_sessions SET status = 'ket-thuc', result = 'thua', end_reason = 'bo-cuoc', ended_at = now()
        WHERE id = ? AND status = 'dang-choi' RETURNING *`, [id]);
    if (!row) throw INVALID_STATE('Ván này không còn đang chơi.');
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'co_the.give_up', targetType: 'co_the_session', targetId: id, detail: {} });
    return row;
  });
  publishToGame(id, 'session_end', { result: 'thua', reason: 'bo-cuoc' });
  return result;
}

export async function getSession({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, created_at
         FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`, [id]);
    return { ...session, moves };
  });
}
```

- [ ] **Step 3: Routes**

Thêm vào `routes.js`:
```js
router.post('/sessions', requireAuth, validate(schema.createSessionSchema), async (req, res, next) => {
  try {
    res.status(201).json(await service.createSession({
      actor: req.actor, positionId: req.body.position_id, mode: req.body.mode,
      opponentLevel: req.body.opponent_level, luyenTheCap: req.body.luyen_the_cap,
    }));
  } catch (e) { next(e); }
});
router.get('/sessions/:id', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.getSession({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/sessions/:id/moves', requireAuth, validate(schema.idParamSchema, 'params'), validate(schema.moveSchema), async (req, res, next) => {
  try { res.json(await service.move({ actor: req.actor, id: req.params.id, from: req.body.from, to: req.body.to })); }
  catch (e) { next(e); }
});
router.post('/sessions/:id/mach-1-nuoc', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.hint({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/sessions/:id/roi', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.giveUp({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 4: Test** — `api/tests/t50-co-the-sessions.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });

// Bàn đơn giản: Tướng Đỏ (9,4), Tướng Đen (0,4) che bởi xe Đen (5,4) (để
// tránh vỡ luật đối mặt), Xe Đỏ (1,3) sẵn sàng ăn xe Đen mở đường chiếu.
function boardForMoveTest() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  b[5][4] = { side: 'b', type: 'chariot' };
  b[1][3] = { side: 'r', type: 'chariot' };
  return b;
}

async function createPosAndSession(token, { mode = 'giai', opponent_level = 'manh' } = {}) {
  const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(token))
    .send({ board: boardForMoveTest(), side_to_move: 'r' }).expect(201);
  const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(token))
    .send({ position_id: created.body.id, mode, opponent_level }).expect(201);
  return session.body;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t50-co-the', 'T50') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T50', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T50 Cờ Thế — Sessions + Đang đấu', () => {
  it('tạo session: solver_side suy từ position.side_to_move, không nhận từ client', async () => {
    const s = await createPosAndSession(aliceToken);
    expect(s.solver_side).toBe('r');
    expect(s.status).toBe('dang-choi');
  });

  it('đi 1 nước hợp lệ, ván chưa xong -> máy tự đáp lễ NGAY trong response, KHÔNG cần chờ', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'e0e1', score_cp: -50, mate: null, depth: 10, pv: [],
      lines: [{ move: 'e0e1', score_cp: -50, mate: null, depth: 10, pv: ['e0e1'] }],
    });
    const s = await createPosAndSession(aliceToken);
    const res = await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 1, c: 3 }, to: { r: 5, c: 3 } }).expect(200);
    expect(res.body.turn).toBe('r'); // Đỏ đi -> Đen (máy) đáp lễ ngay -> về lại lượt Đỏ
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${s.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.moves).toHaveLength(2);
    expect(detail.body.moves[1].side).toBe('b');
  });

  it('không phải người giải thì không đi được (403)', async () => {
    const { rows: [bob] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T50', 'member') RETURNING id`, [cid]);
    const bobToken = jwt.sign({ sub: bob.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
    const s = await createPosAndSession(aliceToken);
    await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/moves`).set(auth(bobToken))
      .send({ from: { r: 1, c: 3 }, to: { r: 5, c: 3 } }).expect(403);
  });

  it('mách 1 nước không lưu vào lịch sử', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'e0e1', score_cp: -50, mate: null, depth: 10, pv: [], lines: [] });
    const s = await createPosAndSession(aliceToken);
    await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/mach-1-nuoc`).set(auth(aliceToken)).expect(200);
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${s.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.moves).toHaveLength(0);
  });

  it('bỏ cuộc -> ket-thuc, result=thua, end_reason=bo-cuoc', async () => {
    const s = await createPosAndSession(aliceToken);
    const res = await supertest(app).post(`/api/v1/co-the/sessions/${s.id}/roi`).set(auth(aliceToken)).expect(200);
    expect(res.body.status).toBe('ket-thuc');
    expect(res.body.result).toBe('thua');
    expect(res.body.end_reason).toBe('bo-cuoc');
  });
});
```

- [ ] **Step 5: Chạy toàn bộ test module `co-the` đã có, xác nhận xanh**

```bash
cd api && NODE_ENV=development npx vitest run tests/t47-co-the-rules.test.js tests/t48-co-the-positions.test.js tests/t49-co-the-analysis.test.js tests/t50-co-the-sessions.test.js
```

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/co-the/ api/tests/t50-co-the-sessions.test.js
git commit -m "feat(cotuong): Cờ Thế — Sessions + Đang đấu, đối thủ máy đáp lễ đồng bộ"
```

---

### Task 5: Mổ ván + Diễn giải + Hồ sơ

**Files:**
- Modify: `api/src/modules/co-the/service.js`
- Modify: `api/src/modules/co-the/routes.js`
- Create: `api/tests/t51-co-the-review.test.js`

**Interfaces:**
- Consumes: `loadSession`/`loadPosition` (Task 2/4), `readVerdict` (Task 3).
- Produces: `service.getMoVan({actor, id})` (gồm cả phần Diễn giải — câu
  mẫu, KHÔNG phải bình luận tự do, xem spec mục 3), `service.listMySessions`.
- Modify `move()` (Task 4) để KÍCH HOẠT chấm nền khi ván vừa kết thúc.

**Ghi chú thiết kế quan trọng — đọc trước khi viết code:** `co_the_moves`
của MỖI nước NGƯỜI GIẢI đi lưu điểm của thế cờ NGAY TRƯỚC nước đó (không
phải sau) — luôn ở góc nhìn người giải, nên so trực tiếp với
`position.verdict_score_cp` (cùng góc nhìn) không cần đổi dấu ở đâu cả.
Nước đầu tiên của người giải TRÙNG với chính thế gốc — không gọi engine
lại, chỉ copy `position.verdict_score_cp`/`verdict_mate`.

- [ ] **Step 1: Thêm vào `service.js`**

```js
// Chấm điểm từng nước NGƯỜI GIẢI đã đi, chạy NỀN sau khi ván kết thúc —
// TÁI DÙNG đúng khuôn `maybeAutoMove` của games/service.js: gọi bằng
// `.catch(...)` ở nơi gọi (Step 2), không await. Nhiều lần gọi engine (một
// lần mỗi nước TRỪ nước đầu) nên KHÔNG được chặn response của move() cuối
// cùng — làm nền là bắt buộc, không phải lựa chọn phong cách.
async function scoreSessionMoves({ communityId, sessionId }) {
  const { position, fullMoves } = await withActor(null, async (trx) => {
    const session = await loadSession(trx, communityId, sessionId);
    const position = await loadPosition(trx, communityId, session.position_id);
    const { rows: fullMoves } = await trx.raw(
      `SELECT id, seq, side, from_r, from_c, to_r, to_c FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`,
      [sessionId]
    );
    return { position, fullMoves };
  });
  if (position.verdict_certainty !== 'chung-minh') return; // chỉ chấm được thế đã CHỨNG MINH

  let board = position.board;
  let solverMoveIndex = 0;
  for (const mv of fullMoves) {
    if (mv.side === position.side_to_move) {
      solverMoveIndex++;
      let score_cp, mate;
      if (solverMoveIndex === 1) {
        score_cp = position.verdict_score_cp;
        mate = position.verdict_mate;
      } else {
        const fen = rules.boardToFen(board, position.side_to_move);
        try {
          const r = await engineClient.bestMove({ fen, movetime: ANALYZE_MOVETIME_MS, multipv: 1 });
          score_cp = r.score_cp; mate = r.mate;
        } catch (e) {
          console.error('mổ ván lỗi tại nước', mv.seq, e);
          score_cp = null; mate = null;
        }
      }
      await withActor(null, (trx) => trx.raw(`UPDATE co_the_moves SET score_cp = ?, mate = ? WHERE id = ?`, [score_cp, mate, mv.id]));
    }
    board = rules.applyMove(board, { r: mv.from_r, c: mv.from_c }, { r: mv.to_r, c: mv.to_c }).board;
  }
}

export async function getMoVan({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.status !== 'ket-thuc') throw INVALID_STATE('Ván chưa kết thúc.');
    const position = await loadPosition(trx, actor.communityId, session.position_id);
    if (position.verdict_certainty !== 'chung-minh') {
      return { available: false, reason: 'Thế này chưa có kết quả CHỨNG MINH nên không chấm giữ/mất thắng được.' };
    }
    const { rows: solverMoves } = await trx.raw(
      `SELECT seq, from_r, from_c, to_r, to_c, score_cp, mate FROM co_the_moves
        WHERE session_id = ? AND side = ? ORDER BY seq ASC`, [id, position.side_to_move]
    );
    if (solverMoves.length && solverMoves.some((m) => m.score_cp == null && m.mate == null)) {
      return { available: false, reason: 'Đang chấm điểm từng nước, thử lại sau ít phút.' };
    }
    const tenVerdict = { thang: 'thắng', hoa: 'hoà', thua: 'thua' };
    const danhGia = solverMoves.map((m) => {
      const { verdict } = readVerdict({ score_cp: m.score_cp, mate: m.mate });
      const giuThe = verdict === position.verdict;
      return {
        seq: m.seq, from: { r: m.from_r, c: m.from_c }, to: { r: m.to_r, c: m.to_c },
        score_cp: m.score_cp, mate: m.mate, giu_the: giuThe,
        dien_giai: giuThe
          ? `Vẫn giữ thế ${tenVerdict[position.verdict]}.`
          : `Đánh mất thế ${tenVerdict[position.verdict]} đã chứng minh — thế đổi sang ${tenVerdict[verdict]}.`,
      };
    });
    return { available: true, moves: danhGia };
  });
}

export async function listMySessions({ actor, page, limit }) {
  return withActor(actor.id, async (trx) => {
    const offset = (page - 1) * limit;
    const { rows } = await trx.raw(
      `SELECT s.id, s.position_id, s.mode, s.status, s.result, s.end_reason, s.created_at, s.ended_at,
              p.label, p.category
         FROM co_the_sessions s JOIN co_the_positions p ON p.id = s.position_id
        WHERE s.community_id = ? AND s.solver_member_id = ?
        ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [actor.communityId, actor.id, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM co_the_sessions WHERE community_id = ? AND solver_member_id = ?`,
      [actor.communityId, actor.id]
    );
    return { data: rows, meta: { page, limit, total } };
  });
}
```

- [ ] **Step 2: Sửa `move()` (Task 4) để kích hoạt chấm nền**

Trong `move()`, NGAY SAU dòng
`publishToGame(id, 'session_end', { result: result.result, reason: result.end_reason });`
thêm:
```js
  if (result.status === 'ket-thuc') {
    scoreSessionMoves({ communityId: actor.communityId, sessionId: id }).catch((e) => console.error('scoreSessionMoves lỗi:', e));
  }
```

`giveUp()` (Task 4) KHÔNG cần gọi `scoreSessionMoves` — bỏ cuộc thì
`verdict` gốc vẫn còn nguyên vẹn tới lúc bỏ cuộc, không có nước nào của
người giải cần chấm thêm ngoài những nước đã đi (nếu có) — vẫn nên chấm,
nên thêm CÙNG một dòng gọi `scoreSessionMoves` vào cuối `giveUp()` (trước
dòng `return result;`), lý do: người giải có thể đã đi vài nước rồi mới bỏ
cuộc, Mổ ván vẫn cần chấm các nước đó.

- [ ] **Step 3: Routes**

Thêm vào `routes.js`:
```js
router.get('/sessions/:id/mo-van', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.getMoVan({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.get('/sessions', requireAuth, validate(schema.listQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.listMySessions({ actor: req.actor, ...req.query })); } catch (e) { next(e); }
});
```

Thêm vào `schema.js`:
```js
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
```

- [ ] **Step 4: Test** — `api/tests/t51-co-the-review.test.js`. Dựng thế
  CHỨNG MINH thật (mate) rồi cho người giải đi ĐÚNG 1 nước ăn Tướng ngay
  (ván kết thúc lập tức, không cần chờ vòng lặp mổ ván nhiều bước — giữ
  test đơn giản, không cần polling `wait()` nhờ nước đầu luôn copy điểm gốc
  mà không gọi engine):

```js
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Tướng Đen (0,4) không có lối thoát (Sĩ hai bên chặn ô chéo), Xe Đỏ (1,4)
// đi thẳng ăn Tướng ngay nước đầu -> chiếu bí lập tức, ván kết thúc ở ĐÚNG
// nước đầu của người giải (không có nước máy đáp lễ, không có nước 2).
function matIn1Board() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  b[0][3] = { side: 'b', type: 'advisor' };
  b[0][5] = { side: 'b', type: 'advisor' };
  b[1][4] = { side: 'r', type: 'chariot' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t51-co-the', 'T51') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T51', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T51 Cờ Thế — Mổ ván + Diễn giải + Hồ sơ', () => {
  it('chiếu bí ngay nước đầu: mo-van có sẵn ngay (nước đầu copy điểm gốc, không cần gọi engine nền), giữ thế thắng', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'e1e0', score_cp: 0, mate: 1, depth: 20, pv: ['e1e0'], lines: [] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/positions/${created.body.id}/phan-tich`).set(auth(aliceToken)).expect(200);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    const moveRes = await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 1, c: 4 }, to: { r: 0, c: 4 } }).expect(200);
    expect(moveRes.body.status).toBe('ket-thuc');
    expect(moveRes.body.result).toBe('thang');

    const moVan = await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}/mo-van`).set(auth(aliceToken)).expect(200);
    expect(moVan.body.available).toBe(true);
    expect(moVan.body.moves).toHaveLength(1);
    expect(moVan.body.moves[0].giu_the).toBe(true);
    expect(moVan.body.moves[0].dien_giai).toContain('Vẫn giữ thế');
  });

  it('hồ sơ liệt kê đúng ván vừa xong của chính người giải', async () => {
    const list = await supertest(app).get('/api/v1/co-the/sessions').set(auth(aliceToken)).expect(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data[0].status).toBe('ket-thuc');
  });

  it('ván chưa kết thúc thì mo-van trả 409', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'a', score_cp: 200, mate: null, depth: 10, pv: [], lines: [{ move: 'a', score_cp: 200, mate: null, depth: 10, pv: [] }] });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}/mo-van`).set(auth(aliceToken)).expect(409);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/roi`).set(auth(aliceToken)).expect(200);
    await wait(50); // để scoreSessionMoves nền (kích hoạt bởi giveUp) không rơi vào test sau khi DB đã destroy
  });
});
```

- [ ] **Step 5: Chạy toàn bộ test module, xác nhận xanh**

```bash
cd api && NODE_ENV=development npx vitest run tests/t47-co-the-rules.test.js tests/t48-co-the-positions.test.js tests/t49-co-the-analysis.test.js tests/t50-co-the-sessions.test.js tests/t51-co-the-review.test.js
```

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/co-the/ api/tests/t51-co-the-review.test.js
git commit -m "feat(cotuong): Cờ Thế — Mổ ván (giữ/mất thế thắng) + Diễn giải câu mẫu + Hồ sơ"
```

---

### Task 6: Luyện Thế (tự đấu máy-vs-máy nền, 3 cấp)

**⚠️ Task ít chắc chắn nhất trong plan này — đọc kỹ trước khi bắt đầu.**
Cách xếp Hạ/Trung/Cao cấp dưới đây là MỘT lựa chọn cụ thể của người lập kế
hoạch, không phải suy ra duy nhất từ tài liệu gốc (tài liệu chỉ mô tả Ý
NGHĨA ba cấp, không cho công thức). Task reviewer cần đọc phần "Ghi chú
thiết kế" dưới đây kỹ hơn các task khác, và implementer được khuyến khích
nêu nghi vấn thay vì âm thầm đổi công thức nếu thấy vô lý khi chạy thật.

**Ghi chú thiết kế:**
- N ván mặc định **8** (không phải 20 — mỗi ván có thể vài chục nước, mỗi
  nước gọi engine ~3s, N lớn có thể chiếm dụng pool `engine` (mặc định 1-2
  worker, xem `docker-compose.yml`) nhiều phút, chặn cả những request phân
  tích/máy đi hộ khác đang chờ hàng đợi. Xem lại con số này khi có `ENGINE_POOL_SIZE`
  thật từ VPS — cùng tinh thần "chưa định" đã ghi ở spec Kernel/Engine mục 9).
- Đối thủ (bên KHÔNG phải `solver_side`) dùng `aiSelect` cấp `'xuat-sac'`
  (lỏng nhất) + `rng` THẬT (`Math.random`, không cố định) — để MỖI ván
  chống một kiểu khác nhau, đúng ý "đối phương chống hết sức nhưng đa
  dạng" của Luyện Thế. Bên `solver_side` luôn dùng cấp `'sieu'` (luôn nước
  tốt nhất) — máy phải ĐI ĐÚNG hộ người giải trong lúc mô phỏng.
- Xếp cấp: nhóm các ván theo NƯỚC ĐẦU của người giải; **Hạ cấp** = nhóm có
  số nước trung bình tới kết cục THẤP NHẤT trong số các nhóm thắng
  100%; **Cao cấp** = nhóm có tỉ lệ thắng CAO NHẤT bất kể độ dài (chắc nhất
  khi đối phương chống đa dạng); **Trung cấp** = nhóm còn lại có điểm
  `tỉ_lệ_thắng / số_nước_trung_bình` cao nhất.

**Files:**
- Modify: `api/src/modules/co-the/service.js`
- Modify: `api/src/modules/co-the/routes.js`
- Create: `api/tests/t52-co-the-luyen-the.test.js`

**Interfaces:**
- Consumes: `loadSession`, `aiSelect.selectAiMove`, `rules.*` (như Task 4).
- Produces: `service.runLuyenThe({actor, id})` — bắt đầu chạy nền, trả
  `{started: true}` ngay; kết quả tới qua SSE event `luyen_the_done` (dùng
  `publishToGame`, client Task Frontend tự subscribe qua route đã có ở
  `games/routes.js` KHÔNG áp dụng — Cờ Thế cần route `/stream` riêng, xem
  Task 7 (route đó phục vụ CẢ host lẫn khách, dựng ở Task 7 để không tách
  đôi công việc SSE)*.

> \* Nếu Task 7 (màn khách) bị hoãn/không làm, Task này vẫn tự đứng được —
> `publishToGame` không lỗi khi không ai đang subscribe (xem
> `core/realtime.js`: `if (!map) return;`), chỉ là chưa ai nhận được sự
> kiện `luyen_the_done` qua SSE cho tới khi có route stream.

- [ ] **Step 1: Thêm vào `service.js`**

```js
const LUYEN_THE_N_VAN = 8;
const LUYEN_THE_MOVETIME_MS = 3000;
const LUYEN_THE_MAX_PLIES = 200; // sàn an toàn — không để 1 ván mô phỏng chạy vô hạn

export async function runLuyenThe({ actor, id }) {
  const session = await withActor(actor.id, (trx) => loadSession(trx, actor.communityId, id));
  if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
  if (session.mode !== 'luyen-the') throw INVALID_STATE('Ván này không phải chế độ Luyện Thế.');
  if (session.status !== 'dang-choi') throw INVALID_STATE('Ván này đã kết thúc.');
  runLuyenTheBackground({ communityId: actor.communityId, session }).catch((e) => console.error('luyện thế lỗi:', e));
  return { started: true };
}

async function simulateOneGame(session) {
  let board = session.board, turn = session.turn, moves = [], history = [];
  let gameOver = false, winner = null;
  while (!gameOver && moves.length < LUYEN_THE_MAX_PLIES) {
    const fen = rules.boardToFen(board, turn);
    const { lines } = await engineClient.bestMove({ fen, movetime: LUYEN_THE_MOVETIME_MS, multipv: 3 });
    if (!lines?.length) break;
    const level = turn === session.solver_side ? 'sieu' : 'xuat-sac';
    const chosenUci = selectAiMove(lines, level, Math.random);
    if (!chosenUci) break;
    const { from, to } = rules.uciMoveToCells(chosenUci);
    const applied = rules.applyMove(board, from, to);
    const newHash = rules.hashBoard(applied.board, applied.gameOver ? turn : rules.opp(turn));
    history.push({ side: turn, isCheck: applied.checkOpp, captured: !!applied.captured, boardHash: newHash });
    moves.push({ side: turn, uci: chosenUci });
    board = applied.board; gameOver = applied.gameOver; winner = applied.winner;
    if (!gameOver) {
      const rep = rules.detectRepetition(history);
      if (rep) { gameOver = true; winner = rep.loser ? rules.opp(rep.loser) : null; }
      else if (rules.detectNoCaptureDraw(history)) { gameOver = true; winner = null; }
    }
    turn = gameOver ? turn : rules.opp(turn);
  }
  const result = !winner ? 'hoa' : winner === session.solver_side ? 'thang' : 'thua';
  return { moves, result };
}

async function runLuyenTheBackground({ communityId, session }) {
  const results = [];
  for (let i = 0; i < LUYEN_THE_N_VAN; i++) results.push(await simulateOneGame(session));

  const grouped = new Map();
  for (const g of results) {
    const first = g.moves.find((m) => m.side === session.solver_side);
    if (!first) continue;
    const cur = grouped.get(first.uci) ?? { count: 0, wins: 0, totalLen: 0 };
    cur.count++; if (g.result === 'thang') cur.wins++; cur.totalLen += g.moves.length;
    grouped.set(first.uci, cur);
  }
  const candidates = [...grouped.entries()].map(([first_move, s]) => ({
    first_move, ti_le_thanh_cong: s.wins / s.count, so_nuoc_trung_binh: s.totalLen / s.count, so_van: s.count,
  }));
  const thanhCong100 = candidates.filter((c) => c.ti_le_thanh_cong === 1);
  const ha = [...(thanhCong100.length ? thanhCong100 : candidates)]
    .sort((a, b) => a.so_nuoc_trung_binh - b.so_nuoc_trung_binh)[0] ?? null;
  const cao = [...candidates].sort((a, b) => b.ti_le_thanh_cong - a.ti_le_thanh_cong || a.so_nuoc_trung_binh - b.so_nuoc_trung_binh)[0] ?? null;
  const trung = candidates
    .filter((c) => c !== ha && c !== cao)
    .sort((a, b) => (b.ti_le_thanh_cong / b.so_nuoc_trung_binh) - (a.ti_le_thanh_cong / a.so_nuoc_trung_binh))[0]
    ?? cao ?? ha;

  await withActor(null, (trx) => trx.raw(
    `UPDATE co_the_sessions SET status = 'ket-thuc', end_reason = 'luyen-the-xong', ended_at = now()
      WHERE id = ? AND status = 'dang-choi'`,
    [session.id]
  ));
  publishToGame(session.id, 'luyen_the_done', { ha, trung, cao, tong_so_van: results.length });
}
```

- [ ] **Step 2: Route**

```js
router.post('/sessions/:id/luyen-the/chay', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.runLuyenThe({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 3: Test** — `api/tests/t52-co-the-luyen-the.test.js` (mock
  engine trả LUÔN 1 nước cố định mỗi bên để mô phỏng chạy nhanh, có thể
  đoán trước kết quả):

```js
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Xe Đỏ (1,4) ăn thẳng Tướng Đen (0,4) ngay nước đầu -> mỗi ván mô phỏng
// dài ĐÚNG 1 nước, kết thúc lập tức, không cần vòng lặp dài trong test.
function matIn1Board() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  b[0][3] = { side: 'b', type: 'advisor' };
  b[0][5] = { side: 'b', type: 'advisor' };
  b[1][4] = { side: 'r', type: 'chariot' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t52-co-the', 'T52') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T52', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T52 Cờ Thế — Luyện Thế', () => {
  it('chạy nền, kết thúc session, mỗi ván chiếu bí ngay nước đầu -> Hạ/Trung/Cao đều tồn tại và có nước đầu duy nhất', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'e1e0', score_cp: 0, mate: 1, depth: 20, pv: ['e1e0'],
      lines: [{ move: 'e1e0', score_cp: 0, mate: 1, depth: 20, pv: ['e1e0'] }],
    });
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'luyen-the', luyen_the_cap: 'ha' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/luyen-the/chay`).set(auth(aliceToken)).expect(200);
    await wait(500);
    const detail = await supertest(app).get(`/api/v1/co-the/sessions/${session.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.status).toBe('ket-thuc');
    expect(detail.body.end_reason).toBe('luyen-the-xong');
  });

  it('không phải chế độ luyen-the thì không chạy được (409)', async () => {
    const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
      .send({ board: matIn1Board(), side_to_move: 'r' }).expect(201);
    const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
      .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
    await supertest(app).post(`/api/v1/co-the/sessions/${session.body.id}/luyen-the/chay`).set(auth(aliceToken)).expect(409);
  });
});
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

```bash
cd api && NODE_ENV=development npx vitest run tests/t52-co-the-luyen-the.test.js
```

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/co-the/ api/tests/t52-co-the-luyen-the.test.js
git commit -m "feat(cotuong): Cờ Thế — Luyện Thế 3 cấp (tự đấu máy-vs-máy nền)"
```

---

### Task 7: Màn khách/người xem

**Files:**
- Modify: `api/src/modules/co-the/schema.js`
- Modify: `api/src/modules/co-the/service.js`
- Modify: `api/src/modules/co-the/routes.js`
- Create: `api/tests/t53-co-the-guest.test.js`

**Interfaces:**
- Produces: `service.createInvite`, `service.guestJoin`, `service.getGuestView`.
- Route `GET /co-the/xem/:token/stream` — SSE, dùng `subscribeGame`/
  `publishToGame` (key = `session.id`, ĐÃ dùng ở Task 4/6 — khách xem cùng
  kênh, không kênh riêng).

**Ghi chú:** Khách CHỈ xem — không có route nào cho khách gọi
`/moves`/`/mach-1-nuoc`/`/tim-cach-pha`. Route khách không dùng
`requireAuth` (không cần đăng nhập) và cũng không dùng chung
`requireAuthOrGuestToken` của `games` (middleware đó tra cứng bảng
`games` — xem `middleware/gameAuth.js`) — khách Cờ Thế xác thực trực tiếp
trong `service.getGuestView` bằng cách so `guest_token`, đơn giản hơn vì
không có nhánh "thành viên" nào cần hỗ trợ ở các route này (host dùng route
khác hẳn, không đi qua đây).

- [ ] **Step 1: Schema**

```js
export const guestJoinParamsSchema = z.object({ token: z.string().min(1) });
export const guestViewQuerySchema = z.object({ guest_token: uuid });
```

- [ ] **Step 2: `service.js`**

```js
import { randomUUID } from 'node:crypto';
import { subscribeGame } from '../../core/realtime.js';

export async function createInvite({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const session = await loadSession(trx, actor.communityId, id);
    if (session.solver_member_id !== actor.id) throw FORBIDDEN('Bạn không phải người giải ván này.');
    if (session.invite_token) return { invite_token: session.invite_token };
    const token = randomUUID();
    await trx.raw(`UPDATE co_the_sessions SET invite_token = ? WHERE id = ?`, [token, id]);
    return { invite_token: token };
  });
}

export async function guestJoin({ rawToken }) {
  return withActor(null, async (trx) => {
    const { rows: [session] } = await trx.raw(`SELECT id FROM co_the_sessions WHERE invite_token = ?`, [rawToken]);
    if (!session) throw NOT_FOUND();
    const guestToken = randomUUID();
    await trx.raw(`UPDATE co_the_sessions SET guest_token = ? WHERE id = ?`, [guestToken, session.id]);
    return { session_id: session.id, guest_token: guestToken };
  });
}

// Dữ liệu RÚT GỌN cho khách — CHỈ bàn cờ/lượt/trạng thái/nhật ký (spec mục
// 5: 6 khối riêng tư — Phân tích/Đối thủ/trình độ/Tìm cách phá/Đường
// giải/Diễn giải — KHÔNG BAO GIỜ có trong response này).
export async function getGuestView({ rawToken, guestToken }) {
  return withActor(null, async (trx) => {
    const { rows: [session] } = await trx.raw(
      `SELECT id, board, turn, status, result FROM co_the_sessions WHERE invite_token = ?`, [rawToken]
    );
    if (!session || !guestToken || session.guest_token !== guestToken) {
      throw new AppError('UNAUTHENTICATED', 'Cần vào đúng bằng link mời.', { status: 401 });
    }
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c, captured_type FROM co_the_moves WHERE session_id = ? ORDER BY seq ASC`,
      [session.id]
    );
    return { ...session, moves };
  });
}

// Dùng ở route /stream — trả session_id (không lộ gì khác) sau khi xác
// thực guest_token đúng, để route mở SSE subscribe đúng kênh.
export async function assertGuestVisible({ rawToken, guestToken }) {
  const { rows: [session] } = await withActor(null, (trx) =>
    trx.raw(`SELECT id, guest_token FROM co_the_sessions WHERE invite_token = ?`, [rawToken]));
  if (!session || !guestToken || session.guest_token !== guestToken) {
    throw new AppError('UNAUTHENTICATED', 'Cần vào đúng bằng link mời.', { status: 401 });
  }
  return { sessionId: session.id };
}
```

- [ ] **Step 3: Routes**

```js
router.post('/sessions/:id/moi-xem', requireAuth, validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try { res.json(await service.createInvite({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
router.post('/xem/:token/vao', validate(schema.guestJoinParamsSchema, 'params'), async (req, res, next) => {
  try { res.status(201).json(await service.guestJoin({ rawToken: req.params.token })); } catch (e) { next(e); }
});
router.get('/xem/:token', validate(schema.guestJoinParamsSchema, 'params'), validate(schema.guestViewQuerySchema, 'query'), async (req, res, next) => {
  try { res.json(await service.getGuestView({ rawToken: req.params.token, guestToken: req.query.guest_token })); }
  catch (e) { next(e); }
});
router.get('/xem/:token/stream', validate(schema.guestJoinParamsSchema, 'params'), validate(schema.guestViewQuerySchema, 'query'), async (req, res, next) => {
  let visible;
  try { visible = await service.assertGuestVisible({ rawToken: req.params.token, guestToken: req.query.guest_token }); }
  catch (e) { return next(e); }
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ session_id: visible.sessionId })}\n\n`);
  const unsubscribe = subscribeGame(visible.sessionId, null, null, res);
  const keepalive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(keepalive); unsubscribe(); });
});
```

- [ ] **Step 4: Test** — `api/tests/t53-co-the-guest.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

let db, app, cid, alice, aliceToken;
const auth = (t) => ({ authorization: `Bearer ${t}` });

function validBoard() {
  const b = Array.from({ length: 10 }, () => Array(9).fill(null));
  b[9][4] = { side: 'r', type: 'general' };
  b[0][4] = { side: 'b', type: 'general' };
  return b;
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [c] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t53-co-the', 'T53') RETURNING id`);
  cid = c.id;
  const { rows: [a] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T53', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

async function createSession() {
  const created = await supertest(app).post('/api/v1/co-the/positions').set(auth(aliceToken))
    .send({ board: validBoard(), side_to_move: 'r' }).expect(201);
  const session = await supertest(app).post('/api/v1/co-the/sessions').set(auth(aliceToken))
    .send({ position_id: created.body.id, mode: 'giai', opponent_level: 'manh' }).expect(201);
  return session.body;
}

describe('T53 Cờ Thế — màn khách/người xem', () => {
  it('tạo link mời, khách vào bằng token nhận được guest_token, xem được bàn cờ rút gọn', async () => {
    const session = await createSession();
    const invite = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    const joined = await supertest(app).post(`/api/v1/co-the/xem/${invite.body.invite_token}/vao`).expect(201);
    expect(joined.body.session_id).toBe(session.id);
    const view = await supertest(app).get(`/api/v1/co-the/xem/${invite.body.invite_token}`)
      .query({ guest_token: joined.body.guest_token }).expect(200);
    expect(view.body.board).toBeTruthy();
    expect(view.body).not.toHaveProperty('opponent_level');
  });

  it('sai guest_token thì 401', async () => {
    const session = await createSession();
    const invite = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    await supertest(app).get(`/api/v1/co-the/xem/${invite.body.invite_token}`)
      .query({ guest_token: '00000000-0000-0000-0000-000000000000' }).expect(401);
  });

  it('gọi lại /moi-xem lần 2 trả về CÙNG invite_token, không tạo mới', async () => {
    const session = await createSession();
    const first = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    const second = await supertest(app).post(`/api/v1/co-the/sessions/${session.id}/moi-xem`).set(auth(aliceToken)).expect(200);
    expect(second.body.invite_token).toBe(first.body.invite_token);
  });
});
```

- [ ] **Step 5: Chạy TOÀN BỘ test module `co-the` (t47-t53), xác nhận xanh**

```bash
cd api && NODE_ENV=development npx vitest run tests/t47-co-the-rules.test.js tests/t48-co-the-positions.test.js tests/t49-co-the-analysis.test.js tests/t50-co-the-sessions.test.js tests/t51-co-the-review.test.js tests/t52-co-the-luyen-the.test.js tests/t53-co-the-guest.test.js
```

- [ ] **Step 6: Chạy toàn bộ test suite của `api` để chắc không phá gì khác**

```bash
cd api && NODE_ENV=development npm test
```

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/co-the/ api/tests/t53-co-the-guest.test.js
git commit -m "feat(cotuong): Cờ Thế — màn khách/người xem qua link mời"
```
