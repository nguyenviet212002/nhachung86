# Máy đi hộ + Đồng hồ 30 giây Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `web/index.html`'s `V['cotuong-van']` screen to the already-existing, already-merged "máy đi hộ" (AI-assist) backend, and add a visible 30-second ready-countdown during the room's "đủ người" phase.

**Architecture:** Pure frontend change, one file (`web/index.html`). No migration, no new API routes — `POST /games/:id/ai-level` and the `red_ai_level`/`black_ai_level` fields on `GET /games/:id` already exist and are already merged to `main` (`api/src/modules/games/service.js`, `routes.js`, `schema.js`). Adds: a collapsible "Máy đi hộ ta" level picker, an opponent-AI label, a client-computed 30s countdown, and a bug fix to `refreshGameState()` which currently drops `red_ai_level`/`black_ai_level` on every merge (so a mid-game AI toggle would silently go stale for the viewer until a full reload).

**Tech Stack:** Vanilla JS, template-string rendering (`render()` re-invokes `V['cotuong-van']()` and replaces innerHTML — no virtual DOM). Existing conventions: `esc()` for all interpolated text, `ic(name,size)` for icons, `GUEST_TOKEN ? guestFetch(...) : api.xxx(...)` for dual host/guest network calls (guest identity wins when present).

**Spec:** `docs/superpowers/specs/2026-09-07-sanh-co-may-di-ho-mo-van-design.md`, section 1.

## Global Constraints

- Only `web/index.html` is touched. No `api/` changes — the endpoint and fields already exist (verify with `grep -n "ai-level" api/src/modules/games/routes.js` before starting, to confirm nothing has moved).
- AI level values are exactly `'sieu' | 'thong-minh' | 'xuat-sac' | null` (matches `api/src/modules/games/schema.js:17`, `z.enum(['sieu','thong-minh','xuat-sac']).nullable()`). Never invent other spellings.
- The toggle shows for **your own side only** (`mySide`), never lets you pick AI for the opponent. Backend allows either `red_ai_level` or `black_ai_level` to be set by whichever side calls it — this is deliberately general (any player, host or guest, can hand their own side to AI), not restricted to the host. See spec 1.1.
- The "nhaccon6789 đang chơi" label is the ONLY allowed AI-assist label text — no "Máy", "engine", "AI", "Hội đồng", "Quân Sư" anywhere, including code comments (this naming rule is explicit in `SANH_CO_GIAO_VIEC_DAY_DU.md` §I.1.2 and applies repo-wide to this feature).
- All network calls follow the existing `GUEST_TOKEN ? guestFetch(...) : api.xxx(...)` pattern (guest identity checked first) — never the reverse, and never a bare `api.xxx(...)` that would silently misroute a guest.
- No new CSS classes beyond what's listed in Task 1 — reuse `.xq-ctrl-row`, `.xq-clock`, `.btn`/`.btn-out`/`.btn-blue` already in the stylesheet.
- This repo has no test runner for `web/index.html` (confirmed: no `<script>` test harness, no `.test.js` targeting this file). Verification is: (a) hand dry-run each render branch against the exact `GAME_STATE` shapes given in each task, (b) after the final task, a real headless-browser check via the `browser-automation` skill against the running local Docker stack (`http://localhost`) — this repo's Caddy container bind-mounts `web/` live, so once this branch is merged to `main` the check sees real, current markup. Do the browser check AFTER merge, not before (merging happens outside this plan's tasks, per the calling skill).

---

### Task 1: `gameSetAiLevel` + toggle UI + `refreshGameState` fix

**Files:**
- Modify: `web/index.html:6369-6378` (`refreshGameState` — add two fields to the merge)
- Modify: `web/index.html` near `let GUEST_TOKEN = null, GUEST_INVITE_TOKEN = null;` (`web/index.html:6469`) — add one new global
- Modify: `web/index.html:6710-6715` (the `V['cotuong-van']` action-button `.xq-ctrl-row` block, inside the `mySide&&st.status==='active'` guarded buttons) — insert the toggle markup
- Modify: CSS — add one rule near `.xq-clock.low` (`web/index.html:408`)

