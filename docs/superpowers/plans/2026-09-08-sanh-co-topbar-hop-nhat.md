# Sảnh Cờ — Topbar hợp nhất + Phòng đấu/Xếp hạng/Hướng dẫn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the online Xiangqi hall (tạo phòng + đang đấu) one dedicated "SẢNH CỜ NHACCON6789" topbar instead of today's two mismatched treatments (full site header on the lobby, bare X-only shell in an active game), and add the three screens the reference mockup shows that don't exist yet (Phòng đấu, Xếp hạng, Hướng dẫn).

**Architecture:** A new shared component `xqHallNavHtml(activeTab)` renders the dedicated topbar (logo, 4 tabs, bell, avatar menu, settings gear — reusing existing `#bellBtn`/`#notifPanel`/`#umenuBtn`/`#umenu`/`#logoutBtn` markup and IDs so `bindGlobal()` needs zero changes). Two call sites use it: a new `xqHallShell()` that REPLACES `wrapPage()`/`headerComp()` for 4 "hall" screens (`cotuong-online`, and 3 new screens), and `xqFullscreenShell()` gets it prepended for `cotuong-van`/`cotuong-phong` only. One new backend aggregate endpoint (`GET /games/leaderboard`) backs the new Xếp hạng screen; Phòng đấu reuses data the frontend already fetches; Hướng dẫn is static content.

