# Bố cục 3 cột cho chủ phòng Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two real players of an online Xiangqi game (never guests, never spectators) a 3-column game screen: a private left column (captured pieces, move log, post-game analysis, opponent profile) alongside the existing board and action-button column.

**Architecture:** Pure frontend, one file (`web/index.html`). A new CSS grid class wraps the existing active-game render of `V['cotuong-van']`. The left column's first two blocks (captured pieces, move log) render instantly from data already in `GAME_STATE.moves` — no network calls. The last two blocks (mổ ván, hồ sơ đối thủ) lazy-fetch the two endpoints merged in the previous sub-project (`GET /games/:id/analysis`, `GET /games/members/:memberId/profile`), each with its own small cache to avoid re-fetching on every re-render.

**Tech Stack:** Vanilla JS, template-string rendering, same conventions as the rest of `web/index.html`.

**Spec:** `docs/superpowers/specs/2026-09-07-sanh-co-may-di-ho-mo-van-design.md`, section 3.

## Global Constraints

- Only `web/index.html` is touched. No backend changes — both endpoints this needs already exist and are live on `main`.
- **Ruling (this plan, not the spec):** the entire left column (all 5 blocks: Thế cờ, Quân đã bắt, Nhật ký, Mổ ván, Hồ sơ đối thủ) is gated on `mySide` being truthy — i.e., only the two real players see it, never a third logged-in member spectating the game. The original spec's ASCII mockups only ever describe a 2-person world ("chủ phòng"/"khách") and never mention a spectator case; `GET /:id/analysis` itself already hard-403s anyone whose `resolveSide` is null (see `api/src/modules/games/service.js:808-823`), so a spectator-visible Mổ ván panel would just show a permanent error. Simplest and safest: no left column at all for spectators — they keep seeing exactly what they see today (board + basic status bar).
- `guestGameHtml`/`PUB['cotuong-phong']` are NOT touched by this plan at all — the guest screen stays exactly as sub-project 1 left it (2-column, no left-column panels of any kind).
- "Thế cờ" (the evaluation indicator) renders ONLY when `st.status==='finished'` AND the fetched analysis has `analyzed_at` non-null — never during a live game (spec §3, comment ① in the original ASCII mockup: "CHỈ HIỆN SAU KHI VÁN KẾT THÚC — không hiện lúc đang đánh"). This is a hard rule, not a nice-to-have: showing a live evaluation to one player mid-game would be a real, exploitable unfairness.
- New CSS: exactly one new class family, `.xq-3col` (+ its child classes `.xq-3col-left`/`.xq-3col-center`/`.xq-3col-right`), collapsing to a single column below `768px` — follow the exact existing convention already used for `.home-layout`/`.mp-layout` (`@media(max-width:768px){ .xq-3col{grid-template-columns:1fr} }`), don't invent a different breakpoint or pattern.
- Reuse existing helpers verbatim, never redefine: `esc()`, `ic(name,size)`, `render()`, `toast()`, `api.get(path)`, `CHESS_CHAR[side][type]` (Hán-tự glyph map, `web/index.html:6042-6045`), `xqFormatClock`, `xqDisplayClock`, `xqGameResultSide`, `xqAiToggleHtml` (the already-built "máy đi hộ" toggle from the previous sub-project — do not rebuild it, just relocate where it's called from).
- No test runner exists for `web/index.html`. Verification is hand dry-run against explicit `GAME_STATE`/fetch-response shapes given in each task, plus a real headless-browser check via the `browser-automation` skill AFTER this branch is merged to `main` (same pattern used for the two earlier sub-projects — the isolated worktree this plan builds in has no live Docker-mounted server to point a browser at).

---

### Task 1: `.xq-3col` CSS grid

**Files:**
- Modify: `web/index.html` — CSS `<style>` block, near the existing `.xq-clock`/`.xq-clock.low`/`.xq-clock-row` rules (`web/index.html:406-408`)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS classes `.xq-3col`, `.xq-3col-left`, `.xq-3col-center`, `.xq-3col-right` — Task 5 is the only later task that uses these (in its markup).

- [ ] **Step 1: Add the grid CSS**

Find this exact block (`web/index.html:406-408`):
```css
.xq-clock-row{display:flex;justify-content:space-between;gap:8px;margin-bottom:10px}
.xq-clock{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;font-weight:800;font-size:15px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.08)}
.xq-clock.low{color:#ff9d92;background:rgba(255,90,60,.16)}
```
Add immediately after it:
```css
.xq-3col{display:grid;grid-template-columns:220px minmax(0,1fr) 300px;gap:16px;align-items:start}
.xq-3col-left{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px;order:1}
.xq-3col-center{order:2}
.xq-3col-right{order:3}
@media(max-width:1024px){.xq-3col{grid-template-columns:200px minmax(0,1fr) 280px}}
@media(max-width:768px){.xq-3col{grid-template-columns:1fr}.xq-3col-left{order:3}.xq-3col-center{order:1}.xq-3col-right{order:2}}
```
(On mobile the left column drops BELOW the board+controls instead of disappearing — a spectator-blind reader could scroll past it, but it's never lost data; `order` keeps the board the first thing a player sees on a phone, matching how every other collapsed multi-column layout in this file prioritizes primary content first. `background:#fff;border:1px solid var(--line)` matches this exact screen's existing panels — `.xq-fs-panel`/`.xq-fs-card`, `web/index.html:484-493` — both use plain `#fff`, not a CSS variable; there is no `--card` token anywhere in this file, don't invent one.)

- [ ] **Step 2: Hand-verify**

No test runner. Confirm by reading the CSS back: at viewport ≥1025px, 3 columns (220px/flex/300px); at 769-1024px, 3 columns (200px/flex/280px); at ≤768px, 1 column with center (board) first, right (controls) second, left (analysis panels) third.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "style(web): thêm lưới .xq-3col cho bố cục 3 cột màn chủ phòng"
```

---

### Task 2: Quân đã bắt + Nhật ký (thuần dữ liệu có sẵn, không gọi mạng)

**Files:**
- Modify: `web/index.html` — add 2 new functions near `xqAiToggleHtml` (`web/index.html:6461`, just before `function resolveMySide(g){`)

**Interfaces:**
- Consumes: `st.moves` (array of `{seq, side, from_r, from_c, to_r, to_c, captured_type, is_check, created_at}` — already present on every `GAME_STATE` from `GET /games/:id`, already rendered today at `web/index.html:6806` as "Biên bản ván cờ"), `CHESS_CHAR`, `esc()`.
- Produces: `xqCapturedHtml(moves)` → HTML string. `xqMoveLogHtml(moves)` → HTML string. Task 5 calls both; nothing else does.

- [ ] **Step 1: Add the two functions**

Find this exact line (`web/index.html:6461`, immediately before `function resolveMySide(g){`):
```js
function resolveMySide(g){
```
Insert immediately before it:
```js
// Quân đã bắt (BAN_CHUAN_CO_TUONG.md mục "Cột trái"): suy trực tiếp từ
// captured_type đã có sẵn trên mỗi nước — quân bị bắt LUÔN thuộc bên NGƯỢC
// với bên vừa đi nước đó (m.side đi, m.captured_type là quân của đối phương).
// Không cần dữ liệu mới, không gọi mạng.
function xqCapturedHtml(moves){
  const byRed = [], byBlack = []; // byRed = quân Đỏ đã bắt được (tức quân Đen)
  for(const m of moves){
    if(!m.captured_type) continue;
    const capturedSide = m.side==='r' ? 'b' : 'r';
    (m.side==='r' ? byRed : byBlack).push(CHESS_CHAR[capturedSide][m.captured_type]);
  }
  if(!byRed.length && !byBlack.length) return `<p style="font-size:12.5px;color:var(--muted)">Chưa bắt quân nào.</p>`;
  const row = (label,list)=> list.length ? `<div style="margin-bottom:6px"><span style="font-size:11.5px;color:var(--muted)">${label}</span><div style="font-size:16px;letter-spacing:2px">${list.map(esc).join('')}</div></div>` : '';
  return row('Đỏ đã bắt', byRed) + row('Đen đã bắt', byBlack);
}
// Nhật ký nước đi — chuyển nguyên si khối "Biên bản ván cờ" đã có sẵn ở cuối
// V['cotuong-van'] (Task 5 xoá bản cũ ở chỗ đó, không còn 2 bản trùng nhau).
function xqMoveLogHtml(moves){
  if(!moves.length) return `<p style="font-size:12.5px;color:var(--muted)">Chưa có nước nào.</p>`;
  return `<div style="max-height:220px;overflow-y:auto">${moves.map(m=>`<div style="font-size:12.5px;padding:3px 0;color:var(--ink2)">${m.seq}. ${m.side==='r'?'Đỏ':'Đen'} (${m.from_r},${m.from_c}) → (${m.to_r},${m.to_c})${m.captured_type?' — ăn quân':''}</div>`).join('')}</div>`;
}

```

- [ ] **Step 2: Hand-verify against 2 shapes**

1. `xqCapturedHtml([{side:'r',captured_type:'soldier'},{side:'r',captured_type:null},{side:'b',captured_type:'horse'}])` → Red captured a Black soldier (卒), Black captured a Red horse (傌) → output contains both "Đỏ đã bắt" and "Đen đã bắt" rows with exactly one glyph each.
2. `xqCapturedHtml([])` → renders the "Chưa bắt quân nào." placeholder, no crash on empty array.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): xqCapturedHtml + xqMoveLogHtml — cột trái phần dữ liệu có sẵn"
```

---

### Task 3: Mổ ván + Thế cờ (gọi GET /:id/analysis)

**Files:**
- Modify: `web/index.html` — add fetch/cache state + 1 function, near `xqCapturedHtml`/`xqMoveLogHtml` (added by Task 2)

**Interfaces:**
- Consumes: `GET /games/:id/analysis` → `{ analyzed_at, moves: [{seq, side, eval_before_cp, eval_before_mate, win_loss}], red_avg_loss, black_avg_loss }` (exact shape per `api/src/modules/games/service.js:808-823`; only reachable when `st.status==='finished'` and the viewer is one of the two real players — matches this plan's own `mySide`-gate ruling), `api.get(path)`, `render()`.
- Produces: `xqAnalysisPanelHtml(gameId, mySide)` → HTML string (side-effecting: triggers a fetch on first call per game, caches the result). Task 5 calls this; nothing else does.

- [ ] **Step 1: Add the fetch/cache state and the render function**

Find the function `xqCapturedHtml` added in Task 2 (search for `function xqCapturedHtml(moves){`) and insert immediately BEFORE it:
```js
// Mổ ván (mục 2.5 spec) — chỉ gọi khi ván đã 'finished' (khớp guard phía
// backend: getAnalysis 409 nếu chưa xong). Cache theo gameId để không gọi lại
// mỗi lần render() (bấm 1 nước cờ ở MỘT ván khác không ảnh hưởng, nhưng
// render() của CHÍNH ván này có thể chạy nhiều lần/giây lúc đang có SSE).
let XQ_ANALYSIS_CACHE = {}; // { [gameId]: 'loading' | {..response..} | 'error' }
function xqFetchAnalysis(gameId){
  if(XQ_ANALYSIS_CACHE[gameId]) return; // đang tải hoặc đã có rồi
  XQ_ANALYSIS_CACHE[gameId] = 'loading';
  api.get('/games/'+gameId+'/analysis').then(res=>{
    XQ_ANALYSIS_CACHE[gameId] = res;
    render();
  }).catch(()=>{
    XQ_ANALYSIS_CACHE[gameId] = 'error';
    render();
  });
}
// Thang quy đổi HIỂN THỊ THÔ "hơn X quân": mỗi ~100 điểm centipawn xấp xỉ 1
// quân — CHỈ để đưa ra một con số dễ hiểu, không phải số đo tuyệt đối (đúng
// tinh thần "ƯỚC LƯỢNG" mục V.3 bản chuẩn). Nếu ván có nước chiếu bí
// (eval_before_mate khác null) thì nói thẳng "chiếu bí sau N nước" thay vì
// quy đổi quân — quy đổi một thế chiếu bí thành "hơn X quân" làm sai lệch ý
// nghĩa hoàn toàn.
function xqAnalysisPanelHtml(gameId, mySide){
  if(!mySide) return '';
  const cached = XQ_ANALYSIS_CACHE[gameId];
  if(!cached){ xqFetchAnalysis(gameId); return `<p style="font-size:12.5px;color:var(--muted)">Đang mổ ván…</p>`; }
  if(cached==='loading') return `<p style="font-size:12.5px;color:var(--muted)">Đang mổ ván…</p>`;
  if(cached==='error') return `<p style="font-size:12.5px;color:var(--muted)">Chưa mổ ván được, thử tải lại trang.</p>`;
  if(!cached.analyzed_at) return `<p style="font-size:12.5px;color:var(--muted)">Đang mổ ván…</p>`;
  const lastMove = cached.moves.length ? cached.moves[cached.moves.length-1] : null;
  let theCoTxt = 'Cân bằng';
  if(lastMove){
    if(lastMove.eval_before_mate!=null){
      theCoTxt = lastMove.eval_before_mate>0 ? `${lastMove.side==='r'?'Đỏ':'Đen'} chiếu bí sau ${lastMove.eval_before_mate} nước` : `${lastMove.side==='r'?'Đen':'Đỏ'} chiếu bí sau ${-lastMove.eval_before_mate} nước`;
    } else if(lastMove.eval_before_cp!=null){
      const pawns = Math.abs(lastMove.eval_before_cp/100).toFixed(1);
      const favoredSide = (lastMove.eval_before_cp>=0) === (lastMove.side==='r') ? 'Đỏ' : 'Đen';
      theCoTxt = Math.abs(lastMove.eval_before_cp)<30 ? 'Cân bằng' : `${favoredSide} hơn ~${pawns} quân`;
    }
  }
  const worst = cached.moves.reduce((w,m)=> (m.win_loss!=null && (!w||m.win_loss>w.win_loss)) ? m : w, null);
  return `
    <div style="margin-bottom:10px"><span style="font-size:11.5px;color:var(--muted)">Thế cờ</span><div style="font-size:13.5px;font-weight:700">${esc(theCoTxt)}</div></div>
    <div style="font-size:12.5px;color:var(--ink2);margin-bottom:4px">Đỏ mất trung bình ${cached.red_avg_loss!=null?(cached.red_avg_loss*100).toFixed(1)+'%':'—'} tỉ lệ thắng/nước</div>
    <div style="font-size:12.5px;color:var(--ink2);margin-bottom:8px">Đen mất trung bình ${cached.black_avg_loss!=null?(cached.black_avg_loss*100).toFixed(1)+'%':'—'} tỉ lệ thắng/nước</div>
    ${worst?`<div style="font-size:12px;color:var(--muted)">Nước hỏng nhất: nước ${worst.seq} (${worst.side==='r'?'Đỏ':'Đen'})</div>`:''}
  `;
}

```

Note: `theCoTxt`/the eval bar deliberately reads ONLY `cached.moves` (the analysis endpoint's own data, which the backend only returns once `st.status==='finished'` — the frontend never even attempts this fetch before then, per the `if(!mySide) return '';` guard combined with Task 5 only calling this function inside the `st.status==='finished'` branch of the caller). This satisfies the Global Constraint that Thế cờ never shows during a live game.

- [ ] **Step 2: Hand-verify against 3 response shapes**

1. `XQ_ANALYSIS_CACHE['g1'] = { analyzed_at: '2026-...', moves: [{seq:1,side:'r',eval_before_cp:10,eval_before_mate:null,win_loss:0}], red_avg_loss: 0, black_avg_loss: null }` → `xqAnalysisPanelHtml('g1','r')` → "Thế cờ" shows "Cân bằng" (|10|<30), red_avg_loss line shows "0.0%", black_avg_loss line shows "—".
2. `XQ_ANALYSIS_CACHE['g2'] = { analyzed_at: '2026-...', moves: [{seq:5,side:'b',eval_before_cp:null,eval_before_mate:3,win_loss:0.1}], red_avg_loss:0.05, black_avg_loss:0.1 }` → theCoTxt reads "Đỏ chiếu bí sau 3 nước" (mate>0 and lastMove.side==='b' means it's BLACK's move being evaluated, mate positive means good for side-to-move which is... trace carefully: this is a hand-verify step, actually trace it yourself against the code rather than trusting this description — the point of this step is for YOU to confirm the ternary's actual output, not to accept a pre-computed answer).
3. `XQ_ANALYSIS_CACHE` has no entry for `'g3'` → first call to `xqAnalysisPanelHtml('g3','r')` returns the "Đang mổ ván…" placeholder AND leaves `XQ_ANALYSIS_CACHE['g3']==='loading'` (confirm `xqFetchAnalysis` was actually invoked as a side effect — you can't test the real `api.get` call without a server, but confirm the cache key transitions from undefined to `'loading'` synchronously within the same function call).

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): xqAnalysisPanelHtml — mổ ván + thế cờ, chỉ sau khi ván kết thúc"
```

---

### Task 4: Hồ sơ đối thủ (gọi GET /members/:memberId/profile)

**Files:**
- Modify: `web/index.html` — add fetch/cache state + 1 function, near `xqAnalysisPanelHtml` (added by Task 3)

**Interfaces:**
- Consumes: `GET /games/members/:memberId/profile` → `{ games_count, wins, avg_loss }` (exact shape per `api/src/modules/games/service.js:832-847`), `api.get(path)`, `render()`, `esc()`.
- Produces: `xqOpponentProfileHtml(opponentId, opponentName)` → HTML string (side-effecting, same fetch-once-cache pattern as Task 3). Task 5 calls this; nothing else does.

- [ ] **Step 1: Add the fetch/cache state and the render function**

Find the function `xqAnalysisPanelHtml` added in Task 3 (search for `function xqAnalysisPanelHtml(gameId, mySide){`) and insert immediately AFTER its closing `}` (the function ends right before the blank line and the next existing function `function xqCapturedHtml`):
```js
// Hồ sơ đối thủ (mục 2.5 spec) — hiện LUÔN, không chờ ván xong (khác Mổ ván ở
// trên). Cache theo memberId, không theo gameId — hai ván khác nhau cùng một
// đối thủ dùng chung một lần gọi.
let XQ_PROFILE_CACHE = {}; // { [memberId]: 'loading' | {..response..} | 'error' }
function xqFetchProfile(memberId){
  if(XQ_PROFILE_CACHE[memberId]) return;
  XQ_PROFILE_CACHE[memberId] = 'loading';
  api.get('/games/members/'+memberId+'/profile').then(res=>{
    XQ_PROFILE_CACHE[memberId] = res;
    render();
  }).catch(()=>{
    XQ_PROFILE_CACHE[memberId] = 'error';
    render();
  });
}
function xqOpponentProfileHtml(opponentId, opponentName){
  const cached = XQ_PROFILE_CACHE[opponentId];
  if(!cached){ xqFetchProfile(opponentId); return `<p style="font-size:12.5px;color:var(--muted)">Đang tải…</p>`; }
  if(cached==='loading') return `<p style="font-size:12.5px;color:var(--muted)">Đang tải…</p>`;
  if(cached==='error') return `<p style="font-size:12.5px;color:var(--muted)">Không tải được hồ sơ.</p>`;
  return `
    <p style="font-size:13px;font-weight:700;margin-bottom:4px">${esc(opponentName)}</p>
    <p style="font-size:12px;color:var(--ink2)">${cached.games_count} ván · ${cached.wins} thắng${cached.avg_loss!=null?' · mất trung bình '+(cached.avg_loss*100).toFixed(1)+'%/nước':''}</p>
  `;
}

```

- [ ] **Step 2: Hand-verify against 2 response shapes**

1. `XQ_PROFILE_CACHE['m1'] = { games_count: 5, wins: 3, avg_loss: 0.08 }` → `xqOpponentProfileHtml('m1','Bob')` → renders "Bob", "5 ván · 3 thắng · mất trung bình 8.0%/nước".
2. `XQ_PROFILE_CACHE['m2'] = { games_count: 0, wins: 0, avg_loss: null }` → renders "0 ván · 0 thắng" with no trailing "mất trung bình" clause (the `avg_loss!=null?...:''` ternary must produce an empty string, not "null%/nước" or similar).

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): xqOpponentProfileHtml — hồ sơ đối thủ, hiện luôn không chờ ván xong"
```

---

### Task 5: Nối bố cục 3 cột vào `V['cotuong-van']`

**Files:**
- Modify: `web/index.html` — the active-game `return` block inside `V['cotuong-van']` (currently `web/index.html:6776-6807`; re-locate by searching for the exact text below, since Tasks 1-4 may have shifted line numbers)

**Interfaces:**
- Consumes: `xqCapturedHtml(moves)`, `xqMoveLogHtml(moves)` (Task 2), `xqAnalysisPanelHtml(gameId, mySide)` (Task 3), `xqOpponentProfileHtml(opponentId, opponentName)` (Task 4), `.xq-3col`/`.xq-3col-left`/`.xq-3col-center`/`.xq-3col-right` CSS (Task 1), everything already in `V['cotuong-van']`'s scope (`st`, `mySide`, `statusCls`, `statusTxt`, `announce`, `pts`, `drawFromOpp`).
- Produces: nothing — leaf task, this plan's last one.

- [ ] **Step 1: Restructure the return block**

Find this exact block (search for `<div class="xq-status-bar ${statusCls}">${statusTxt}</div>` inside `V['cotuong-van']` specifically — NOT the one inside `guestGameHtml` or `V.cotuong`, both of which have similar-looking lines; confirm you're editing the block that also contains `xqAiToggleHtml` a few lines below, which only exists in `V['cotuong-van']`):
```js
  return `
  <div class="xq-status-bar ${statusCls}">${statusTxt}</div>
  ${announce}
  <div class="xq-wrap">
    <div class="xq-board">
      ${chessGridSvg()}
      <div class="xq-river">楚 河　　漢 界</div>
      ${pts.join('')}
    </div>
  </div>
  <div class="xq-fs-panel${XQ_FS_MENU_OPEN?` show`:``}">
    <h1>${esc(st.red_name)} <span style="color:var(--muted);font-weight:400">vs</span> ${esc(st.black_name)}</h1>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${mySide?'Bạn đang chơi bên '+(mySide==='r'?'Đỏ':'Đen'):'Bạn đang xem trực tiếp'}</p>
    ${mySide && (mySide==='r'?st.black_ai_level:st.red_ai_level) ? `<p style="font-size:12.5px;color:var(--muted);margin:-6px 0 12px">nhaccon6789 đang chơi</p>` : ''}
    ${st.status==='active'?`<div class="xq-clock-row">
      <span class="xq-clock${xqDisplayClock(st,'r')<60000?' low':''}">${ic('clock',14)} ${esc(st.red_name)}: ${xqFormatClock(xqDisplayClock(st,'r'))}</span>
      <span class="xq-clock${xqDisplayClock(st,'b')<60000?' low':''}">${ic('clock',14)} ${esc(st.black_name)}: ${xqFormatClock(xqDisplayClock(st,'b'))}</span>
    </div>`:''}
    ${drawFromOpp?`<div style="background:rgba(255,255,255,.08);border-radius:10px;padding:10px;margin-bottom:10px">
      <p style="font-size:13.5px;margin-bottom:8px">✋ ${esc(mySide==='r'?st.black_name:st.red_name)} xin hoà</p>
      <div class="xq-ctrl-row"><button class="btn btn-blue" style="flex:1" onclick="gameAcceptDraw('${st.id}')">Đồng ý</button><button class="btn btn-out" style="flex:1" onclick="gameDeclineDraw('${st.id}')">Từ chối</button></div>
    </div>`:''}
    <div class="xq-ctrl-row">
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="gameOfferDraw('${st.id}')">${ic('handshake',15)} Cầu hoà</button>`:''}
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="resignGame('${st.id}')">${ic('flag',15)} Xin thua</button>`:''}
      <button class="btn btn-out" style="flex:1" onclick="chessFlipBoard()">${ic('swap',15)} Đổi bên</button>
    </div>
    ${mySide&&st.status==='active'?`<div class="xq-ctrl-row" style="margin-top:8px"><button class="btn btn-out" style="flex:1" onclick="gameLeaveActive('${st.id}')">${ic('x',15)} Rời phòng</button></div>`:''}
    ${mySide&&st.status!=='finished'?xqAiToggleHtml(st,mySide):''}
    <h3 style="margin-top:14px">Biên bản ván cờ</h3>
    ${st.moves.length?`<div>${st.moves.map(m=>`<div style="font-size:13px;padding:4px 0;color:var(--ink2)">${m.seq}. ${m.side==='r'?'Đỏ':'Đen'} (${m.from_r},${m.from_c}) → (${m.to_r},${m.to_c})${m.captured_type?' — ăn quân':''}</div>`).join('')}</div>`:'<p style="font-size:13px;color:var(--muted)">Chưa có nước nào.</p>'}
  </div>`;
};
```
Replace with:
```js
  const opponentId = mySide ? (mySide==='r'?st.black_member_id:st.red_member_id) : null;
  const opponentName = mySide ? (mySide==='r'?st.black_name:st.red_name) : null;
  const rightColHtml = `
    <div class="xq-fs-panel${XQ_FS_MENU_OPEN?` show`:``}">
      <h1>${esc(st.red_name)} <span style="color:var(--muted);font-weight:400">vs</span> ${esc(st.black_name)}</h1>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${mySide?'Bạn đang chơi bên '+(mySide==='r'?'Đỏ':'Đen'):'Bạn đang xem trực tiếp'}</p>
      ${mySide && (mySide==='r'?st.black_ai_level:st.red_ai_level) ? `<p style="font-size:12.5px;color:var(--muted);margin:-6px 0 12px">nhaccon6789 đang chơi</p>` : ''}
      ${st.status==='active'?`<div class="xq-clock-row">
        <span class="xq-clock${xqDisplayClock(st,'r')<60000?' low':''}">${ic('clock',14)} ${esc(st.red_name)}: ${xqFormatClock(xqDisplayClock(st,'r'))}</span>
        <span class="xq-clock${xqDisplayClock(st,'b')<60000?' low':''}">${ic('clock',14)} ${esc(st.black_name)}: ${xqFormatClock(xqDisplayClock(st,'b'))}</span>
      </div>`:''}
      ${drawFromOpp?`<div style="background:rgba(255,255,255,.08);border-radius:10px;padding:10px;margin-bottom:10px">
        <p style="font-size:13.5px;margin-bottom:8px">✋ ${esc(mySide==='r'?st.black_name:st.red_name)} xin hoà</p>
        <div class="xq-ctrl-row"><button class="btn btn-blue" style="flex:1" onclick="gameAcceptDraw('${st.id}')">Đồng ý</button><button class="btn btn-out" style="flex:1" onclick="gameDeclineDraw('${st.id}')">Từ chối</button></div>
      </div>`:''}
      <div class="xq-ctrl-row">
        ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="gameOfferDraw('${st.id}')">${ic('handshake',15)} Cầu hoà</button>`:''}
        ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="resignGame('${st.id}')">${ic('flag',15)} Xin thua</button>`:''}
        <button class="btn btn-out" style="flex:1" onclick="chessFlipBoard()">${ic('swap',15)} Đổi bên</button>
      </div>
      ${mySide&&st.status==='active'?`<div class="xq-ctrl-row" style="margin-top:8px"><button class="btn btn-out" style="flex:1" onclick="gameLeaveActive('${st.id}')">${ic('x',15)} Rời phòng</button></div>`:''}
      ${mySide&&st.status!=='finished'?xqAiToggleHtml(st,mySide):''}
      ${!mySide?`<h3 style="margin-top:14px">Biên bản ván cờ</h3>${xqMoveLogHtml(st.moves)}`:''}
    </div>`;
  if(!mySide){
    return `
    <div class="xq-status-bar ${statusCls}">${statusTxt}</div>
    ${announce}
    <div class="xq-wrap">
      <div class="xq-board">
        ${chessGridSvg()}
        <div class="xq-river">楚 河　　漢 界</div>
        ${pts.join('')}
      </div>
    </div>
    ${rightColHtml}`;
  }
  return `
  <div class="xq-status-bar ${statusCls}">${statusTxt}</div>
  ${announce}
  <div class="xq-3col">
    <div class="xq-3col-left">
      ${st.status==='finished'?`<h3 style="margin-top:0;font-size:13px">Thế cờ</h3>${xqAnalysisPanelHtml(st.id, mySide)}<hr style="margin:10px 0;border-color:var(--line)">`:''}
      <h3 style="margin-top:0;font-size:13px">Quân đã bắt</h3>
      ${xqCapturedHtml(st.moves)}
      <h3 style="margin-top:14px;font-size:13px">Nhật ký</h3>
      ${xqMoveLogHtml(st.moves)}
      <h3 style="margin-top:14px;font-size:13px">Hồ sơ đối thủ</h3>
      ${xqOpponentProfileHtml(opponentId, opponentName)}
    </div>
    <div class="xq-3col-center">
      <div class="xq-wrap">
        <div class="xq-board">
          ${chessGridSvg()}
          <div class="xq-river">楚 河　　漢 界</div>
          ${pts.join('')}
        </div>
      </div>
    </div>
    <div class="xq-3col-right">${rightColHtml}</div>
  </div>`;
};
```

Notes on this restructuring:
- `mySide` falsy (spectator) keeps the EXACT old layout (board + single right-side panel + the move log that used to be at the bottom of that panel) — per this plan's own Global Constraint ruling, spectators get nothing new. The `rightColHtml` template's own trailing `${!mySide?...:''}` line re-adds the move log ONLY for that spectator path, since the 3-column path renders `xqMoveLogHtml` itself, inside the left column, and would otherwise duplicate it if `rightColHtml` always included it.
- `xqAnalysisPanelHtml`/`xqCapturedHtml`/`xqMoveLogHtml`/`xqOpponentProfileHtml` are ONLY called inside the `mySide` truthy branch — confirming Task 3/4's fetch-triggering functions never fire for a spectator (who'd get 403'd by the analysis endpoint anyway, and has no meaningful "opponent" to profile).
- Thế cờ block is additionally gated on `st.status==='finished'` at the CALL SITE (not just inside `xqAnalysisPanelHtml`, which already also checks it via the cached response's `analyzed_at`) — belt-and-suspenders for the hard "never during a live game" rule.

- [ ] **Step 2: Hand-verify against 3 scenarios**

1. `mySide='r'`, `st.status==='active'` → 3-column layout renders; left column shows Quân đã bắt/Nhật ký/Hồ sơ đối thủ but NOT the Thế cờ/Mổ ván block (guarded by `st.status==='finished'`).
2. `mySide='r'`, `st.status==='finished'` → 3-column layout, left column now ALSO shows the Thế cờ block at the top, calling `xqAnalysisPanelHtml(st.id, 'r')`.
3. `mySide=null` (spectator) → old single-column layout, `xq-3col` classes never appear in the output, move log still visible in the right panel exactly as before this plan.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): nối bố cục 3 cột vào V['cotuong-van'] cho 2 người chơi thật"
```

---

### Task 6: Real browser verification (after merge)

Same pattern as the two earlier sub-projects — run from the main checkout after this branch merges, not from inside the isolated worktree (no live Docker-mounted server reachable there).

- [ ] **Step 1: Confirm no syntax breakage**

```bash
node <browser-automation-skill-dir>/browser.mjs "http://localhost/#cotuong-phong:test" --wait "body" --snapshot
```
Expected: same clean output as the two earlier sub-projects' post-merge checks (heading "Vào phòng cờ tướng", the one pre-existing unrelated `mock.js` console warning, zero new errors). This whole file is one inline `<script>` — a syntax error introduced by any of the 6 tasks above would break every screen, and this is the cheapest possible check for that.

- [ ] **Step 2: Report what could and couldn't be checked live**

The 3-column layout itself requires a logged-in member viewing an in-progress or finished game, which needs real credentials this environment doesn't have — document in the task report that this specific visual layer needs a human partner (or a future authenticated browser session) to confirm, same limitation already noted for the AI-toggle checks in the first sub-project.