**Interfaces:**
- Consumes: `GAME_STATE` global (`web/index.html:6274`), `resolveMySide(g)` (`web/index.html:6460`), `esc()`, `ic(name,size)`, `render()` — all pre-existing.
- Produces: `AI_LEVEL_MENU_OPEN` (boolean global, starts `false`), `aiLevelMenuToggle()` (flips it, calls `render()`), `gameSetAiLevel(id, level)` (calls the endpoint, closes the menu, re-renders on success) — Task 2 and Task 3 do not depend on these, but must not redeclare them.

- [ ] **Step 1: Add the `AI_LEVEL_MENU_OPEN` global and `aiLevelMenuToggle`/`gameSetAiLevel` functions**

Find this exact line (`web/index.html:6469`):
```js
let GUEST_TOKEN = null, GUEST_INVITE_TOKEN = null;
```
Insert immediately before it:
```js
// Nút trượt "Máy đi hộ ta" (BAN_CHUAN_CO_TUONG.md mục 3.3): thu một dòng,
// bấm mở ra 3 cấp, chọn cấp nào gọi API luôn rồi tự thu — không có bước
// xác nhận riêng. Chỉ điều khiển bên CỦA CHÍNH NGƯỜI XEM (mySide), không
// có lựa chọn bật máy hộ đối thủ.
let AI_LEVEL_MENU_OPEN = false;
function aiLevelMenuToggle(){ AI_LEVEL_MENU_OPEN = !AI_LEVEL_MENU_OPEN; render(); }
function gameSetAiLevel(id, level){
  AI_LEVEL_MENU_OPEN = false;
  const req = GUEST_TOKEN ? guestFetch('POST', '/games/'+id+'/ai-level', {level}) : api.post('/games/'+id+'/ai-level', {level});
  req.then(g=>{
    if(GAME_STATE_ID!==id || !GAME_STATE) return;
    GAME_STATE.red_ai_level=g.red_ai_level; GAME_STATE.black_ai_level=g.black_ai_level;
    render();
  }).catch(e=>{ toast(e.message||'Không đổi được máy đi hộ, thử lại.','x'); render(); });
}
```

- [ ] **Step 2: Fix `refreshGameState` to keep `red_ai_level`/`black_ai_level` in sync**

Find this exact block (`web/index.html:6369-6378`):
```js
function refreshGameState(id){
  const req = GUEST_TOKEN ? guestFetch('GET', '/games/'+id) : api.get('/games/'+id);
  req.then(g=>{
    if(GAME_STATE_ID!==id || !GAME_STATE) return;
    GAME_STATE.board=g.board; GAME_STATE.turn=g.turn;
    GAME_STATE.red_time_ms=g.red_time_ms; GAME_STATE.black_time_ms=g.black_time_ms; GAME_STATE.turn_started_at=g.turn_started_at;
    GAME_STATE.draw_offered_by=g.draw_offered_by; GAME_STATE.disconnected_side=g.disconnected_side; GAME_STATE.disconnected_at=g.disconnected_at;
    render();
  }).catch(()=>{});
}
```
Replace the line `GAME_STATE.draw_offered_by=g.draw_offered_by; GAME_STATE.disconnected_side=g.disconnected_side; GAME_STATE.disconnected_at=g.disconnected_at;` with:
```js
    GAME_STATE.draw_offered_by=g.draw_offered_by; GAME_STATE.disconnected_side=g.disconnected_side; GAME_STATE.disconnected_at=g.disconnected_at;
    GAME_STATE.red_ai_level=g.red_ai_level; GAME_STATE.black_ai_level=g.black_ai_level;
```
(so the full function now assigns 8 fields instead of 6 — no other line changes).

- [ ] **Step 3: Add the toggle markup to the action-button row**