**Tech Stack:** `web/index.html` (vanilla JS, one inline `<script>`, no build step, no frontend test framework — verify frontend tasks live via the `browser-automation` skill against the running Docker dev stack at `http://localhost`). Backend: Node/Express/Knex/Postgres, vitest (`api/tests/*.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-08-sanh-co-topbar-hop-nhat-design.md`

## Global Constraints

- Scope is ONLY the online multiplayer Xiangqi flow: `cotuong-online`, `cotuong-van`, `cotuong-phong`, plus 3 new screens. Do NOT touch `cotuong` (pass-and-play), `cotuong-may`/`cotuong-the-nhanh` (offline vs-AI), or any `cotuong-the*` screen (Cờ Thế — separate spec/branch).
- Do NOT modify or rebuild: `xqAiToggleHtml`, `gameSetAiLevel`, `xqAnalysisPanelHtml`, `xqFetchAnalysis`, `xqOpponentProfileHtml`, `xqFetchProfile`, `xqCapturedHtml`, `xqMoveLogHtml`, the `.xq-3col*` CSS grid — reference/reuse only.
- Reuse `#bellBtn`/`#notifPanel`/`#umenuBtn`/`#umenu`/`#logoutBtn` markup and IDs verbatim in the new topbar — `bindGlobal()` (web/index.html:2458) already wires these by ID; do not add new IDs or touch `bindGlobal()`.
- No new short room-code-based join path — the "Mã phòng" display is cosmetic only (`'G-' + gameId.slice(0,4)`), the invite-token link stays the only way to join.
- Leaderboard ranks members with **at least 5** finished-and-analyzed games (`analyzed_at IS NOT NULL`), by win rate desc then games played desc, guests excluded (no `black_member_id`).
- `GET /games/leaderboard` MUST be registered before `router.get('/:id', ...)` (routes.js:46) — Express would otherwise match `/leaderboard` as `:id='leaderboard'` and 400 on UUID validation.
- Frontend has no build step: every new function/class goes directly into `web/index.html`; no new files.

---

### Task 1: Backend — `GET /games/leaderboard`

**Files:**
- Modify: `api/src/modules/games/service.js` (add `getLeaderboard`)
- Modify: `api/src/modules/games/routes.js:39-46` (insert new route between the existing `GET /` list route and `GET /:id`)
- Test: `api/tests/t65-leaderboard-endpoint.test.js` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `getLeaderboard({ actor })` → `Promise<{ data: Array<{ member_id, full_name, avatar_url, games_count, wins, win_rate, avg_loss }> }>`. Route: `GET /api/v1/games/leaderboard`, `requireAuth` only, no params. Task 6 (Xếp hạng screen) consumes this exact response shape.

- [ ] **Step 1: Read the pattern this follows**

Read `api/src/modules/games/service.js:828-849` (`getMemberProfile`) — same `withActor`/`trx.raw` style, same `analyzed_at IS NOT NULL` filter. Read `api/tests/t64-member-profile-endpoint.test.js` in full — this task's test follows the exact same setup pattern (mock `engineClient`, create community + members via raw insert, play a real game through the real API to get an analyzed row, `wait(200)` for the fire-and-forget `analyzeGame` to finish before asserting).

- [ ] **Step 2: Write the failing test**

Create `api/tests/t65-leaderboard-endpoint.test.js`:

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

// Chơi 1 ván xong hẳn qua API thật: hostToken thách winnerIsHost ? host : guest
// thắng bằng cách bên thua xin thua ngay sau đúng 1 nước của bên thắng — cùng
// khuôn t64 dùng để có 1 ván 'finished' + đã mổ (analyzed_at khác NULL).
async function playFinishedGame(app, hostToken, guestId, guestToken, hostWins) {
  engineClient.bestMove.mockResolvedValue({ bestmove: 'h2e2', score_cp: 10, mate: null, depth: 6, pv: ['h2e2'] });
  const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(hostToken))
    .send({ opponent_member_id: guestId }).expect(201);
  await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(guestToken)).expect(200);
  const [moverToken, resignerToken] = hostWins ? [hostToken, guestToken] : [guestToken, hostToken];
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/moves`).set(auth(moverToken))
    .send({ from: { r: 7, c: 7 }, to: { r: 7, c: 4 } }).expect(200);
  await supertest(app).post(`/api/v1/games/${challenge.body.id}/resign`).set(auth(resignerToken)).expect(200);
  await wait(200);
}

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t65-leaderboard', 'T65 Leaderboard') RETURNING id`);
  cid = community.id;
  const mk = async (name) => {
    const { rows: [m] } = await db.raw(`INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`, [cid, name]);
    return { id: m.id, token: jwt.sign({ sub: m.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' }) };
  };
  ({ id: alice, token: aliceToken } = await mk('Alice T65'));
  ({ id: bob, token: bobToken } = await mk('Bob T65'));
  ({ id: carol, token: carolToken } = await mk('Carol T65'));

  // Alice thắng Bob 5 ván liền — cả hai đạt đúng ngưỡng 5 ván đã mổ.
  for (let i = 0; i < 5; i++) {
    await playFinishedGame(app, aliceToken, bob, bobToken, true);
  }
  // Alice thắng Carol 2 ván — Carol chỉ có 2 ván, dưới ngưỡng 5.
  for (let i = 0; i < 2; i++) {
    await playFinishedGame(app, aliceToken, carol, carolToken, true);
  }
}, 30000);
afterAll(async () => { await db.destroy(); });

describe('T65 GET /games/leaderboard', () => {
  it('đủ 5 ván đã mổ mới lên bảng, sắp theo tỉ lệ thắng giảm dần', async () => {
    const res = await supertest(app).get('/api/v1/games/leaderboard').set(auth(carolToken)).expect(200);
    const ids = res.body.data.map((r) => r.member_id);
    expect(ids).toContain(alice);
    expect(ids).toContain(bob);
    expect(ids).not.toContain(carol); // chỉ 2 ván, dưới ngưỡng 5

    const aliceRow = res.body.data.find((r) => r.member_id === alice);
    expect(aliceRow.games_count).toBe(5);
    expect(aliceRow.wins).toBe(5);
    expect(aliceRow.win_rate).toBe(100);
    expect(aliceRow.avg_loss).not.toBeNull();

    const bobRow = res.body.data.find((r) => r.member_id === bob);
    expect(bobRow.games_count).toBe(5);
    expect(bobRow.wins).toBe(0);
    expect(bobRow.win_rate).toBe(0);

    // Alice (100%) đứng trên Bob (0%).
    expect(ids.indexOf(alice)).toBeLessThan(ids.indexOf(bob));
  });
  it('không kèm token bị chặn 401', async () => {
    await supertest(app).get('/api/v1/games/leaderboard').expect(401);
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `cd api && npx vitest run tests/t65-leaderboard-endpoint.test.js`
Expected: FAIL — `GET /games/leaderboard` doesn't exist yet (404, or the test hangs/errors on `res.body.data`).

- [ ] **Step 3: Add `getLeaderboard` to service.js**

Add after `getMemberProfile` (after line 849, before `export async function setAiLevel`):

```js
// Xếp hạng (mục 4 spec topbar hợp nhất) — tỉ lệ thắng trên các ván đã kết
// thúc VÀ đã mổ (analyzed_at IS NOT NULL, cùng điều kiện getMemberProfile),
// ngưỡng tối thiểu 5 ván để vào bảng (dưới ngưỡng, tỉ lệ thắng dễ gây hiểu
// lầm — 100% sau đúng 1 ván thắng may). Khách (không black_member_id) bị
// loại khỏi vế UNION thứ hai — khách không có hồ sơ, không xếp hạng được,
// cùng nguyên tắc getAnalysis/getMemberProfile.
export async function getLeaderboard({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT m.id AS member_id, m.full_name, m.avatar_url,
              count(*) AS games_count,
              count(*) FILTER (WHERE x.won) AS wins,
              avg(x.avg_loss) AS avg_loss
         FROM (
           SELECT g.red_member_id AS member_id, (g.winner_member_id = g.red_member_id) AS won, g.red_avg_loss AS avg_loss
             FROM games g WHERE g.community_id = ? AND g.status = 'finished' AND g.analyzed_at IS NOT NULL
           UNION ALL
           SELECT g.black_member_id, (g.winner_member_id = g.black_member_id), g.black_avg_loss
             FROM games g WHERE g.community_id = ? AND g.status = 'finished' AND g.analyzed_at IS NOT NULL
               AND g.black_member_id IS NOT NULL
         ) x
         JOIN members m ON m.id = x.member_id
        GROUP BY m.id, m.full_name, m.avatar_url
       HAVING count(*) >= 5
       ORDER BY (count(*) FILTER (WHERE x.won))::float / count(*) DESC, count(*) DESC
       LIMIT 50`,
      [actor.communityId, actor.communityId]
    );
    return {
      data: rows.map((r) => ({
        member_id: r.member_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        games_count: Number(r.games_count),
        wins: Number(r.wins),
        win_rate: Math.round((Number(r.wins) / Number(r.games_count)) * 1000) / 10,
        avg_loss: r.avg_loss === null ? null : Number(r.avg_loss),
      })),
    };
  });
}
```

- [ ] **Step 4: Wire the route — BEFORE `/:id`**

In `api/src/modules/games/routes.js`, insert immediately after the `router.get('/', ...)` block (ends line 44) and BEFORE `router.get('/:id', ...)` (line 46):

```js
router.get('/leaderboard', requireAuth, async (req, res, next) => {
  try { res.json(await service.getLeaderboard({ actor: req.actor })); } catch (e) { next(e); }
});
```

This placement is load-bearing: `/:id` (line 46) is registered with `validate(schema.idParamSchema, 'params')` which requires a UUID — if `/leaderboard` were registered after it, Express would match `/leaderboard` to `/:id` first and 400 on UUID validation before ever reaching the leaderboard handler.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/t65-leaderboard-endpoint.test.js`
Expected: PASS (2 tests). If the setup times out, the `beforeAll` timeout (30000ms, 3rd arg) may need raising — 7 sequential game-completions with `wait(200)` each is normally well under that.

- [ ] **Step 6: Run the full backend suite, then commit**

Run: `cd api && npm test`
Expected: no new failures introduced (pre-existing unrelated failures, if any, are not this task's concern — note them in the report, don't fix them).

```bash
git add api/src/modules/games/service.js api/src/modules/games/routes.js api/tests/t65-leaderboard-endpoint.test.js
git commit -m "feat(games): thêm GET /games/leaderboard — xếp hạng tỉ lệ thắng, ngưỡng 5 ván đã mổ"
```

---

### Task 2: Frontend — `xqHallNavHtml()` component + wire hub screen through `xqHallShell()`

**Files:**
- Modify: `web/index.html` (add CSS near the existing `.header`/`.avatar-mini`/`.umenu` rules around line 80-110; add `xqHallNavHtml()`/`xqHallShell()`/`XQ_HALL_SCREENS` near `render()`/`wrapPage()` around line 2270-2310; modify `render()` at line 2242-2270 to add the hall-screen branch)

**Interfaces:**
- Consumes: `notifPanelHtml()` (web/index.html:1611), `avatarCircle(path,name,size)` (web/index.html:2670), `ic(name,size)` (web/index.html:1248), `DATA.me`/`DATA.notifUnread`, `footerFull(variant)` (existing, used by `wrapPage`).
- Produces: `XQ_HALL_TABS` (array of `{id,label}`, 4 entries), `xqHallNavHtml(activeTab)` → HTML string, `xqHallShell(activeTab, bodyHtml)` → HTML string, `XQ_HALL_SCREENS` (Set of 4 screen ids: `'cotuong-online'`, `'cotuong-phong-dau'`, `'cotuong-xep-hang'`, `'cotuong-huong-dan'`). Task 3 reuses `xqHallNavHtml(null)` inside `xqFullscreenShell()`. Tasks 4-6 add `V['cotuong-phong-dau']`/`V['cotuong-xep-hang']`/`V['cotuong-huong-dan']` — this task only needs `V['cotuong-online']` (already exists) to keep working; the other 3 render via the existing `V.notfound` fallback until their own tasks land, which is fine (they're in `XQ_HALL_SCREENS` from this task onward so they already get the new topbar once their content lands).

- [ ] **Step 1: Add the CSS**

Add near the existing header rules (after the `.umenu{...}` rule, web/index.html:104):

```css
.xq-hall-nav{position:sticky;top:0;z-index:50;background:#163a2c;color:#fff}
.xq-hall-nav-in{display:flex;align-items:center;gap:18px;padding:10px 0;overflow-x:auto}
.xq-hall-logo{display:flex;align-items:center;gap:8px;color:#fff;flex:none;font-size:12px;line-height:1.3;font-weight:700;text-decoration:none}
.xq-hall-logo b{display:block;font-size:13px;letter-spacing:.02em}
.xq-hall-tabs{display:flex;gap:4px;flex:1;overflow-x:auto}
.xq-hall-tab{color:rgba(255,255,255,.72);padding:8px 12px;border-radius:8px;font-size:13.5px;font-weight:600;white-space:nowrap;text-decoration:none}
.xq-hall-tab.on{color:#fff;background:rgba(255,255,255,.14)}
.xq-hall-right{display:flex;align-items:center;gap:6px;flex:none}
.xq-hall-nav .ic-bell{color:#fff}
.xq-hall-nav .avatar-mini .nm{color:#fff}
.xq-hall-nav .umenu{color:var(--ink)}
```

(`.xq-hall-nav .umenu{color:var(--ink)}` matters: `.umenu` dropdown content must stay dark-on-white even though its trigger button sits in the dark topbar — otherwise the dropdown text inherits white-on-white.)

- [ ] **Step 2: Add `XQ_HALL_TABS`, `xqHallNavHtml()`, `xqHallShell()`, `XQ_HALL_SCREENS`**

Add right after `xqFullscreenShell()` (after line 2303, before the `navIcon` comment at line 2305):

```js
const XQ_HALL_TABS = [
  {id:'cotuong-online', label:'Cờ Tướng'},
  {id:'cotuong-phong-dau', label:'Phòng đấu'},
  {id:'cotuong-xep-hang', label:'Xếp hạng'},
  {id:'cotuong-huong-dan', label:'Hướng dẫn'},
];
// Topbar riêng của Sảnh Cờ — dùng CHUNG cho cả màn sảnh (xqHallShell, xem
// dưới) lẫn màn đang đấu (xqFullscreenShell, Task 3) thay vì mỗi nơi một
// kiểu khung như trước — đúng yêu cầu "gộp phần đấu cờ và phần tạo phòng
// trong 1 cái". Tái dùng NGUYÊN các id #bellBtn/#notifPanel/#umenuBtn/#umenu/
// #logoutBtn — bindGlobal() (đã có sẵn) gắn sự kiện theo đúng các id này,
// không cần sửa gì ở bindGlobal(). activeTab=null khi đang đấu (không tab
// nào sáng — người chơi không đang "ở" một trong 4 mục đó).
function xqHallNavHtml(activeTab){
  const tabsHtml = XQ_HALL_TABS.map(t=>`<a href="#${t.id}" class="xq-hall-tab${activeTab===t.id?' on':''}" data-go="${t.id}">${esc(t.label)}</a>`).join('');
  return `<header class="xq-hall-nav"><div class="wrap xq-hall-nav-in">
    <a href="#cotuong-online" class="xq-hall-logo" data-go="cotuong-online">${ic('star',22)}<span>SẢNH CỜ<br><b>NHACCON6789</b></span></a>
    <nav class="xq-hall-tabs">${tabsHtml}</nav>
    <div class="xq-hall-right">
      <div style="position:relative">
        <button class="ic-bell" id="bellBtn">${ic('bell',17)}${DATA.notifUnread>0?`<span class="dot"></span>`:''}</button>
        <div class="umenu" id="notifPanel" style="width:340px;max-height:420px;overflow-y:auto;padding:4px">${notifPanelHtml()}</div>
      </div>
      <a href="#caidat" data-go="caidat" class="ic-bell" title="Cài đặt">${ic('gear',17)}</a>
      <div class="avatar-mini" id="umenuBtn">
        ${avatarCircle(DATA.me.avatar, DATA.me.name, 32)}
        <div><span class="nm">${esc(DATA.me.name)}</span></div>
        <div class="umenu" id="umenu">
          <a href="#hoso-toi" data-go="hoso-toi">${ic('user',15)} Hồ sơ của tôi</a>
          <a href="#caidat" data-go="caidat">${ic('gear',15)} Cài đặt</a>
          <div class="div"></div>
          <button id="logoutBtn" class="logout">${ic('logout',15)} Đăng xuất</button>
        </div>
      </div>
    </div>
  </div></header>`;
}
// Thay hẳn cho wrapPage() ở 4 màn Sảnh Cờ — KHÔNG xếp chồng lên headerComp()
// (ảnh mẫu chỉ có một thanh ngang duy nhất). Vẫn giữ footerFull() — thông
// tin liên hệ/điều khoản là nội dung chung toàn site, không riêng gì Sảnh Cờ.
function xqHallShell(activeTab, bodyHtml){
  return `
  ${xqHallNavHtml(activeTab)}
  <main><div class="wrap"><div class="content">${bodyHtml}</div></div></main>
  ${footerFull('member')}
  `;
}
const XQ_HALL_SCREENS = new Set(['cotuong-online','cotuong-phong-dau','cotuong-xep-hang','cotuong-huong-dan']);
```

- [ ] **Step 3: Branch `render()` before the `wrapPage(...)` fallback**

In `render()`, the current tail (web/index.html:2255-2269) is:

```js
  if(XQ_FULLSCREEN_SCREENS.has(screen)){
    root.innerHTML = xqFullscreenShell(body, XQ_FULLSCREEN_CLOSE[screen] || 'congchung');
    window.scrollTo(0,0);
    bindGlobal();
    return;
  }
  root.innerHTML = wrapPage(variant, activeTop, body, screen==='congchung' && variant==='public');
  window.scrollTo(0,0);
  bindGlobal();
}
```

Insert a new branch for hall screens between those two blocks (after the `XQ_FULLSCREEN_SCREENS` block's closing `}`, before the final `wrapPage(...)` line):

```js
  if(XQ_HALL_SCREENS.has(screen)){
    root.innerHTML = xqHallShell(screen, body);
    window.scrollTo(0,0);
    bindGlobal();
    return;
  }
```

`variant` for these 4 screens stays `'member'` (none are in `PUBLIC_SCREENS`, `variantOf()` untouched) — the existing auth-gate at line 2227 (`if((variant==='member'||variant==='admin') && !isAuthed())...`) still runs BEFORE this new branch and still redirects unauthenticated visitors to login, unchanged.

- [ ] **Step 4: Verify live — old header gone, new topbar shows, tab highlights**

Use the `browser-automation` skill against `http://localhost` (need a real member JWT — same pattern as prior diagnostic sessions this project: throwaway community+member row via `docker exec nhachung-db-1 psql ...`, sign a JWT via `docker exec nhachung-api-1 node -e "require('jsonwebtoken').sign(...)"`, set `localStorage['nc_access']`, `page.reload()`). Navigate to `http://localhost/#cotuong-online`. Confirm via `page.evaluate`:
- `document.querySelector('.xq-hall-nav')` exists, `document.querySelector('.header')` (the old site header) does NOT exist on this screen.
- `document.querySelector('.xq-hall-tab.on')` textContent is `'Cờ Tướng'`.
- Clicking `#bellBtn` still opens `#notifPanel` (reused `bindGlobal()` wiring — confirms no regression).
- Clean up all throwaway DB rows and close the browser session afterward.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm xqHallNavHtml/xqHallShell — topbar riêng Sảnh Cờ, áp dụng cho màn sảnh"
```

---

### Task 3: Frontend — embed the hall topbar into the active-game fullscreen shell

**Files:**
- Modify: `web/index.html:2293-2303` (`xqFullscreenShell()`)

**Interfaces:**
- Consumes: `xqHallNavHtml(activeTab)` (Task 2), `XQ_FULLSCREEN_CLOSE` (existing).
- Produces: `xqFullscreenShell(bodyHtml, closeTarget)` now takes an internal decision based on `closeTarget` — no signature change, callers (`render()`) are unaffected.

- [ ] **Step 1: Modify `xqFullscreenShell()`**

Current (web/index.html:2293-2303):

```js
function xqFullscreenShell(bodyHtml, closeTarget){
  // Nút menu (☰) chỉ hiện khi màn thực sự có bảng điều khiển nổi (.xq-fs-panel)
  // để mở/đóng — tránh 1 nút bấm vô tác dụng ở các trạng thái không có panel
  // (ví dụ màn đang tải ván cờ online, hoặc lời thách đấu đã bị từ chối).
  const hasPanel = bodyHtml.includes('xq-fs-panel');
  return `<div class="xq-fs">
    ${hasPanel ? `<button type="button" class="xq-fs-menu-btn" id="xqFsMenuBtn" title="Menu">${ic('menu',20)}</button>` : ''}
    <a href="#${closeTarget}" data-go="${closeTarget}" class="xq-fs-x" title="Thoát, không đánh nữa">${ic('x',20)}</a>
    <div class="wrap"><div class="content">${bodyHtml}</div></div>
  </div>`;
}
```

Replace with:

```js
function xqFullscreenShell(bodyHtml, closeTarget){
  // Nút menu (☰) chỉ hiện khi màn thực sự có bảng điều khiển nổi (.xq-fs-panel)
  // để mở/đóng — tránh 1 nút bấm vô tác dụng ở các trạng thái không có panel
  // (ví dụ màn đang tải ván cờ online, hoặc lời thách đấu đã bị từ chối).
  const hasPanel = bodyHtml.includes('xq-fs-panel');
  // Topbar Sảnh Cờ CHỈ cho 2 màn đấu-người-thật (chủ phòng/khách) — không cho
  // cotuong-may/cotuong-the*, đúng phạm vi đã chốt trong spec. closeTarget của
  // 2 màn đó luôn là 'cotuong-online' (xem XQ_FULLSCREEN_CLOSE) nên dùng chính
  // điều kiện đó để phân biệt thay vì truyền thêm tham số mới.
  const showHallNav = closeTarget==='cotuong-online';
  return `<div class="xq-fs">
    ${showHallNav ? xqHallNavHtml(null) : ''}
    ${hasPanel ? `<button type="button" class="xq-fs-menu-btn" id="xqFsMenuBtn" title="Menu">${ic('menu',20)}</button>` : ''}
    <a href="#${closeTarget}" data-go="${closeTarget}" class="xq-fs-x" title="Thoát, không đánh nữa">${ic('x',20)}</a>
    <div class="wrap"><div class="content">${bodyHtml}</div></div>
  </div>`;
}
```

**Important note for the implementer:** `closeTarget==='cotuong-online'` is currently true for `cotuong-van` AND ALSO for `cotuong-may`/`cotuong-the-nhanh`/`cotuong-the` (see `XQ_FULLSCREEN_CLOSE`, web/index.html:2287 — all four map to `'cotuong-online'`). That would incorrectly add the hall topbar to the offline vs-AI and Cờ Thế screens too, which is OUT OF SCOPE. Before using `closeTarget` as the discriminator, re-check `XQ_FULLSCREEN_CLOSE` at implementation time — if it's unchanged from today, discriminate on `screen` name instead (pass the actual screen id into `xqFullscreenShell`, or check membership in a small local `new Set(['cotuong-van','cotuong-phong'])` at the call site in `render()` and pass a boolean). **Do not ship a version that adds this topbar to `cotuong-may`/`cotuong-the-nhanh`/`cotuong-the`.** The simplest correct fix: change the call in `render()` (Task 2's Step 3 location) to pass the screen name through, e.g. `xqFullscreenShell(body, XQ_FULLSCREEN_CLOSE[screen] || 'congchung', screen)`, add a third `screen` parameter to `xqFullscreenShell`, and compute `showHallNav = (screen==='cotuong-van' || screen==='cotuong-phong')` instead of inspecting `closeTarget`. Use this corrected approach, not the `closeTarget` heuristic shown above (left in this task only to explain the trap — implement the `screen`-parameter version).

- [ ] **Step 2: Run the syntax check**

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('web/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
new Function(m[1]);
console.log('SYNTAX OK');
"
```
Expected: `SYNTAX OK`

- [ ] **Step 3: Verify live — topbar shows in-game, does NOT show for vs-AI**

Via `browser-automation`: create a throwaway room + join as a second real member (or use the guest invite flow), get to `#cotuong-van:<id>` while active. Confirm `document.querySelector('.xq-hall-nav')` exists and no tab is highlighted (`document.querySelector('.xq-hall-tab.on')` is `null`). Separately navigate to `#cotuong-may` (offline vs-AI) and confirm `document.querySelector('.xq-hall-nav')` is `null` there — this is the regression this task's note above exists to prevent. Clean up throwaway data and close the browser session.

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "feat(web): gắn topbar Sảnh Cờ vào màn đang đấu (cotuong-van/cotuong-phong), không đụng cờ máy/Cờ Thế"
```

---

### Task 4: Backend fix (`list()` excludes guest games) + Frontend Phòng đấu screen

**Files:**
- Modify: `api/src/modules/games/service.js:228-249` (`list()` — fix the black-side JOIN)
- Test: `api/tests/t42-games-rooms.test.js` or a focused new test (see Step 1)
- Modify: `web/index.html` (add `V['cotuong-phong-dau']` near `V['cotuong-online']`, web/index.html:6226-6275)

**Interfaces:**
- Consumes: `GAMES_LIST` / `loadGamesList()` (web/index.html:6193-6203, unmodified), `go(hash)` (existing), `ic()`, `esc()`, `avatarCircle()`.
- Produces: `V['cotuong-phong-dau']` — no other task depends on this function's internals, only on it existing as a valid `V[]` entry so `XQ_HALL_SCREENS` (Task 2) stops falling back to `V.notfound` for this screen. `list()`'s output shape gains no new fields (still `red_name`/`black_name`/etc.) — only which ROWS it returns changes.

- [ ] **Step 0: Fix `list()` — INNER JOIN silently drops guest games and empty pending rooms**

Found while grounding this task: `list()` (`api/src/modules/games/service.js:236-244`) currently reads:

```js
      `SELECT g.id, g.status, g.turn, g.created_at, g.started_at,
              g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
              g.black_member_id, b.full_name AS black_name, b.avatar_url AS black_avatar_url
         FROM games g
         JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
         JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id
        WHERE ${clause} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
```

`b.id = g.black_member_id` is an INNER JOIN — `games.black_member_id` is nullable (a freshly-created room with no opponent yet, or any Gen-2 room where the second player is a GUEST, never has `black_member_id` set — see `createRoom`/`joinRoom` in this same file). An INNER JOIN on a NULL foreign key matches ZERO rows, so `list()` silently excludes: (a) rooms you created that nobody has joined yet, and (b) EVERY room where the opponent joined as a guest — which is the primary flow this whole project built. This is a pre-existing bug, not something this plan introduces, but Task 4's Phòng đấu screen is the first thing to actually render `list()`'s output as a list (today it's only used for badge counts), so it's the first place this bug becomes visibly broken. Fix it now, matching the same `LEFT JOIN` + `COALESCE(..., black_guest_name)` pattern `GAME_SELECT` (line 27) already uses:

```js
      `SELECT g.id, g.status, g.turn, g.created_at, g.started_at,
              g.red_member_id, r.full_name AS red_name, r.avatar_url AS red_avatar_url,
              g.black_member_id, COALESCE(b.full_name, g.black_guest_name) AS black_name, b.avatar_url AS black_avatar_url
         FROM games g
         JOIN members r ON r.id = g.red_member_id AND r.community_id = g.community_id
         LEFT JOIN members b ON b.id = g.black_member_id AND b.community_id = g.community_id
        WHERE ${clause} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`,
```

Write a failing test first in `api/tests/t42-games-rooms.test.js` (read the file first — it already sets up room/guest-join scenarios via the real API, follow its existing helper pattern rather than inventing a new one):

```js
it('T42-extra: GET /games?mine=true liệt kê được phòng có khách (chưa phải thành viên)', async () => {
  // Dùng lại helper tạo phòng + khách vào phòng đã có sẵn trong file này (đọc
  // phần đầu file để lấy đúng tên hàm/biến — không đoán) để có 1 phòng
  // black_member_id NULL, black_guest_name có giá trị, status 'pending' hoặc
  // 'active'. Sau đó:
  const res = await supertest(app).get('/api/v1/games?mine=true&status=pending,active').set(auth(hostToken)).expect(200);
  const row = res.body.data.find(g => g.id === roomId);
  expect(row).toBeDefined();
  expect(row.black_name).toBe(guestName); // COALESCE lấy black_guest_name vì black_member_id NULL
});
```

Run: `cd api && npx vitest run tests/t42-games-rooms.test.js` — expect FAIL (row undefined) before the fix, PASS after. Apply the `list()` fix above, re-run, confirm PASS, then run `cd api && npm test` to confirm no other test broke (search the codebase first for any other test asserting on `list()`'s exact row count that might have been (accidentally) relying on the INNER JOIN's filtering behavior — unlikely, but check before moving on).

Commit this fix separately from the frontend screen:
```bash
git add api/src/modules/games/service.js api/tests/t42-games-rooms.test.js
git commit -m "fix(games): list() dùng LEFT JOIN cho bên Đen — trước đó ẩn mất mọi phòng có khách/chưa ai vào"
```

- [ ] **Step 1: Read `GAMES_LIST`'s shape**

`GAMES_LIST.open` and `GAMES_LIST.mine` are both arrays from `GET /games` (`service.list`, just fixed in Step 0) — each row has `id`, `status`, `red_name`, `black_name` (now correctly falls back to the guest's display name), `red_member_id`, `black_member_id`.

- [ ] **Step 2: Add `V['cotuong-phong-dau']`**

Add after `V['cotuong-online']` (after line 6275):

```js
V['cotuong-phong-dau'] = ()=>{
  if(GAMES_LIST===null){ loadGamesList();
    return `<div class="page-head"><div><h1>Phòng đấu</h1></div></div>
    <p style="padding:40px;text-align:center;color:var(--muted)">Đang tải…</p>`; }
  const mineIds = new Set(GAMES_LIST.mine.map(g=>g.id));
  const openOthers = GAMES_LIST.open.filter(g=>!mineIds.has(g.id));
  const rowHtml = (g, isMine) => `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
    <div><b style="font-size:14.5px">${esc(g.red_name)}</b> <span style="color:var(--muted)">vs</span> <b style="font-size:14.5px">${esc(g.black_name||'(chưa có đối thủ)')}</b>
      <div style="font-size:12.5px;color:var(--muted);margin-top:2px">${g.status==='pending'?'Đang chờ':'Đang đấu'}</div></div>
    <button class="btn ${isMine?'btn-blue':'btn-out'} btn-sm" onclick="go('cotuong-van:${g.id}')">${isMine?'Vào tiếp':'Xem'}</button>
  </div>`;
  return `
  <div class="page-head"><div><h1>Phòng đấu</h1><p>Ván của bạn và các ván đang diễn ra trong Nhà Chung.</p></div></div>
  <h3 style="margin:16px 0 8px">Ván của bạn</h3>
  ${GAMES_LIST.mine.length ? GAMES_LIST.mine.map(g=>rowHtml(g,true)).join('') : '<p style="font-size:13.5px;color:var(--muted)">Bạn chưa có ván nào đang chờ hoặc đang chơi.</p>'}
  <h3 style="margin:20px 0 8px">Đang diễn ra</h3>
  ${openOthers.length ? openOthers.map(g=>rowHtml(g,false)).join('') : '<p style="font-size:13.5px;color:var(--muted)">Chưa có ván nào khác đang diễn ra.</p>'}
  <div style="margin-top:18px"><button class="btn btn-blue" onclick="roomCreate()">${ic('users',15)} Tạo phòng</button></div>`;
};
```

- [ ] **Step 3: Run the syntax check** (same command as Task 3 Step 2). Expected: `SYNTAX OK`

- [ ] **Step 4: Verify live**

Via `browser-automation`, as an authed member navigate to `#cotuong-phong-dau`. With no games: confirm both empty-state messages render. Create one room via the "Tạo phòng" button (or via API beforehand) and reload: confirm it appears under "Ván của bạn" with a working "Vào tiếp" button that navigates to `#cotuong-van:<id>`. Clean up throwaway data.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm màn Phòng đấu — danh sách ván của bạn + đang diễn ra"
```

---

### Task 5: Frontend — Hướng dẫn screen (static content)

**Files:**
- Modify: `web/index.html` (add `V['cotuong-huong-dan']`)

**Interfaces:**
- Consumes: nothing beyond `ic()`.
- Produces: `V['cotuong-huong-dan']` — same role as Task 4's output, no downstream consumers besides `XQ_HALL_SCREENS` routing.

- [ ] **Step 1: Add `V['cotuong-huong-dan']`**

Add near `V['cotuong-phong-dau']`:

```js
V['cotuong-huong-dan'] = ()=>`
  <div class="page-head"><div><h1>Hướng dẫn</h1><p>Luật chơi cơ bản và cách dùng Sảnh Cờ.</p></div></div>
  <div class="card" style="margin-bottom:14px">
    <h3>${ic('book',16)} Luật chơi cơ bản</h3>
    <p style="font-size:13.5px;color:var(--ink2);line-height:1.7;margin-top:8px">
      Mỗi bên có 16 quân: 1 Tướng, 2 Sĩ, 2 Tượng, 2 Xe, 2 Pháo, 2 Mã, 5 Tốt. Tướng chỉ đi trong cung (3x3 ô), không được đối mặt trực tiếp với Tướng đối phương.
      Sĩ đi chéo trong cung. Tượng đi chéo 2 ô, không qua sông, bị cản nếu có quân ở giữa đường đi (mắt Tượng). Xe đi ngang/dọc không giới hạn.
      Pháo đi như Xe nhưng khi ăn quân phải nhảy qua đúng 1 quân khác (ngòi Pháo). Mã đi hình chữ "nhật", bị cản nếu có quân ngay cạnh chân Mã.
      Tốt trước khi qua sông chỉ đi thẳng 1 ô; qua sông rồi đi thẳng hoặc ngang 1 ô, không được lùi. Chiếu bí Tướng đối phương là thắng; hết nước đi hợp lệ mà không bị chiếu là thua (hết nước).
    </p>
  </div>
  <div class="card">
    <h3>${ic('star',16)} Cách dùng Sảnh Cờ</h3>
    <div style="margin-top:10px">
      <div style="margin-bottom:12px"><b style="font-size:13.5px">Tạo phòng & mời</b><p style="font-size:13px;color:var(--ink2);margin-top:3px">Bấm "Tạo phòng" ở màn Cờ Tướng, gửi link mời cho đối thủ — họ vào chơi được ngay, không cần lập tài khoản.</p></div>
      <div style="margin-bottom:12px"><b style="font-size:13.5px">Máy đi hộ</b><p style="font-size:13px;color:var(--ink2);margin-top:3px">Đang đấu mà bận việc, bật "Máy đi hộ ta" để nhaccon6789 tự đi hộ đến khi bạn quay lại tắt.</p></div>
      <div style="margin-bottom:12px"><b style="font-size:13.5px">Mổ ván</b><p style="font-size:13px;color:var(--ink2);margin-top:3px">Sau khi ván kết thúc, cả hai người chơi xem lại từng nước đi và điểm mất trung bình (ACPL) để biết mình sai ở đâu.</p></div>
      <div style="margin-bottom:12px"><b style="font-size:13.5px">Hồ sơ đối thủ</b><p style="font-size:13px;color:var(--ink2);margin-top:3px">Trong ván đang đấu, xem nhanh số ván/tỉ lệ thắng/ACPL trung bình của đối thủ.</p></div>
      <div><b style="font-size:13.5px">Xếp hạng</b><p style="font-size:13px;color:var(--ink2);margin-top:3px">Bảng xếp theo tỉ lệ thắng, chỉ tính thành viên đã chơi ít nhất 5 ván đã mổ xong.</p></div>
    </div>
  </div>`;
```

- [ ] **Step 2: Run the syntax check** (same command as Task 3 Step 2). Expected: `SYNTAX OK`

- [ ] **Step 3: Verify live**

Via `browser-automation`, navigate to `#cotuong-huong-dan` as an authed member. Confirm both cards render with non-empty text content (`document.body.innerText` includes `'Luật chơi cơ bản'` and `'Cách dùng Sảnh Cờ'`).

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm màn Hướng dẫn — luật chơi + cách dùng Sảnh Cờ"
```

---

### Task 6: Frontend — Xếp hạng screen (consumes Task 1's endpoint)

**Files:**
- Modify: `web/index.html` (add `XQ_LEADERBOARD_CACHE`, `xqFetchLeaderboard()`, `V['cotuong-xep-hang']`)

**Interfaces:**
- Consumes: `GET /games/leaderboard` (Task 1) → `{ data: [{ member_id, full_name, avatar_url, games_count, wins, win_rate, avg_loss }] }`. Follow the existing cache/fetch pattern used by `XQ_ANALYSIS_CACHE`/`xqFetchAnalysis` (search for `XQ_ANALYSIS_CACHE` in web/index.html to see the exact shape before writing this — same fire-fetch-then-`render()` pattern, no new pattern invented).
- Produces: `V['cotuong-xep-hang']`.

- [ ] **Step 1: Read the existing fetch-cache-render pattern**

Find `XQ_ANALYSIS_CACHE`/`xqFetchAnalysis` in `web/index.html` (added in the earlier "mổ ván ACPL" sub-project) and read it in full — this task's leaderboard fetch follows the identical shape: a module-level cache object keyed by something stable, a fetch function that no-ops if already loading/cached and calls `render()` on completion, a `null`-vs-populated check at the top of the `V[]` render function to show a loading state on first call.

- [ ] **Step 2: Add the cache/fetch + screen**

```js
let XQ_LEADERBOARD_CACHE = null; // null=chưa tải, 'loading', hoặc mảng data
function xqFetchLeaderboard(){
  if(XQ_LEADERBOARD_CACHE!==null) return;
  XQ_LEADERBOARD_CACHE = 'loading';
  api.get('/games/leaderboard').then(r=>{ XQ_LEADERBOARD_CACHE = r.data||[]; render(); })
    .catch(()=>{ XQ_LEADERBOARD_CACHE = []; render(); });
}
V['cotuong-xep-hang'] = ()=>{
  xqFetchLeaderboard();
  if(XQ_LEADERBOARD_CACHE===null || XQ_LEADERBOARD_CACHE==='loading'){
    return `<div class="page-head"><div><h1>Xếp hạng</h1></div></div>
    <p style="padding:40px;text-align:center;color:var(--muted)">Đang tải…</p>`;
  }
  const rows = XQ_LEADERBOARD_CACHE;
  const rowHtml = (r,i) => `<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
    <div style="width:28px;text-align:center;font-weight:800;color:var(--muted)">${i+1}</div>
    ${avatarCircle(r.avatar_url, r.full_name, 36)}
    <div style="flex:1"><b style="font-size:14px">${esc(r.full_name)}</b>
      <div style="font-size:12px;color:var(--muted)">${r.games_count} ván${r.avg_loss!==null?` · ACPL ${r.avg_loss.toFixed(1)}`:''}</div></div>
    <div style="font-weight:800;font-size:15px;color:var(--brand)">${r.win_rate}%</div>
  </div>`;
  return `
  <div class="page-head"><div><h1>Xếp hạng</h1><p>Theo tỉ lệ thắng — chỉ tính thành viên đã chơi ít nhất 5 ván đã mổ xong.</p></div></div>
  ${rows.length ? rows.map(rowHtml).join('') : '<p style="padding:20px;text-align:center;color:var(--muted)">Chưa có ai đủ 5 ván để xếp hạng.</p>'}`;
};
```

- [ ] **Step 3: Run the syntax check** (same command as Task 3 Step 2). Expected: `SYNTAX OK`

- [ ] **Step 4: Verify live**

Via `browser-automation` + direct DB/API setup (need >=5 finished+analyzed games for at least one member — reuse the same throwaway-data + real-API-play pattern used earlier this session for diagnostic testing, or reuse Task 1's test approach adapted to curl): navigate to `#cotuong-xep-hang`, confirm the member with 5+ games appears with the correct `win_rate` text, and confirm the empty-state message shows when no one qualifies (test against a fresh community with no games).

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm màn Xếp hạng — gọi GET /games/leaderboard"
```

---

### Task 7: Frontend — Mã phòng + Chia sẻ nhanh in the room-waiting screen

**Files:**
- Modify: `web/index.html` — the `phase==='cho-doi-thu'` block inside `V['cotuong-van']` (currently around line 6877-6890 — re-locate by searching for `phase==='cho-doi-thu'` since line numbers shift after Tasks 2-6's insertions).

**Interfaces:**
- Consumes: `ROOM_INVITE_TOKEN` (existing), `st.id` (game id, existing), `esc()`, `ic()`.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Locate the current block**

Search `web/index.html` for `phase==='cho-doi-thu'` inside `V['cotuong-van']` (NOT the one in `guestGameHtml` if any similar string exists — confirm you're editing the HOST's room-waiting block, which contains the `ROOM_INVITE_TOKEN` link-building logic). Read 20 lines of context before editing.

- [ ] **Step 2: Add Mã phòng + Chia sẻ nhanh**

The existing `else` branch (when `ROOM_INVITE_TOKEN` IS set) currently ends with the `<div style="display:flex;gap:8px;width:100%">...Chép</button></div>` line. Replace that closing block with:

```js
      } else {
        const link = location.origin+location.pathname+'#cotuong-phong:'+ROOM_INVITE_TOKEN;
        const linkEnc = encodeURIComponent(link);
        const roomCode = 'G-'+st.id.slice(0,4);
        body = `<h1>Phòng đang chờ đối thủ</h1>
          <p style="font-size:13px;color:var(--muted);margin:8px 0 14px">Gửi link này cho đối thủ để họ vào phòng — không cần tài khoản.</p>
          <div style="display:flex;gap:8px;width:100%"><input class="input" id="room-link" readonly value="${esc(link)}"><button class="btn btn-out btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('room-link').value);toast('Đã sao chép link mời')">${ic('doc',14)} Chép</button></div>
          <p style="font-size:12px;color:var(--muted);margin-top:10px">Mã phòng: <b>${esc(roomCode)}</b> (chỉ để nhận diện — đường vào thật vẫn là link mời ở trên)</p>
          <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <a href="https://www.facebook.com/sharer/sharer.php?u=${linkEnc}" target="_blank" rel="noopener" class="btn btn-out btn-sm">${ic('send',14)} Facebook</a>
            <button type="button" class="btn btn-out btn-sm" onclick="(navigator.share?navigator.share({url:'${link.replace(/'/g,"\\'")}',title:'Mời đấu cờ tướng'}):(navigator.clipboard&&navigator.clipboard.writeText('${link.replace(/'/g,"\\'")}'),toast('Đã sao chép link — dán vào Zalo để gửi')))">${ic('link',14)} Chia sẻ (Zalo/khác)</button>
            <a href="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${linkEnc}" target="_blank" rel="noopener" class="btn btn-out btn-sm">${ic('grid',14)} Mã QR</a>
          </div>`;
      }
```

(Only the innards of the `else` block change — the surrounding `if(!ROOM_INVITE_TOKEN){...} else {...}` structure and everything outside it stays exactly as-is.)

- [ ] **Step 3: Run the syntax check** (same command as Task 3 Step 2). Expected: `SYNTAX OK`

- [ ] **Step 4: Verify live**

Via `browser-automation`: create a room as a real member, reach the "Phòng đang chờ đối thủ" state. Confirm: "Mã phòng: G-xxxx" text renders; the Facebook link's `href` contains the correctly URL-encoded invite link (`#cotuong-phong:<token>`, not `location.href`); the QR `<img>`-equivalent link's `href` also encodes the same invite link; clicking "Chia sẻ (Zalo/khác)" in a headless browser without `navigator.share` support falls back to the clipboard-copy + toast path without throwing a JS error (check console for errors after the click).

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm Mã phòng + Chia sẻ nhanh (Facebook/Zalo/QR) vào màn chờ đối thủ"
```
