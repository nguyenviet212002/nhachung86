# Mổ ván ACPL + Hồ sơ đối thủ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every Xiangqi (Cờ Tướng) game finishes on this platform, automatically analyze every move against a chess engine, convert the result to a win-rate-based "mất mát" (loss) score instead of the old, explicitly-broken centipawn-bucket scale, store it, and expose it plus a per-member profile summary through two new read-only API endpoints — restricted to the two real players, never guests.

**Architecture:** Pure scoring math lives in a new file with zero I/O (testable with plain numbers, no mocks). A thin orchestration function in `service.js` (mirroring the existing `maybeAutoMove` pattern) replays a finished game's moves through the existing rules engine, calls the existing `engineClient.bestMove` once per ply, and writes the results. It's triggered fire-and-forget from every code path that sets `status='finished'` on a real, played game. Two new `requireAuth`-only routes read the stored results back.

**Tech Stack:** Node.js/Express/knex (raw SQL), vitest with `vi.mock` for the engine client — same stack as the rest of `api/src/modules/games/`.

**Spec:** `docs/superpowers/specs/2026-09-07-sanh-co-may-di-ho-mo-van-design.md`, section 2.

## Global Constraints

- Backend only — `api/` files. No frontend work (that's sub-project 3, a separate later plan).
- Win-rate formula, exact: `winRate(effScore) = 1 / (1 + 10^(-effScore/400))` where `effScore` is a centipawn-equivalent score already normalized for mate scores (spec §2.2).
- `movetime=400, multipv=1` for every analysis engine call — NOT the `movetime=8000` used by live "máy đi hộ" (spec §2.3; these are different call sites for different purposes, keep the constants separate and comment why).
- Reuse `aiSelect.js`'s `effectiveScore()` for mate-score normalization — do not write a second copy of that logic (spec §2.3). This requires exporting it (currently a private, unexported function in that file).
- `analyzeGame()` must never throw out of its call site and must never block or fail the game-finish response — wrap its body in try/catch, log on failure, and call it without `await` (fire-and-forget), exactly like the existing `maybeAutoMove(...).catch((e) => console.error(...))` pattern already used twice in `service.js`.
- `GET /games/:id/analysis` and `GET /games/members/:memberId/profile` use `requireAuth` (member-only) — NEVER `requireAuthOrGuestToken`. A guest token must get a clean 401 at the auth-middleware layer, never reach the service layer at all.
- `GET /games/:id/analysis` additionally rejects (403) any authenticated member who isn't one of the two real players in that specific game — spectators included, even though they passed `requireAuth`.
- No caching layer for the profile endpoint — direct query every call (spec §2.5, platform is small).
- Every test that would otherwise call the real engine must mock `engineClient.bestMove` via `vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }))` (the exact pattern already used in `api/tests/t46-ai-auto-move.test.js:8`) — never let a test hit the real Pikafish service.
- Follow this repo's existing migration style exactly (raw SQL via `knex.raw`, Vietnamese explanatory comments, symmetric `up`/`down`) — see `api/src/db/migrations/057_games_rooms_clock.js` for the most recent example of the same kind of change (adding nullable columns to `games`/`game_moves`).

---

### Task 1: Migration — analysis columns on `game_moves` and `games`

**Files:**
- Create: `api/src/db/migrations/061_games_analysis.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: 6 new nullable columns later tasks write to and read from — `game_moves.eval_before_cp` (int), `game_moves.eval_before_mate` (int), `game_moves.win_loss` (real), `games.red_avg_loss` (real), `games.black_avg_loss` (real), `games.analyzed_at` (timestamptz).

- [ ] **Step 1: Write the migration**

The next free migration number is `061` (`060_co_the_luyen_the_result.js` is the highest existing file at plan-writing time — if a newer one already exists when you start, use the next free number instead and name the file accordingly).

```js
// Cột lưu kết quả mổ ván ACPL (mục 2.4 spec). eval_before_cp/eval_before_mate
// là điểm engine tốt nhất TẠI THẾ CỜ TRƯỚC nước đó, theo góc nhìn bên sắp đi
// (NULL cho tới khi phân tích chạy xong). win_loss là mất mát tỉ lệ thắng của
// riêng nước đó (mục 2.2). red_avg_loss/black_avg_loss/analyzed_at là bản tóm
// tắt trên games — đọc nhanh cho hồ sơ đối thủ, khỏi AVG() lại mỗi lần.
// analyzed_at NULL nghĩa là "chưa mổ xong" (job đang chạy hoặc chưa chạy),
// KHÔNG phải lỗi — UI (dự án con 3) tự hiện "Đang mổ ván…" cho trường hợp này.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE game_moves ADD COLUMN eval_before_cp int;
    ALTER TABLE game_moves ADD COLUMN eval_before_mate int;
    ALTER TABLE game_moves ADD COLUMN win_loss real;

    ALTER TABLE games ADD COLUMN red_avg_loss real;
    ALTER TABLE games ADD COLUMN black_avg_loss real;
    ALTER TABLE games ADD COLUMN analyzed_at timestamptz;
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE games DROP COLUMN analyzed_at;
    ALTER TABLE games DROP COLUMN black_avg_loss;
    ALTER TABLE games DROP COLUMN red_avg_loss;

    ALTER TABLE game_moves DROP COLUMN win_loss;
    ALTER TABLE game_moves DROP COLUMN eval_before_mate;
    ALTER TABLE game_moves DROP COLUMN eval_before_cp;
  `);
}
```

- [ ] **Step 2: Run the migration against the test database and verify the columns exist**

`api/tests/helpers/db.js`'s `resetDb()` already drops and recreates the whole `public` schema then runs `db.migrate.latest()` on every test run — every task's tests below apply this migration automatically via `resetDb()` in `beforeAll`. To verify this specific migration in isolation before any test depends on it, run this one-off script from the `api/` directory:

```bash
node -e "
import('./tests/helpers/db.js').then(async ({ownerKnex}) => {
  const db = ownerKnex();
  await db.raw('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await db.migrate.latest();
  const r = await db.raw(\"select table_name, column_name from information_schema.columns where (table_name='game_moves' and column_name in ('eval_before_cp','eval_before_mate','win_loss')) or (table_name='games' and column_name in ('red_avg_loss','black_avg_loss','analyzed_at'))\");
  console.log(r.rows);
  await db.destroy();
});
"
```
Expected: 6 rows printed (3 from `game_moves`, 3 from `games`), no error. If the migration file has a syntax error or a typo'd column type, `db.migrate.latest()` throws here immediately — that's the point of running it standalone before any other task's tests depend on it silently succeeding.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/061_games_analysis.js
git commit -m "feat(api): migration cột mổ ván ACPL (eval_before_cp/mate, win_loss, avg_loss, analyzed_at)"
```

---

### Task 2: Pure scoring math — `winRate`, `computeMoveLosses`, export `effectiveScore`

**Files:**
- Modify: `api/src/modules/games/aiSelect.js` (export the existing private `effectiveScore` function)
- Create: `api/src/modules/games/analysis.js`
- Test: `api/tests/t61-analysis-math.test.js`

**Interfaces:**
- Consumes: nothing new (pure math + the newly-exported `effectiveScore` from `aiSelect.js`, which already exists — see `api/src/modules/games/aiSelect.js:15-18` for its current unexported form).
- Produces: `effectiveScore(line)` now exported from `aiSelect.js` (unchanged behavior, `{score_cp, mate}` in, number out). `winRate(effScore)` — number in [0,1]. `computeMoveLosses(evals)` — takes an array of `{effScore: number}` objects (one per ply of a game, in play order, each already in the POV of whichever side made that move), returns an array of the same length, each entry the win-rate loss for that move (also POV of that move's own mover). Task 3 consumes both `winRate` and `computeMoveLosses` from `analysis.js`.

- [ ] **Step 1: Export `effectiveScore` from `aiSelect.js`**

Find this exact line in `api/src/modules/games/aiSelect.js`:
```js
function effectiveScore(line) {
```
Change to:
```js
export function effectiveScore(line) {
```
That is the ONLY change to this file — do not touch anything else in it (it already has its own tests; do not re-run or edit them).

- [ ] **Step 2: Write the failing tests for `winRate` and `computeMoveLosses`**

Create `api/tests/t61-analysis-math.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { winRate, computeMoveLosses } from '../src/modules/games/analysis.js';

describe('T61 mổ ván — toán thuần (không I/O)', () => {
  it('winRate(0) là 0.5 — thế cân bằng đúng 50%', () => {
    expect(winRate(0)).toBeCloseTo(0.5, 6);
  });
  it('winRate tăng theo effScore và bị chặn trong (0,1)', () => {
    const low = winRate(-1000), mid = winRate(0), high = winRate(1000);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(1);
  });
  it('winRate đối xứng: winRate(x) + winRate(-x) = 1', () => {
    expect(winRate(250) + winRate(-250)).toBeCloseTo(1, 6);
  });

  it('computeMoveLosses: nước cuối luôn mất mát 0 (không có thế kế tiếp để so)', () => {
    const evals = [{ effScore: 30 }, { effScore: -10 }, { effScore: 50 }];
    const losses = computeMoveLosses(evals);
    expect(losses).toHaveLength(3);
    expect(losses[2]).toBe(0);
  });
  it('computeMoveLosses: nước đi làm điểm bên mình tệ đi (theo góc nhìn mình) ra mất mát dương', () => {
    // Ply 0: trước khi đi, engine chấm +200 (tốt cho bên đi). Ply 1: đến lượt
    // đối phương, engine chấm +150 CHO ĐỐI PHƯƠNG — quy về góc nhìn bên đi ở
    // ply 0 phải đảo dấu thành -150, tức là từ +200 tụt xuống -150: một nước
    // tệ, mất mát phải dương và đáng kể.
    const evals = [{ effScore: 200 }, { effScore: 150 }];
    const losses = computeMoveLosses(evals);
    expect(losses[0]).toBeCloseTo(winRate(200) - winRate(-150), 6);
    expect(losses[0]).toBeGreaterThan(0.3);
  });
  it('computeMoveLosses: nước hoàn hảo (điểm giữ nguyên, đảo góc nhìn đúng) ra mất mát 0', () => {
    // Ply 0 bên đi được +100. Ply 1 (lượt đối phương) engine chấm -100 cho
    // đối phương — quy về góc nhìn ply 0 là +100, giữ nguyên, không mất gì.
    const evals = [{ effScore: 100 }, { effScore: -100 }];
    const losses = computeMoveLosses(evals);
    expect(losses[0]).toBeCloseTo(0, 6);
  });
  it('computeMoveLosses: mảng rỗng ra mảng rỗng, mảng 1 phần tử ra [0]', () => {
    expect(computeMoveLosses([])).toEqual([]);
    expect(computeMoveLosses([{ effScore: 500 }])).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/t61-analysis-math.test.js`
Expected: FAIL — `analysis.js` does not exist yet (module not found).

- [ ] **Step 4: Implement `analysis.js`**

Create `api/src/modules/games/analysis.js`:
```js
// Toán thuần cho mổ ván ACPL (mục 2.2-2.3 spec Máy đi hộ/Mổ ván). Không I/O —
// không gọi engine, không đọc CSDL — kiểm bằng số bịa được ngay, giống hệt
// tinh thần aiSelect.js.

// Quy điểm engine (đã chuẩn hoá cả trường hợp chiếu bí qua effectiveScore()
// của aiSelect.js) sang tỉ lệ thắng ước lượng. Hệ số 400 là công thức logistic
// tiêu chuẩn cộng đồng cờ hay dùng — RULING trong spec §2.2: nền tảng này
// chưa có đủ ván để tự hiệu chỉnh một đường cong riêng, dùng xấp xỉ này trước,
// hiệu chỉnh lại sau khi có đủ dữ liệu thật.
const WINRATE_SCALE = 400;
export function winRate(effScore) {
  return 1 / (1 + Math.pow(10, -effScore / WINRATE_SCALE));
}

// evals: mảng {effScore}, một phần tử mỗi nước đã đi trong ván, ĐÚNG THỨ TỰ
// đã đi, effScore của mỗi phần tử đã ở góc nhìn của BÊN VỪA ĐI nước đó (engine
// luôn chấm theo góc nhìn bên sắp đi tại thế cờ được hỏi — xem service.js
// analyzeGame(), effScore ở đây chính là kết quả hỏi engine TRƯỚC khi áp nước
// đó). Trả về mảng cùng độ dài: mất mát tỉ lệ thắng của từng nước, cũng theo
// góc nhìn bên đã đi nước đó.
//
// Nước cuối cùng của mảng luôn mất mát 0: không có thế kế tiếp để so (ván đã
// dừng ở đó dù vì chiếu bí, xin thua, hết giờ, hay bất kỳ lý do nào) — coi là
// "không đủ dữ liệu để chê" thay vì cố đoán, đúng RULING trong spec §2.3.
export function computeMoveLosses(evals) {
  const losses = [];
  for (let i = 0; i < evals.length; i++) {
    if (i === evals.length - 1) { losses.push(0); continue; }
    const before = evals[i].effScore;
    // Ply kế tiếp là lượt đối phương — effScore của nó đang ở góc nhìn đối
    // phương, đảo dấu để quy về góc nhìn bên vừa đi nước i.
    const afterFromMoverPov = -evals[i + 1].effScore;
    losses.push(winRate(before) - winRate(afterFromMoverPov));
  }
  return losses;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/t61-analysis-math.test.js`
Expected: PASS, all 8 tests.

- [ ] **Step 6: Confirm `aiSelect.js`'s own existing tests still pass** (you only changed one word — `function` → `export function` — but confirm nothing broke)

Run: `cd api && npx vitest run tests/t45-ai-select.test.js`

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/games/aiSelect.js api/src/modules/games/analysis.js api/tests/t61-analysis-math.test.js
git commit -m "feat(api): toán thuần mổ ván ACPL (winRate, computeMoveLosses) + export effectiveScore"
```

---

### Task 3: `analyzeGame()` orchestration + wiring into every game-finish path

**Files:**
- Modify: `api/src/modules/games/service.js`
- Test: `api/tests/t62-analyze-game.test.js`

**Interfaces:**
- Consumes: `winRate`, `computeMoveLosses` from `./analysis.js` (Task 2), `effectiveScore` from `./aiSelect.js` (Task 2), `rules.initBoard/applyMove/boardToFen/opp` (pre-existing), `engineClient.bestMove` (pre-existing), `withActor` (pre-existing).
- Produces: `analyzeGame({ communityId, gameId })` — async, exported from `service.js`, fire-and-forget (never awaited by callers, always `.catch()`-guarded at the call site). Task 4 and Task 5 read the columns this writes but do not call this function directly.

- [ ] **Step 1: Write the failing integration test**

Create `api/tests/t62-analyze-game.test.js`:
```js
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t62-analyze', 'T62 Analyze') RETURNING id`);
  cid = community.id;
  const { rows: [a] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T62', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  const { rows: [b] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T62', 'member') RETURNING id`, [cid]);
  bob = b.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T62 mổ ván tự động chạy khi ván kết thúc', () => {
  it('xin thua kích hoạt mổ ván: engine được gọi movetime=400/multipv=1 mỗi nước, cột được ghi', async () => {
    engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 15, mate: null, depth: 6, pv: ['h2e2'] });

    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    // Một nước thật (Đỏ/Alice đi) để game_moves có ít nhất 1 hàng cho mổ ván soi vào.
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
    // Bob xin thua — kết thúc ván, kích hoạt analyzeGame() (fire-and-forget).
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);

    await wait(200);

    expect(engineClient.bestMove).toHaveBeenCalledWith(expect.objectContaining({ movetime: 400, multipv: 1 }));
    const { rows: [gameRow] } = await db.raw(`SELECT analyzed_at, red_avg_loss, black_avg_loss FROM games WHERE id = ?`, [challenge.body.id]);
    expect(gameRow.analyzed_at).not.toBeNull();
    // Đúng 1 nước đã đi, do Đỏ (Alice) đi — nước cuối luôn mất mát 0 (Task 2),
    // nên red_avg_loss phải là 0, black_avg_loss phải NULL (Đen chưa đi nước nào).
    expect(gameRow.red_avg_loss).toBe(0);
    expect(gameRow.black_avg_loss).toBeNull();
    const { rows: [moveRow] } = await db.raw(`SELECT eval_before_cp, eval_before_mate, win_loss FROM game_moves WHERE game_id = ? AND seq = 1`, [challenge.body.id]);
    expect(moveRow.eval_before_cp).toBe(15);
    expect(moveRow.eval_before_mate).toBeNull();
    expect(moveRow.win_loss).toBe(0);
  });

  it('engine lỗi không làm hỏng luồng xin thua: response vẫn 200, analyzed_at ở lại NULL', async () => {
    engineClient.bestMove.mockRejectedValue(new Error('engine không trả lời'));
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);

    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
    await wait(200);

    const { rows: [gameRow] } = await db.raw(`SELECT analyzed_at FROM games WHERE id = ?`, [challenge.body.id]);
    expect(gameRow.analyzed_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/t62-analyze-game.test.js`
Expected: FAIL — `red_avg_loss`/`analyzed_at` stay NULL forever (nothing calls `analyzeGame` yet).

- [ ] **Step 3: Implement `analyzeGame()` in `service.js`**

Find this exact import block at the top of `api/src/modules/games/service.js`:
```js
import * as rules from './rules.js';
import * as engineClient from './engineClient.js';
import { selectAiMove } from './aiSelect.js';
```
Replace with:
```js
import * as rules from './rules.js';
import * as engineClient from './engineClient.js';
import { selectAiMove, effectiveScore } from './aiSelect.js';
import { winRate, computeMoveLosses } from './analysis.js';
```

Then find the end of the `setAiLevel`/`maybeAutoMove` region — specifically this exact comment+export block (it's the function immediately after `setAiLevel`, already in the file from the earlier "máy đi hộ" branch):
```js
// Tự động đi hộ khi tới lượt bên đang bật "máy đi hộ" (mục 6 spec Kernel/
```
Do NOT modify `maybeAutoMove` itself. Instead, add the new function immediately AFTER `maybeAutoMove`'s closing `}` (find where that function ends — it's the next top-level `export async function` or end-of-function `}` at column 0 following the line above; read enough surrounding context to place your insertion correctly rather than guessing blindly). Insert:

```js
// Mổ ván ACPL sau khi kết thúc (mục 2.3 spec Máy đi hộ/Mổ ván). Fire-and-
// forget — KHÔNG được throw ra ngoài, KHÔNG được chặn response của bất kỳ
// hàm nào gọi nó (resign/acceptDraw/claimTimeout/claimDisconnectTimeout/
// move()) — mọi lỗi tự bắt, tự log, analyzed_at ở lại NULL, không có gì vỡ.
// movetime=400 multipv=1: đây là phân tích NỀN không ai chờ trực tiếp, khác
// hẳn movetime=8000 của máy đi hộ SỐNG (mục 4 spec) — đủ nhanh để một ván 60
// nước phân tích xong trong khoảng nửa phút, đủ sâu để không random nhiễu quá
// mức. Đừng gộp chung hằng số với máy đi hộ.
const ANALYSIS_MOVETIME_MS = 400;
export async function analyzeGame({ communityId, gameId }) {
  try {
    const { rows: moves } = await withActor(null, (trx) => trx.raw(
      `SELECT seq, side, from_r, from_c, to_r, to_c FROM game_moves WHERE game_id = ? ORDER BY seq ASC`, [gameId]
    ));
    if (!moves.length) {
      await withActor(null, (trx) => trx.raw(`UPDATE games SET analyzed_at = now() WHERE id = ?`, [gameId]));
      return;
    }
    let board = rules.initBoard();
    let turn = 'r';
    const evals = [];
    for (const m of moves) {
      const fen = rules.boardToFen(board, turn);
      const line = await engineClient.bestMove({ fen, movetime: ANALYSIS_MOVETIME_MS, multipv: 1 });
      evals.push({ score_cp: line.score_cp, mate: line.mate, effScore: effectiveScore(line) });
      const applied = rules.applyMove(board, { r: m.from_r, c: m.from_c }, { r: m.to_r, c: m.to_c });
      board = applied.board;
      turn = rules.opp(turn);
    }
    const losses = computeMoveLosses(evals);
    await withActor(null, async (trx) => {
      for (let i = 0; i < moves.length; i++) {
        await trx.raw(
          `UPDATE game_moves SET eval_before_cp = ?, eval_before_mate = ?, win_loss = ? WHERE game_id = ? AND seq = ?`,
          [evals[i].score_cp, evals[i].mate, losses[i], gameId, moves[i].seq]
        );
      }
      const redLosses = losses.filter((_, i) => moves[i].side === 'r');
      const blackLosses = losses.filter((_, i) => moves[i].side === 'b');
      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
      await trx.raw(
        `UPDATE games SET red_avg_loss = ?, black_avg_loss = ?, analyzed_at = now() WHERE id = ?`,
        [avg(redLosses), avg(blackLosses), gameId]
      );
    });
  } catch (e) {
    console.error('analyzeGame lỗi:', e);
  }
}
```

Note: `withActor(actorId, fn)` (`api/src/core/tx.js`) returns exactly what `fn(trx)` returns/resolves to — `knex.transaction(async (trx) => { ...; return fn(trx); })` — so `await withActor(null, (trx) => trx.raw(...))` resolving directly to `{rows}` (as written above) is correct, matching every other call site in this file (e.g. `loadGame`'s callers).

- [ ] **Step 4: Wire the fire-and-forget trigger into every finish path**

There are 5 places in `service.js` that set a game to `status='finished'` for a game that was actually PLAYED (has moves): `move()` (checkmate/no-legal-moves/repetition/60-move-draw), `resign()`, `acceptDraw()`, `claimTimeout()`, `claimDisconnectTimeout()`. Do NOT add the trigger to `declineChallenge()` — a declined challenge never had any moves played, there is nothing to analyze, and `analyzeGame` would just do pointless work walking zero moves (harmless, but wasted engine-adjacent work; keep it out).

For each of the 5 functions, find its `publishToGame(id, 'game_end', ...)` call (every one of them already has exactly one) and add the fire-and-forget call on the line immediately after it, using the SAME pattern already used for `maybeAutoMove` at the end of `move()`:

In `move()`, find:
```js
  if (result.gameOver) publishToGame(id, 'game_end', { winner: result.winner, reason: result.reason });
```
Add immediately after it:
```js
  if (result.gameOver) analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
```

In `resign()`, find:
```js
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'resign' });
```
Add immediately after it:
```js
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
```

In `acceptDraw()`, find:
```js
  publishToGame(id, 'game_end', { winner: null, reason: 'hoa-thoa-thuan' });
```
Add immediately after it:
```js
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
```

In `claimTimeout()`, find:
```js
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'het-gio' });
```
Add immediately after it:
```js
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
```

In `claimDisconnectTimeout()`, find:
```js
  publishToGame(id, 'game_end', { winner: result.winnerSide, reason: 'mat-ket-noi' });
```
Add immediately after it:
```js
  analyzeGame({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('analyzeGame lỗi:', e));
```

Every one of these 5 call sites has `actor` in scope (they're all `export async function xxx({ actor, id })`-shaped, matching the pattern already visible in every one of them) — use `actor.communityId`, not a re-derived value.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/t62-analyze-game.test.js`
Expected: PASS, both tests.

- [ ] **Step 6: Run the full existing games test suite to confirm nothing regressed**

Run: `cd api && npx vitest run tests/t41-games-api.test.js tests/t46-ai-auto-move.test.js`
Expected: PASS (these exercise `move`/`resign`/`ai-level` — the functions you just added a trailing fire-and-forget call to; a regression here would mean the insertion broke control flow, not just added analysis).

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/games/service.js api/tests/t62-analyze-game.test.js
git commit -m "feat(api): analyzeGame() tự chạy khi ván kết thúc (mổ ván ACPL, movetime=400)"
```

---

### Task 4: `GET /games/:id/analysis`

**Files:**
- Modify: `api/src/modules/games/routes.js`
- Modify: `api/src/modules/games/service.js`
- Test: `api/tests/t63-analysis-endpoint.test.js`

**Interfaces:**
- Consumes: `game_moves.eval_before_cp/eval_before_mate/win_loss`, `games.red_avg_loss/black_avg_loss/analyzed_at` (Task 1/3), `loadGame`, `resolveSide`, `withActor`, `NOT_FOUND`/`FORBIDDEN`/`INVALID_STATE` (pre-existing in `service.js`).
- Produces: `service.getAnalysis({ actor, id })` → `{ analyzed_at, moves: [{seq, side, eval_before_cp, eval_before_mate, win_loss}], red_avg_loss, black_avg_loss }`. Nothing later consumes this — leaf endpoint, sub-project 3 (frontend) will call it directly.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/t63-analysis-endpoint.test.js`:
```js
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken, bob, bobToken, carol, carolToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t63-analysis', 'T63 Analysis') RETURNING id`);
  cid = community.id;
  const mk = async (name) => {
    const { rows: [m] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`, [cid, name]);
    return { id: m.id, token: jwt.sign({ sub: m.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' }) };
  };
  ({ id: alice, token: aliceToken } = await mk('Alice T63'));
  ({ id: bob, token: bobToken } = await mk('Bob T63'));
  ({ id: carol, token: carolToken } = await mk('Carol T63'));
});
afterAll(async () => { await db.destroy(); });

async function finishedGameId() {
  engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 10, mate: null, depth: 6, pv: ['h2e2'] });
  const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
    .send({ opponent_member_id: bob }).expect(201);
  await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
    .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
  await wait(200);
  return challenge.body.id;
}

describe('T63 GET /games/:id/analysis', () => {
  it('một trong hai người chơi xem được, có moves + tóm tắt', async () => {
    const id = await finishedGameId();
    const res = await supertest(app).get(`/api/v1/games/${id}/analysis`).set(auth(aliceToken)).expect(200);
    expect(res.body.analyzed_at).not.toBeNull();
    expect(res.body.moves).toHaveLength(1);
    expect(res.body.moves[0]).toMatchObject({ seq: 1, side: 'r', eval_before_cp: 10, win_loss: 0 });
    expect(res.body.red_avg_loss).toBe(0);
  });
  it('người thứ ba (không chơi ván này) bị chặn 403', async () => {
    const id = await finishedGameId();
    await supertest(app).get(`/api/v1/games/${id}/analysis`).set(auth(carolToken)).expect(403);
  });
  it('không kèm token bị chặn 401', async () => {
    const id = await finishedGameId();
    await supertest(app).get(`/api/v1/games/${id}/analysis`).expect(401);
  });
  it('ván chưa kết thúc bị chặn 409', async () => {
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).get(`/api/v1/games/${challenge.body.id}/analysis`).set(auth(aliceToken)).expect(409);
    // Dọn dẹp để không vỡ idx_games_active_pair cho test sau trong cùng file.
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/t63-analysis-endpoint.test.js`
Expected: FAIL — 404 (route doesn't exist yet) on every request.

- [ ] **Step 3: Implement `service.getAnalysis`**

Find this exact function in `api/src/modules/games/service.js` (the top of `setAiLevel`, added in the previous sub-project):
```js
export async function setAiLevel({ actor, id, level }) {
```
Insert immediately BEFORE it:
```js
// Mổ ván (mục 2.5 spec) — CHỈ hai người chơi thật của chính ván này, không
// bao giờ khách, không bao giờ người ngoài dù đã đăng nhập (route đã chặn
// guest bằng requireAuth thay vì requireAuthOrGuestToken; hàm này CÒN chặn
// thêm người-thứ-ba-đã-đăng-nhập bằng resolveSide — hai lớp, không chỉ một).
export async function getAnalysis({ actor, id }) {
  return withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Chỉ hai người chơi trong ván này mới xem được mổ ván.');
    if (game.status !== 'finished') throw INVALID_STATE('Ván cờ này chưa kết thúc.');
    const { rows: moves } = await trx.raw(
      `SELECT seq, side, eval_before_cp, eval_before_mate, win_loss FROM game_moves WHERE game_id = ? ORDER BY seq ASC`,
      [id]
    );
    return { analyzed_at: game.analyzed_at, moves, red_avg_loss: game.red_avg_loss, black_avg_loss: game.black_avg_loss };
  });
}

```

- [ ] **Step 4: Add the route**

Find this exact block at the end of `api/src/modules/games/routes.js`:
```js
router.post('/:id/ai-level', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, validate(schema.aiLevelSchema), async (req, res, next) => {
  try { res.json(await service.setAiLevel({ actor: req.actor, id: req.params.id, level: req.body.level })); }
  catch (e) { next(e); }
});
```
Add immediately after it:
```js
router.get('/:id/analysis', validate(schema.idParamSchema, 'params'), requireAuth, async (req, res, next) => {
  try { res.json(await service.getAnalysis({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/t63-analysis-endpoint.test.js`
Expected: PASS, all 4 tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/tests/t63-analysis-endpoint.test.js
git commit -m "feat(api): GET /games/:id/analysis — mổ ván, chỉ 2 người chơi thật"
```

---

### Task 5: `GET /games/members/:memberId/profile`

**Files:**
- Modify: `api/src/modules/games/routes.js`
- Modify: `api/src/modules/games/schema.js`
- Modify: `api/src/modules/games/service.js`
- Test: `api/tests/t64-member-profile-endpoint.test.js`

**Interfaces:**
- Consumes: `games.analyzed_at/red_avg_loss/black_avg_loss/winner_member_id/red_member_id/black_member_id` (Task 1/3), `withActor` (pre-existing).
- Produces: `service.getMemberProfile({ actor, memberId })` → `{ games_count, wins, avg_loss }`. Nothing later consumes this — leaf endpoint.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/t64-member-profile-endpoint.test.js`:
```js
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t64-profile', 'T64 Profile') RETURNING id`);
  cid = community.id;
  const mk = async (name) => {
    const { rows: [m] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`, [cid, name]);
    return { id: m.id, token: jwt.sign({ sub: m.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' }) };
  };
  ({ id: alice, token: aliceToken } = await mk('Alice T64'));
  ({ id: bob, token: bobToken } = await mk('Bob T64'));
});
afterAll(async () => { await db.destroy(); });

describe('T64 GET /games/members/:memberId/profile', () => {
  it('chưa ván nào đã mổ: hồ sơ rỗng nhưng không lỗi', async () => {
    const res = await supertest(app).get(`/api/v1/games/members/${bob}/profile`).set(auth(aliceToken)).expect(200);
    expect(res.body).toEqual({ games_count: 0, wins: 0, avg_loss: null });
  });
  it('sau 1 ván đã mổ (Alice thắng do Bob xin thua): hồ sơ Alice cộng 1 thắng + avg_loss có số thật', async () => {
    // Alice là người ĐÃ ĐI nước duy nhất trong ván (Bob xin thua trước khi đi
    // nước nào) — nên chỉ Alice có avg_loss thật (khác NULL); nếu test này lại
    // tra hồ sơ Bob thì avg_loss của Bob vẫn NULL (Bob chưa đi nước nào để có
    // gì mà tính trung bình), làm assertion "not.toBeNull()" sai một cách âm
    // thầm — cố ý tra hồ sơ ALICE, không phải Bob, để tránh đúng bẫy đó.
    engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 10, mate: null, depth: 6, pv: ['h2e2'] });
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(bobToken)).expect(200);
    await wait(200);

    const res = await supertest(app).get(`/api/v1/games/members/${alice}/profile`).set(auth(aliceToken)).expect(200);
    expect(res.body.games_count).toBe(1);
    expect(res.body.wins).toBe(1);
    expect(res.body.avg_loss).toBe(0);
  });
  it('không kèm token bị chặn 401', async () => {
    await supertest(app).get(`/api/v1/games/members/${bob}/profile`).expect(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/t64-member-profile-endpoint.test.js`
Expected: FAIL — 404 (route doesn't exist yet).

- [ ] **Step 3: Add the schema**

Find this exact line in `api/src/modules/games/schema.js`:
```js
export const idParamSchema = z.object({ id: uuid });
```
Add immediately after it:
```js
export const memberIdParamSchema = z.object({ memberId: uuid });
```

- [ ] **Step 4: Implement `service.getMemberProfile`**

Find this exact function signature in `api/src/modules/games/service.js` (added in Task 4 above — insert this new function immediately after `getAnalysis`'s closing `}`):
```js
export async function getAnalysis({ actor, id }) {
```
After `getAnalysis`'s closing `}`, add:
```js

// Hồ sơ đối thủ (mục 2.5 spec) — thống kê TOÀN BỘ ván đã mổ của memberId trên
// nền tảng, KHÔNG PHẢI riêng đối đầu giữa hai người (RULING trong spec §2.5:
// đọc tự nhiên như một hồ sơ chung). Chỉ đếm ván đã analyzed_at IS NOT NULL —
// một ván vừa kết thúc mà chưa mổ xong không được tính là "đã chơi" ở đây.
export async function getMemberProfile({ actor, memberId }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [row] } = await trx.raw(
      `SELECT
         count(*) AS games_count,
         count(*) FILTER (WHERE winner_member_id = ?) AS wins,
         avg(CASE WHEN red_member_id = ? THEN red_avg_loss ELSE black_avg_loss END) AS avg_loss
       FROM games
       WHERE community_id = ? AND (red_member_id = ? OR black_member_id = ?) AND analyzed_at IS NOT NULL`,
      [memberId, memberId, actor.communityId, memberId, memberId]
    );
    return {
      games_count: Number(row.games_count),
      wins: Number(row.wins),
      avg_loss: row.avg_loss === null ? null : Number(row.avg_loss),
    };
  });
}
```

- [ ] **Step 5: Add the route**

Find this exact block at the end of `api/src/modules/games/routes.js` (the route added in Task 4):
```js
router.get('/:id/analysis', validate(schema.idParamSchema, 'params'), requireAuth, async (req, res, next) => {
  try { res.json(await service.getAnalysis({ actor: req.actor, id: req.params.id })); } catch (e) { next(e); }
});
```
Add immediately after it:
```js
router.get('/members/:memberId/profile', validate(schema.memberIdParamSchema, 'params'), requireAuth, async (req, res, next) => {
  try { res.json(await service.getMemberProfile({ actor: req.actor, memberId: req.params.memberId })); } catch (e) { next(e); }
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/t64-member-profile-endpoint.test.js`
Expected: PASS, all 3 tests.

- [ ] **Step 7: Run the full `api/` test suite once to catch any cross-file interaction**

Run: `cd api && npx vitest run`
Expected: no NEW failures caused by this task's changes (this repo has known pre-existing flaky/unrelated failures in unrelated domains — confirmed earlier this session by running the full suite twice and getting two different failure sets, none touching `games`; compare specifically that every `t6*`/`t4*` games-related file passes, and note the full pass/fail counts in your report for the record rather than assuming clean).

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/src/modules/games/schema.js api/tests/t64-member-profile-endpoint.test.js
git commit -m "feat(api): GET /games/members/:memberId/profile — hồ sơ đối thủ toàn nền tảng"
```