Find this exact block (`web/index.html:6710-6715`):
```js
    <div class="xq-ctrl-row">
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="gameOfferDraw('${st.id}')">${ic('handshake',15)} Cầu hoà</button>`:''}
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="resignGame('${st.id}')">${ic('flag',15)} Xin thua</button>`:''}
      <button class="btn btn-out" style="flex:1" onclick="chessFlipBoard()">${ic('swap',15)} Đổi bên</button>
    </div>
    ${mySide&&st.status==='active'?`<div class="xq-ctrl-row" style="margin-top:8px"><button class="btn btn-out" style="flex:1" onclick="gameLeaveActive('${st.id}')">${ic('x',15)} Rời phòng</button></div>`:''}
```
Replace with (adds one new block right after the leave-room row; only computed/rendered when `mySide` is set and the game isn't finished — matches spec 1.1's "chỉ hiện cho chính bên đang xem"):
```js
    <div class="xq-ctrl-row">
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="gameOfferDraw('${st.id}')">${ic('handshake',15)} Cầu hoà</button>`:''}
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="resignGame('${st.id}')">${ic('flag',15)} Xin thua</button>`:''}
      <button class="btn btn-out" style="flex:1" onclick="chessFlipBoard()">${ic('swap',15)} Đổi bên</button>
    </div>
    ${mySide&&st.status==='active'?`<div class="xq-ctrl-row" style="margin-top:8px"><button class="btn btn-out" style="flex:1" onclick="gameLeaveActive('${st.id}')">${ic('x',15)} Rời phòng</button></div>`:''}
    ${mySide&&st.status!=='finished'?xqAiToggleHtml(st,mySide):''}
```

Then, immediately before the `V['cotuong-van'] = (params) => {` line's closing `};` — i.e. right after this function's `return` template-string closes with `` `; `` and the function's own closing `};` — no, simpler: add the new helper function `xqAiToggleHtml` right before the `V['cotuong-van']` assignment itself so it's defined ahead of use (this file relies on `function` hoisting elsewhere, but this one is a plain `const`-style template helper used only inside the same render path, so define it just above). Find:
```js
function resolveMySide(g){
```
(`web/index.html:6460`) and insert immediately **before** it:
```js
// Bản tóm tắt/mở của nút trượt máy đi hộ (BAN_CHUAN_CO_TUONG.md mục 3.3).
// myLevel/oppLevel đọc theo mySide — 'r' đọc red_ai_level làm "của ta",
// black_ai_level làm "của đối thủ", và ngược lại khi mySide==='b'.
const XQ_AI_LEVEL_LABEL = {sieu:'Siêu thông minh', 'thong-minh':'Thông minh', 'xuat-sac':'Xuất sắc'};
function xqAiToggleHtml(st, mySide){
  const myLevel = mySide==='r' ? st.red_ai_level : st.black_ai_level;
  const summary = myLevel ? XQ_AI_LEVEL_LABEL[myLevel] : 'tắt · ta tự đi';
  const rows = ['xuat-sac','thong-minh','sieu'].map(lv=>`
    <button type="button" class="btn ${myLevel===lv?'btn-blue':'btn-out'}" style="width:100%;text-align:left;margin-bottom:6px" onclick="gameSetAiLevel('${st.id}','${lv}')">${myLevel===lv?ic('check',14)+' ':''}${XQ_AI_LEVEL_LABEL[lv]}</button>`).join('');
  return `<div class="xq-ctrl-row" style="margin-top:8px;flex-direction:column;align-items:stretch">
    <button type="button" class="btn btn-out" style="width:100%;justify-content:space-between;display:flex" onclick="aiLevelMenuToggle()">
      <span>Máy đi hộ ta ${myLevel?'':'<span style="color:var(--muted)">(tắt · ta tự đi)</span>'}${myLevel?': '+esc(summary):''}</span>
      <span style="display:inline-flex;transform:rotate(${AI_LEVEL_MENU_OPEN?'-90':'90'}deg)">${ic('chev',14)}</span>
    </button>
    ${AI_LEVEL_MENU_OPEN?`<div style="margin-top:8px">
      ${rows}
      <button type="button" class="btn ${myLevel===null?'btn-blue':'btn-out'}" style="width:100%;text-align:left" onclick="gameSetAiLevel('${st.id}',null)">${myLevel===null?ic('check',14)+' ':''}Tắt · ta tự đi</button>
    </div>`:''}
  </div>`;
}
```

The icon map (`web/index.html:1161`) only has one chevron, `chev: '<path d="M9 6l6 6-6 6"/>'` (right-pointing, used elsewhere as breadcrumb separators and "next" buttons — there is no dedicated up/down variant). Reuse `ic('chev',14)` for both states and rotate it with inline CSS (`rotate(90deg)` points it down when collapsed, `rotate(-90deg)` points it up when the menu is open) rather than adding a new SVG path.

- [ ] **Step 4: Hand-verify against 4 `GAME_STATE` shapes**

No test runner exists for this file (Global Constraints). Instead, trace `xqAiToggleHtml` and the two call sites by hand against these 4 inputs and confirm the exact output described:

1. `st={id:'g1', red_member_id:'m1', black_member_id:'m2', status:'active', red_ai_level:null, black_ai_level:null}`, `mySide='r'` → summary text must read exactly `(tắt · ta tự đi)`, and `gameSetAiLevel('g1','xuat-sac')` etc. must appear in the 3 level buttons' `onclick`.
2. Same `st` but `red_ai_level='sieu'`, `mySide='r'` → summary must read `Siêu thông minh`, and the "Siêu thông minh" row button must carry `class="btn btn-blue"` (not `btn-out`) with a leading check icon.
3. `mySide=null` (a spectator, e.g. `DATA.me` is a third member with no side) → `xqAiToggleHtml` must never be called at all (guarded by `${mySide&&st.status!=='finished'?...}`) — confirm no stray `Máy đi hộ` text renders for spectators.
4. `st.status==='finished'` — confirm the toggle block does not render (guard excludes finished games), matching "Máy đi hộ" only being meaningful while a game can still be played.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): nối nút trượt máy đi hộ + sửa refreshGameState rớt ai_level"
```

---

### Task 2: Nhãn "nhaccon6789 đang chơi" cho đối thủ

**Files:**
- Modify: `web/index.html:6700-6701` (the `<h1>`/subtitle block inside `V['cotuong-van']`)

**Interfaces:**
- Consumes: `st.red_ai_level`/`st.black_ai_level` (already present on `GAME_STATE` since `GET /games/:id` returns them; Task 1 additionally keeps them fresh through `refreshGameState`), `mySide` (already computed earlier in the same function via `resolveMySide(st)`), `esc()`.
- Produces: nothing consumed by later tasks — this is a pure leaf render change.

- [ ] **Step 1: Add the opponent-AI label**

Find this exact block (`web/index.html:6700-6701`):
```js
    <h1>${esc(st.red_name)} <span style="color:var(--muted);font-weight:400">vs</span> ${esc(st.black_name)}</h1>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${mySide?'Bạn đang chơi bên '+(mySide==='r'?'Đỏ':'Đen'):'Bạn đang xem trực tiếp'}</p>
```
Replace with:
```js
    <h1>${esc(st.red_name)} <span style="color:var(--muted);font-weight:400">vs</span> ${esc(st.black_name)}</h1>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${mySide?'Bạn đang chơi bên '+(mySide==='r'?'Đỏ':'Đen'):'Bạn đang xem trực tiếp'}</p>
    ${mySide && (mySide==='r'?st.black_ai_level:st.red_ai_level) ? `<p style="font-size:12.5px;color:var(--muted);margin:-6px 0 12px">nhaccon6789 đang chơi</p>` : ''}
```

Note: `mySide && (...)` guards against showing this to spectators (`mySide` is `null` for a third member watching) — the label is only meaningful framed as "your opponent" when you have a side. A spectator sees both `st.red_ai_level`/`st.black_ai_level` directly if they inspect network responses, but this specific UI string is scoped to players only, matching how the rest of this h1 block already branches on `mySide`.

- [ ] **Step 2: Hand-verify against 3 `GAME_STATE` shapes**

1. `mySide='r'`, `st.black_ai_level='thong-minh'`, `st.red_ai_level=null` → label renders (opponent, i.e. Black, has AI on).
2. `mySide='r'`, `st.black_ai_level=null`, `st.red_ai_level='sieu'` → label does NOT render (it's YOUR OWN side that has AI on, not the opponent's — must not leak your own toggle state as if it were the opponent's).
3. `mySide=null` (spectator) → label does not render.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): nhãn nhaccon6789 đang chơi khi đối thủ bật máy đi hộ"
```

---

### Task 3: Đồng hồ 30 giây hiển thị ở trạng thái "Đủ người"

**Files:**
- Modify: `web/index.html` — the `phase==='du-nguoi'` branch inside `V['cotuong-van']`'s room-phase block (currently around `web/index.html:6643-6645`; re-locate by searching for `phase==='du-nguoi'` since Tasks 1-2 may have shifted line numbers slightly — this task does not touch any lines Tasks 1-2 modified, so a plain re-search is safe)

**Interfaces:**
- Consumes: `xqFormatClock(ms)` (`web/index.html:6439`, already defined — takes milliseconds, returns `mm:ss`), `st.second_joined_at` (ISO timestamp string, already present on `GAME_STATE` — set server-side when the second player joins, per migration `057_games_rooms_clock.js:19`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the countdown display**

Find this exact block (search for `phase==='du-nguoi'` — do not rely on the line number, re-locate fresh):
```js
    } else if(phase==='du-nguoi'){
      body = `<h1>${esc(st.black_name)} đã vào phòng</h1>
        <div class="xq-ctrl-row" style="margin-top:12px"><button class="btn btn-blue" style="flex:1" onclick="roomReady('${st.id}')">${ic('check',15)} Sẵn sàng</button></div>`;
    }
```
Replace with:
```js
    } else if(phase==='du-nguoi'){
      // Đếm 30 giây thuần hiển thị, KHÔNG tự gọi API gì (BAN_CHUAN_CO_TUONG.md
      // mục 2.2: "Đếm từ lúc nào: từ khi người thứ hai vào phòng"). Trạng thái
      // này đã có startRoomPoll() gọi lại render() mỗi 3 giây (web/index.html,
      // hàm startRoomPoll) nên đồng hồ này tự làm mới theo đúng nhịp đó, không
      // cần thêm setInterval riêng. Server tự đuổi khách quá giờ (luật lazy-
      // eviction có sẵn) — lần poll kế tiếp phản ánh đúng trạng thái mới, đồng
      // hồ ở đây không bao giờ tự ý điều hướng hay gọi API khi chạm 0.
      const remainMs = Math.max(0, 30000 - (Date.now() - new Date(st.second_joined_at).getTime()));
      body = `<h1>${esc(st.black_name)} đã vào phòng</h1>
        <p style="font-size:13px;color:var(--muted);margin:4px 0 10px">Còn <b>${xqFormatClock(remainMs)}</b> để cả hai bấm Sẵn sàng.</p>
        <div class="xq-ctrl-row" style="margin-top:12px"><button class="btn btn-blue" style="flex:1" onclick="roomReady('${st.id}')">${ic('check',15)} Sẵn sàng</button></div>`;
    }
```

- [ ] **Step 2: Hand-verify against 2 timing shapes**

1. `st.second_joined_at = new Date(Date.now() - 5000).toISOString()` (joined 5s ago) → `remainMs` ≈ 25000 → `xqFormatClock` renders `00:25`.
2. `st.second_joined_at = new Date(Date.now() - 45000).toISOString()` (joined 45s ago, past the 30s window — server should have already evicted, but this branch must still be safe if a stale render slips through) → `remainMs` clamps to `0` via `Math.max(0, ...)` → renders `00:00`, no negative number, no crash.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): hiện đồng hồ đếm 30 giây ở trạng thái đủ người"
```

---

### Task 4: Real browser verification (after merge)

This task runs from the calling skill's post-merge step, not inside the isolated worktree (the worktree has no live Docker-mounted server to point a browser at — see the earlier `cotuong-phong-khach-ui` branch's ledger for why). After this plan's 3 tasks are merged to `main`:

- [ ] **Step 1: Load a real active game as a member and check the AI toggle renders**

Use the `browser-automation` skill: `node <skill-dir>/browser.mjs "http://localhost/#cotuong-online" --snapshot` requires a logged-in session, which a headless run can't authenticate into without real credentials — so instead, verify via `--eval` against a page that's already reachable without auth, OR ask the human partner to check visually themselves inside a real logged-in browser tab and report back (this is the same login-wall limitation noted earlier this session for `#cotuong-online`). Document which path was used in the task report.

- [ ] **Step 2: Load the public join screen and confirm no console errors were introduced**

```bash
node <browser-automation-skill-dir>/browser.mjs "http://localhost/#cotuong-phong:test" --wait "body" --snapshot
```
Expected: same clean output as the earlier verification in this conversation (heading "Vào phòng cờ tướng", one pre-existing unrelated `mock.js` console warning, zero new errors). A NEW console error here would mean a syntax mistake introduced by Tasks 1-3 broke the whole script tag (this file is one giant inline `<script>` — one syntax error anywhere breaks every screen, not just `V['cotuong-van']`), so this is a real, cheap regression check even though it doesn't touch the AI-toggle code path directly.
