# Giao diện Phòng & Khách cho Cờ Tướng (Gen 2) — Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lộ backend "phòng cờ" Cờ Tướng (đã gộp vào `main`, commit `087aa22`) qua giao diện web: chủ phòng tạo phòng/chơi (mở rộng `V['cotuong-van']` sẵn có), khách vào bằng link không cần tài khoản (màn mới `PUB['cotuong-phong']`).

**Architecture:** Một bộ máy trạng thái ván đấu DÙNG CHUNG (`GAME_STATE`/`loadGame`/`gameCellClick`/`resignGame`/`connectGameStream`, vốn đã có cho chủ phòng) được tổng quát hoá để chạy được cho cả khách — mỗi lời gọi mạng rẽ nhánh `DATA.me ? api.xxx(...) : guestFetch(...)`. Không có framework/build step; sửa trực tiếp `web/index.html`, thấy ngay khi tải lại `http://localhost` (dev stack Docker đã chạy sẵn, `./web` mount `:ro` vào Caddy).

**Tech Stack:** JS thuần (không framework), HTML template string, CSS thuần trong `<style>`, `fetch`/`EventSource`, `localStorage`. Backend: Express + PostgreSQL (không đổi gì ở đây).

**Spec:** `docs/superpowers/specs/2026-09-07-cotuong-phong-khach-ui-design.md`

## Global Constraints

- Không sửa `web/js/api.js` hay bất kỳ file phía `api/` — toàn bộ endpoint đã có sẵn.
- Khách gọi mạng CHỈ qua `guestFetch` (Task 2) — không bao giờ qua `window.api`, kể cả lời gọi vào-phòng đầu tiên (chưa có token) dùng `guestFetch(..., null)` để tường minh "không gắn Authorization".
- Không tạo class CSS mới ngoài `.xq-clock`/`.xq-clock.low`/`.xq-clock-row` (Task 1). Bố cục khác dùng lại `.xq-fs-card`, `.xq-ctrl-row`, `.xq-announce`/`xqAnnounceHtml()`, `.xq-fs-panel`, hoặc inline style theo đúng mẫu ô mã mời ở dòng 3869 của `web/index.html`.
- Chủ phòng luôn là Đỏ (`red_member_id`), khách luôn là Đen (`black_guest_name`/`black_guest_token`) — không xử lý trường hợp khác.
- `red_time_ms`/`black_time_ms`/`draw_offered_by`/`disconnected_side` áp dụng cho MỌI ván đang `active`, không riêng ván phòng — vì vậy panel đồng hồ/cầu hoà/mất kết nối (Task 5) sửa đúng MỘT view function dùng chung cho cả ván thách đấu (Gen 1) lẫn ván phòng (Gen 2).
- `winner_member_id` là NULL cả khi hoà (`end_reason==='hoa-thoa-thuan'`) LẪN khi khách (không có member id) thắng — hai trường hợp này PHẢI phân biệt bằng `end_reason`, không được coi NULL là "Đen thắng" như code cũ đang làm (xem `xqGameResultSide` ở Task 2 và điểm sửa ở Task 5).
- Không có test runner cho `web/index.html`. Dev stack đã chạy (`nhachung-proxy-1` cổng 80, `nhachung-api-1` healthy) — mọi bước "test" trong kế hoạch này là thao tác tay tại `http://localhost`, tải lại trang sau mỗi sửa file, không cần build/restart.
- Toàn bộ chữ hiển thị bằng tiếng Việt, đúng văn phong hiện có; không dùng thương hiệu "Chủ Công"/"nhaccon6789"/"TingTingVác" từ tài liệu tham khảo.

---

### Task 1: CSS cho đồng hồ đếm ngược

**Files:**
- Modify: `web/index.html:405` (trong khối `<style>`)

**Interfaces:**
- Produces: class `.xq-clock`, `.xq-clock.low`, `.xq-clock-row` — dùng bởi Task 5, Task 7.

- [ ] **Step 1: Thêm CSS ngay sau dòng `.xq-ctrl-row>.btn{flex:1 1 120px}` (dòng 405)**

```css
.xq-clock-row{display:flex;justify-content:space-between;gap:8px;margin-bottom:10px}
.xq-clock{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;font-weight:800;font-size:15px;padding:4px 10px;border-radius:8px;background:rgba(255,255,255,.08)}
.xq-clock.low{color:#ff9d92;background:rgba(255,90,60,.16)}
```

- [ ] **Step 2: Kiểm tra thủ công**

Mở `http://localhost`, đăng nhập một tài khoản bất kỳ, mở DevTools Console — không có lỗi CSS/parse nào xuất hiện. Chưa có gì dùng các class này nên không có thay đổi hình ảnh ở bước này — chỉ xác nhận trang vẫn tải bình thường.

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "style(web): thêm class đồng hồ đếm ngược cho ván cờ tướng"
```

---

### Task 2: Hàm dùng chung — trạng thái phòng, đồng hồ, phiên khách, client khách

**Files:**
- Modify: `web/index.html` — chèn ngay sau khi kết thúc hàm `resignGame` hiện có (dòng 6205: dấu `}` đóng hàm), TRƯỚC dòng `V['cotuong-van'] = (params)=>{` (dòng 6207).

**Interfaces:**
- Produces:
  - `xqRoomPhase(g)` → `'cho-doi-thu'|'du-nguoi'|'cho-ben-kia'|'dang-dau'|null`
  - `xqFormatClock(ms)` → chuỗi `"mm:ss"`
  - `xqDisplayClock(st, side)` → số mili-giây còn lại ĐÃ trừ thời gian trôi qua nếu đang tới lượt `side` (side là `'r'`/`'b'`)
  - `xqGameResultSide(st)` → `'r'|'b'|null` (null = hoà) — chỉ gọi khi `st.status==='finished'`
  - `resolveMySide(g)` → `'r'|'b'|null`
  - `GUEST_TOKEN`, `GUEST_INVITE_TOKEN` (globals, khởi tạo `null`)
  - `saveGuestSession(inviteToken, data)`, `loadGuestSession(inviteToken)`, `clearGuestSession(inviteToken)`
  - `guestFetch(method, path, body, tokenOverride)` — bỏ qua `tokenOverride` để dùng `GUEST_TOKEN`; truyền `null` tường minh để gọi KHÔNG có header `Authorization` (chỉ dùng cho lời gọi vào-phòng đầu tiên ở Task 6).
  - `GAME_CLOCK_TIMER` (global), `stopGameClock()`, `maybeStartGameClock(status)`, `gameClockTick()` — Task 3 gọi các hàm này tại đúng điểm chuyển trạng thái của `loadGame`/SSE.
- Consumes: `api.baseUrl()`, `api.messageFor(code)` (cả hai đã export sẵn trong `web/js/api.js`).

- [ ] **Step 1: Thêm khối hàm dùng chung**

```js
/* ---------- Phòng cờ (Gen 2): trạng thái, đồng hồ, phiên khách ----------
   Dùng chung cho cả V['cotuong-van'] (chủ phòng) và PUB['cotuong-phong']
   (khách). Không có cột trạng thái phòng riêng trong CSDL — suy ra từ
   status/second_joined_at/red_ready_at/black_ready_at, xem mục 6 spec
   2026-09-07-cotuong-phong-khach-ui-design.md. ══════════════════════ */
function xqRoomPhase(g){
  if(!g || g.error) return null;
  if(g.status==='active') return 'dang-dau';
  if(g.status!=='pending') return null; // finished hoặc trạng thái khác: không phải máy trạng thái phòng
  if(!g.second_joined_at) return 'cho-doi-thu';
  if(!g.red_ready_at && !g.black_ready_at) return 'du-nguoi';
  return 'cho-ben-kia';
}
function xqFormatClock(ms){
  const s = Math.max(0, Math.round(ms/1000));
  return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
}
// Mô phỏng lại ĐÚNG công thức computeRemainingMs() phía server
// (api/src/modules/games/service.js) chỉ để hiện đếm mượt giữa hai lần đồng
// bộ — server vẫn là nguồn sự thật duy nhất cho việc kết thúc ván vì hết giờ.
function xqDisplayClock(st, side){
  const raw = side==='r' ? st.red_time_ms : st.black_time_ms;
  if(st.status!=='active' || !st.turn_started_at || st.disconnected_side || st.turn!==side) return raw;
  const elapsed = Date.now() - new Date(st.turn_started_at).getTime();
  return Math.max(0, raw - elapsed);
}
// winner_member_id là NULL cả khi hoà LẪN khi khách (không có member id)
// thắng — hai trường hợp phải tách bằng end_reason. Chỉ gọi khi
// st.status==='finished'.
function xqGameResultSide(st){
  if(st.end_reason==='hoa-thoa-thuan') return null;
  if(!st.winner_member_id) return 'b'; // thắng mà không có member id ⇒ chắc chắn là khách (luôn Đen)
  return st.winner_member_id===st.red_member_id ? 'r' : 'b';
}
function resolveMySide(g){
  if(!g) return null;
  if(DATA.me){
    if(g.red_member_id===DATA.me.id) return 'r';
    if(g.black_member_id===DATA.me.id) return 'b';
  }
  return GUEST_TOKEN ? 'b' : null;
}

let GUEST_TOKEN = null, GUEST_INVITE_TOKEN = null;
function guestSessionKey(inviteToken){ return 'xq_guest_'+inviteToken; }
function saveGuestSession(inviteToken, data){
  try{ localStorage.setItem(guestSessionKey(inviteToken), JSON.stringify(data)); }catch(e){}
}
function loadGuestSession(inviteToken){
  try{ const raw = localStorage.getItem(guestSessionKey(inviteToken)); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}
function clearGuestSession(inviteToken){
  try{ localStorage.removeItem(guestSessionKey(inviteToken)); }catch(e){}
}

// Client cho khách — KHÔNG qua window.api: token khách không có refresh,
// không gắn phiên đăng nhập (xem mục 9 spec thiết kế). Cùng khuôn lỗi với
// api.js (server trả {error:{code,message,fields}}) và dùng lại đúng
// api.messageFor() để hai đường không lệch câu chữ hiển thị.
function guestFetch(method, path, body, tokenOverride){
  const token = tokenOverride!==undefined ? tokenOverride : GUEST_TOKEN;
  const headers = {};
  if(token) headers['authorization'] = 'Bearer '+token;
  if(body!==undefined) headers['content-type'] = 'application/json';
  return fetch(api.baseUrl()+path, {method, headers, body: body===undefined?undefined:JSON.stringify(body)})
    .catch(()=>{ throw new Error(api.messageFor('NETWORK')); })
    .then(res=>{
      if(res.status===204) return null;
      return res.json().catch(()=>null).then(data=>{
        if(res.ok) return data;
        const code = (data && data.error && data.error.code) || 'INTERNAL';
        const err = new Error(api.messageFor(code));
        err.code = code; err.status = res.status;
        throw err;
      });
    });
}

// Đếm giây cục bộ khi ván đang active — chỉ để UI mượt, KHÔNG tự kết thúc
// ván (việc đó server quyết định qua /timeout, được Task 5 gọi khi hết giờ).
// Tick mỗi giây còn kiêm việc tự gọi /disconnect-timeout khi đối thủ mất
// kết nối đã quá 60 giây (mục 6 spec). gameClaimDisconnectTimeout() do
// Task 5 định nghĩa — khai báo bằng `function` nên thứ tự trong file không
// quan trọng (hoisting).
let GAME_CLOCK_TIMER = null;
function stopGameClock(){ if(GAME_CLOCK_TIMER){ clearInterval(GAME_CLOCK_TIMER); GAME_CLOCK_TIMER=null; } }
function gameClockTick(){
  if(GAME_STATE && GAME_STATE.disconnected_side){
    const elapsed = Date.now() - new Date(GAME_STATE.disconnected_at).getTime();
    if(elapsed>=60000) gameClaimDisconnectTimeout(GAME_STATE.id);
  }
  render();
}
function maybeStartGameClock(status){
  stopGameClock();
  if(status==='active') GAME_CLOCK_TIMER = setInterval(gameClockTick, 1000);
}

// Polling trong lúc phòng còn 'pending' — ready()/joinRoom() không bắn sự
// kiện SSE cho "khách vừa vào"/"một bên vừa bấm sẵn sàng lần đầu" (rà
// publishToGame() trong api/src/modules/games/service.js xác nhận điều
// này; ghi trong backlog theo dõi của nhánh Kernel, không sửa ở đây). Dừng
// tự động ngay khi phase không còn là trạng thái phòng nữa.
let ROOM_POLL_TIMER = null;
function stopRoomPoll(){ if(ROOM_POLL_TIMER){ clearInterval(ROOM_POLL_TIMER); ROOM_POLL_TIMER=null; } }
function startRoomPoll(id){
  stopRoomPoll();
  ROOM_POLL_TIMER = setInterval(()=>{
    if(GAME_STATE_ID!==id){ stopRoomPoll(); return; }
    const req = DATA.me ? api.get('/games/'+id) : guestFetch('GET', '/games/'+id);
    req.then(g=>{
      if(GAME_STATE_ID!==id) return;
      GAME_STATE=g;
      const phase = xqRoomPhase(g);
      if(phase!=='cho-doi-thu' && phase!=='du-nguoi' && phase!=='cho-ben-kia') stopRoomPoll();
      render();
    }).catch(()=>{});
  }, 3000);
}
```

- [ ] **Step 2: Kiểm tra thủ công qua Console**

Tải lại `http://localhost`, mở DevTools Console, chạy lần lượt:
- `xqFormatClock(65000)` → phải trả về `"01:05"`
- `xqRoomPhase({status:'active'})` → `'dang-dau'`
- `xqRoomPhase({status:'pending', second_joined_at:null})` → `'cho-doi-thu'`
- `xqRoomPhase({status:'pending', second_joined_at:'2026-01-01', red_ready_at:null, black_ready_at:null})` → `'du-nguoi'`
- `xqGameResultSide({end_reason:'hoa-thoa-thuan'})` → `null`
- `xqGameResultSide({winner_member_id:null, end_reason:'resign'})` → `'b'`
- `typeof guestFetch==='function'` → `true`

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm hàm dùng chung cho trạng thái phòng, đồng hồ, phiên khách"
```

---

### Task 3: Tổng quát hoá bộ máy ván đấu để chạy được cho cả khách

**Files:**
- Modify: `web/index.html:6115-6206` (khối `GAME_STATE`/`connectGameStream`/`loadGame`/`gameCellClick`/`resignGame`)

**Interfaces:**
- Consumes: `resolveMySide`, `guestFetch`, `xqRoomPhase`, `maybeStartGameClock`, `stopGameClock`, `startRoomPoll`, `stopRoomPoll` (Task 2).
- Produces: `loadGame(id)`, `gameCellClick(r,c)`, `resignGame(id)`, `connectGameStream(id)`, `stopGameStream()` — nay chạy đúng cho cả `DATA.me` (chủ phòng/thành viên) lẫn `GUEST_TOKEN` (khách). Task 4/5/6/7 gọi thẳng các hàm này, không viết bản khách riêng.

- [ ] **Step 1: Sửa `stopGameStream()` (dòng 6119-6124) — dọn thêm 2 timer mới**

```js
function stopGameStream(){
  if(GAME_EVENTSOURCE){ GAME_EVENTSOURCE.close(); GAME_EVENTSOURCE=null; }
  GAME_STATE=null; GAME_STATE_ID=null; GAME_SELECTED=null; GAME_LEGAL=[];
  GAME_STREAM_RETRIES=0;
  GAMES_LIST=null;
  stopGameClock();
  stopRoomPoll();
}
```

- [ ] **Step 2: Sửa dòng lấy token trong `connectGameStream()` (dòng 6127)**

Thay:
```js
  const token = api.accessToken(); if(!token) return;
```
bằng:
```js
  const token = DATA.me ? api.accessToken() : GUEST_TOKEN; if(!token) return;
```

- [ ] **Step 3: Thêm `maybeStartGameClock('active')`/`stopGameClock()` vào 2 listener SSE đã có (dòng 6130-6134 và 6142-6150)**

`game_start` listener — thêm 1 dòng:
```js
  GAME_EVENTSOURCE.addEventListener('game_start', e=>{
    const d = JSON.parse(e.data);
    if(GAME_STATE){ GAME_STATE.board=d.board; GAME_STATE.turn=d.turn; GAME_STATE.status='active'; }
    maybeStartGameClock('active');
    render();
  });
```

`game_end` listener — thêm 1 dòng:
```js
  GAME_EVENTSOURCE.addEventListener('game_end', e=>{
    const d = JSON.parse(e.data);
    if(GAME_STATE){
      GAME_STATE.status='finished'; GAME_STATE.end_reason=d.reason;
      GAME_STATE.winner_member_id = d.winner ? (d.winner==='r'?GAME_STATE.red_member_id:GAME_STATE.black_member_id) : null;
    }
    stopGameClock();
    chessSound('end');
    render();
  });
```

- [ ] **Step 4: Sửa `loadGame(id)` (dòng 6168-6177) — rẽ nhánh khách/thành viên + khởi động timer đúng lúc**

```js
function loadGame(id){
  GAME_STATE = null; GAME_STATE_ID = id; GAME_SELECTED=null; GAME_LEGAL=[];
  const req = DATA.me ? api.get('/games/'+id) : guestFetch('GET', '/games/'+id);
  req.then(g=>{
    if(GAME_STATE_ID!==id) return;
    GAME_STATE=g; connectGameStream(id);
    maybeStartGameClock(g.status);
    const phase = xqRoomPhase(g);
    if(phase==='cho-doi-thu'||phase==='du-nguoi'||phase==='cho-ben-kia') startRoomPoll(id); else stopRoomPoll();
    render();
  }).catch(e=>{
    if(GAME_STATE_ID!==id) return;
    GAME_STATE={error:e.message||'Không tải được ván cờ.'}; render();
  });
}
```

- [ ] **Step 5: Sửa `gameCellClick(r,c)` (dòng 6178-6201) — dùng `resolveMySide` + rẽ nhánh lời gọi nước đi**

Thay dòng tính `mySide`:
```js
  const mySide = GAME_STATE.red_member_id===DATA.me.id ? 'r' : GAME_STATE.black_member_id===DATA.me.id ? 'b' : null;
```
bằng:
```js
  const mySide = resolveMySide(GAME_STATE);
```
Thay đoạn gọi API đi quân:
```js
      api.post('/games/'+gid+'/moves', {from,to}).then(g=>{
        if(GAME_STATE_ID===gid && GAME_STATE){ GAME_STATE.board=g.board; GAME_STATE.turn=g.turn; GAME_STATE.status=g.status; render(); }
      }).catch(e=>{
        toast(e.message||'Nước đi không hợp lệ.','x'); loadGame(GAME_STATE.id);
      });
```
bằng:
```js
      const req = DATA.me ? api.post('/games/'+gid+'/moves', {from,to}) : guestFetch('POST', '/games/'+gid+'/moves', {from,to});
      req.then(g=>{
        if(GAME_STATE_ID===gid && GAME_STATE){ GAME_STATE.board=g.board; GAME_STATE.turn=g.turn; GAME_STATE.status=g.status; render(); }
      }).catch(e=>{
        toast(e.message||'Nước đi không hợp lệ.','x'); loadGame(gid);
      });
```
(đổi `loadGame(GAME_STATE.id)` thành `loadGame(gid)` vì `GAME_STATE` đã bị set `null` ở 2 dòng trên trong nhánh này — `GAME_STATE.id` lúc đó ném lỗi; `gid` đã được lưu trước đó trong cùng hàm)

- [ ] **Step 6: Sửa `resignGame(id)` (dòng 6202-6205)**

```js
function resignGame(id){
  if(!confirm('Xin thua ván này?')) return;
  const req = DATA.me ? api.post('/games/'+id+'/resign') : guestFetch('POST', '/games/'+id+'/resign');
  req.catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
```

- [ ] **Step 7: Kiểm tra thủ công — xác nhận KHÔNG có gì đổi hành vi cho luồng thành viên hiện có**

Mở 2 trình duyệt (hoặc 1 thường + 1 ẩn danh), đăng nhập 2 tài khoản thành viên khác nhau tại `http://localhost`. Vào Cờ tướng online, thách đấu, nhận lời, chơi vài nước, thử xin thua ở một ván khác. Mọi thứ phải hoạt động giống hệt trước khi sửa — vì `DATA.me` luôn có giá trị ở đường thành viên, nhánh `guestFetch` không bao giờ chạy tới trong kịch bản này, đây là phép thử "không phá luồng cũ".

- [ ] **Step 8: Commit**

```bash
git add web/index.html
git commit -m "refactor(web): tổng quát hoá bộ máy ván cờ tướng để dùng chung được cho khách"
```

---

### Task 4: Chủ phòng — nút "Tạo phòng" và nhánh trạng thái phòng

**Files:**
- Modify: `web/index.html` — `V['cotuong-online']` (nút mới), `V['cotuong-van']` (nhánh trạng thái phòng).

**Interfaces:**
- Consumes: `xqRoomPhase`, `resolveMySide` (Task 2).
- Produces: `roomCreate()`, `ROOM_INVITE_TOKEN` (global, dùng nội bộ để hiện link mời); `roomReady(id)`, `roomClose(id)` — hai hàm TOÀN CỤC (không phải closure cục bộ — xem lưu ý ở Step 5) dùng chung cho cả trạng thái phòng của chủ phòng (Task 4) VÀ của khách (Task 7 gọi lại đúng 2 hàm này, không viết bản khách riêng).

- [ ] **Step 1: Thêm global — ngay sau dòng `let GAMES_LIST = null, GAMES_LIST_LOADING = false;` (dòng 5963)**

```js
let ROOM_INVITE_TOKEN = null;
```

- [ ] **Step 2: Thêm `roomCreate()`, `roomReady()`, `roomClose()` — ngay trước dòng `V['cotuong-online'] = ()=>{` (dòng 5973)**

Ba hàm này PHẢI là khai báo toàn cục (`function`, không phải const cục bộ bên trong một view function nào) — chúng được gọi từ `onclick="..."` trong chuỗi HTML, và inline event handler chỉ tìm được tên hàm trong phạm vi toàn cục, không thấy closure của hàm đã sinh ra chuỗi đó.

```js
function roomCreate(){
  api.post('/games/rooms').then(g=>{
    ROOM_INVITE_TOKEN = g.invite_token;
    GAMES_LIST = null;
    go('cotuong-van:'+g.id);
  }).catch(e=>toast(e.message||'Không tạo được phòng, thử lại.','x'));
}
// Dùng chung cho cả chủ phòng (V['cotuong-van'], Task 4) VÀ khách
// (PUB['cotuong-phong']/guestGameHtml, Task 7) — rẽ nhánh DATA.me đã đủ để
// đúng cho cả hai, không cần bản riêng cho khách.
function roomReady(id){
  const req = DATA.me ? api.post('/games/'+id+'/ready') : guestFetch('POST', '/games/'+id+'/ready');
  req.catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
function roomClose(id){
  const req = DATA.me ? api.post('/games/'+id+'/leave') : guestFetch('POST', '/games/'+id+'/leave');
  req.then(()=>go(DATA.me?'cotuong-online':'congchung')).catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
```

- [ ] **Step 3: Thêm nút vào `.xq-hub-topbar` (dòng 5982-5984)**

Thay:
```html
  <div class="xq-hub-topbar">
    <button class="btn btn-out" data-open="thachDau">${ic('plus',15)} Thách đấu</button>
  </div>
```
bằng:
```html
  <div class="xq-hub-topbar">
    <button class="btn btn-out" data-open="thachDau">${ic('plus',15)} Thách đấu</button>
    <button class="btn btn-blue" onclick="roomCreate()">${ic('users',15)} Tạo phòng</button>
  </div>
```

- [ ] **Step 4: Sửa dòng tính `mySide` trong `V['cotuong-van']` (dòng 6215)**

Thay:
```js
  const mySide = DATA.me && st.red_member_id===DATA.me.id ? 'r' : (DATA.me && st.black_member_id===DATA.me.id ? 'b' : null);
```
bằng:
```js
  const mySide = resolveMySide(st);
```

- [ ] **Step 5: Chèn nhánh trạng thái phòng — ngay sau nhánh `st.status==='finished' && !st.board` (kết thúc dòng 6236, trước dòng `const pts=[];` ở dòng 6237)**

```js
  const phase = xqRoomPhase(st);
  if(phase && phase!=='dang-dau'){
    const isHost = mySide==='r';
    let body;
    if(phase==='cho-doi-thu'){
      const link = location.origin+location.pathname+'#cotuong-phong:'+(ROOM_INVITE_TOKEN||'');
      body = `<h1>Phòng đang chờ đối thủ</h1>
        <p style="font-size:13px;color:var(--muted);margin:8px 0 14px">Gửi link này cho đối thủ để họ vào phòng — không cần tài khoản.</p>
        <div style="display:flex;gap:8px;width:100%"><input class="input" id="room-link" readonly value="${esc(link)}"><button class="btn btn-out btn-sm" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('room-link').value);toast('Đã sao chép link mời')">${ic('doc',14)} Chép</button></div>`;
    } else if(phase==='du-nguoi'){
      body = `<h1>${esc(st.black_name)} đã vào phòng</h1>
        <div class="xq-ctrl-row" style="margin-top:12px"><button class="btn btn-blue" style="flex:1" onclick="roomReady('${st.id}')">${ic('check',15)} Sẵn sàng</button></div>`;
    } else { // cho-ben-kia
      const iAmReady = isHost ? st.red_ready_at : st.black_ready_at;
      body = iAmReady
        ? `<h1>Đang chờ ${esc(st.black_name)} sẵn sàng…</h1>`
        : `<h1>${esc(st.black_name)} đã sẵn sàng</h1>
          <div class="xq-ctrl-row" style="margin-top:12px"><button class="btn btn-blue" style="flex:1" onclick="roomReady('${st.id}')">${ic('check',15)} Sẵn sàng</button></div>`;
    }
    return `<div class="xq-fs-card">${body}
      <div class="xq-ctrl-row" style="margin-top:10px"><button class="btn btn-out" style="flex:1" onclick="roomClose('${st.id}')">${ic('x',15)} Đóng phòng</button></div>
    </div>`;
  }
```

- [ ] **Step 6: Kiểm tra thủ công**

Đăng nhập một thành viên tại `http://localhost`, vào Cờ tướng online, bấm "Tạo phòng" — phải chuyển sang màn phòng, hiện link mời, chép được (toast "Đã sao chép link mời"). Bấm "Đóng phòng" — quay lại sảnh, phòng bị xoá (bấm lại "Tạo phòng" tạo phòng mới bình thường, không lỗi trùng).

- [ ] **Step 7: Commit**

```bash
git add web/index.html
git commit -m "feat(web): chủ phòng tạo phòng và thấy đúng trạng thái chờ đối thủ/sẵn sàng"
```

---

### Task 5: Chủ phòng — đồng hồ, cầu hoà, mất kết nối, rời phòng giữa ván

**Files:**
- Modify: `web/index.html` — phần thân `st.status==='active'`/`'finished'` của `V['cotuong-van']` (dòng ~6250-6280, SAU khối Task 4 vừa chèn).

**Interfaces:**
- Consumes: `xqDisplayClock`, `xqFormatClock`, `xqGameResultSide` (Task 2).
- Produces: `gameOfferDraw(id)`, `gameAcceptDraw(id)`, `gameDeclineDraw(id)`, `gameClaimDisconnectTimeout(id)`, `gameLeaveActive(id)` — Task 7 (màn khách) gọi lại đúng các hàm này, không viết bản khách riêng.

- [ ] **Step 1: Thêm 5 hàm hành động — ngay sau `resignGame` (đã sửa ở Task 3, kết thúc dòng 6205), trước khối Task 4 vừa chèn**

```js
function gameOfferDraw(id){
  const req = DATA.me ? api.post('/games/'+id+'/draw/offer') : guestFetch('POST', '/games/'+id+'/draw/offer');
  req.catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
function gameAcceptDraw(id){
  const req = DATA.me ? api.post('/games/'+id+'/draw/accept') : guestFetch('POST', '/games/'+id+'/draw/accept');
  req.catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
function gameDeclineDraw(id){
  const req = DATA.me ? api.post('/games/'+id+'/draw/decline') : guestFetch('POST', '/games/'+id+'/draw/decline');
  req.catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
function gameClaimDisconnectTimeout(id){
  // Tick mỗi giây (gameClockTick, Task 2) gọi hàm này liên tục sau khi quá
  // 60 giây — 409 (đối thủ đã nối lại) là bình thường, im lặng bỏ qua.
  const req = DATA.me ? api.post('/games/'+id+'/disconnect-timeout') : guestFetch('POST', '/games/'+id+'/disconnect-timeout');
  req.catch(()=>{});
}
function gameLeaveActive(id){
  if(!confirm('Rời phòng? Ván đang chạy — rời bây giờ tính là THUA.')) return;
  const req = DATA.me ? api.post('/games/'+id+'/leave') : guestFetch('POST', '/games/'+id+'/leave');
  req.catch(e=>toast(e.message||'Có lỗi, thử lại.','x'));
}
```

- [ ] **Step 2: Sửa tính `statusTxt`/`announce` (dòng 6250-6259) — thêm hoà + ưu tiên băng mất kết nối**

Thay:
```js
  const turnTxt = st.turn==='r' ? 'Đỏ đi' : 'Đen đi';
  const winnerSide = st.winner_member_id===st.red_member_id ? 'Đỏ' : 'Đen';
  const statusTxt = st.status==='finished'
    ? `${winnerSide} thắng${st.end_reason==='resign'?' — đối thủ xin thua':''}`
    : (mySide ? (isMyTurn?'Tới lượt bạn':'Đang chờ đối thủ') : turnTxt);
  const statusCls = st.status==='finished' ? 'win' : '';
  const inCheck = st.status==='active' && xqInCheck(st.board, st.turn);
  const announce = st.status==='finished'
    ? xqAnnounceHtml(statusTxt, (!mySide || st.winner_member_id===DATA.me.id) ? 'win' : 'lose')
    : (inCheck ? xqAnnounceHtml('Chiếu tướng!', '', true) : '');
```
bằng:
```js
  const turnTxt = st.turn==='r' ? 'Đỏ đi' : 'Đen đi';
  // winner_member_id là NULL cả khi hoà LẪN khi khách thắng (không có
  // member id) — xqGameResultSide() (Task 2) tách hai trường hợp bằng
  // end_reason, KHÔNG được coi NULL là "Đen thắng" như trước.
  const resultSide = st.status==='finished' ? xqGameResultSide(st) : undefined;
  const statusTxt = st.status==='finished'
    ? (resultSide===null ? 'Hoà' : `${resultSide==='r'?'Đỏ':'Đen'} thắng${st.end_reason==='resign'?' — đối thủ xin thua':''}`)
    : (mySide ? (isMyTurn?'Tới lượt bạn':'Đang chờ đối thủ') : turnTxt);
  const statusCls = st.status==='finished' ? 'win' : '';
  const drawFromOpp = st.status==='active' && mySide && st.draw_offered_by && st.draw_offered_by!==mySide;
  const disconnectedOpp = st.status==='active' && mySide && st.disconnected_side && st.disconnected_side!==mySide;
  const inCheck = st.status==='active' && xqInCheck(st.board, st.turn);
  const announce = st.status==='finished'
    ? xqAnnounceHtml(statusTxt, resultSide===null ? '' : ((!mySide || resultSide===mySide) ? 'win' : 'lose'))
    : (disconnectedOpp ? xqAnnounceHtml('⚡ Đối thủ mất mạng — chờ nối lại', '') : (inCheck ? xqAnnounceHtml('Chiếu tướng!', '', true) : ''));
```

- [ ] **Step 3: Thêm đồng hồ + băng cầu hoà + nút mới vào `.xq-fs-panel` (dòng 6270-6279)**

Thay:
```js
  <div class="xq-fs-panel${XQ_FS_MENU_OPEN?` show`:``}">
    <h1>${esc(st.red_name)} <span style="color:var(--muted);font-weight:400">vs</span> ${esc(st.black_name)}</h1>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${mySide?'Bạn đang chơi bên '+(mySide==='r'?'Đỏ':'Đen'):'Bạn đang xem trực tiếp'}</p>
    <div class="xq-ctrl-row">
      ${mySide&&st.status==='active'?`<button class="btn btn-out" style="flex:1" onclick="resignGame('${st.id}')">${ic('flag',15)} Xin thua</button>`:''}
      <button class="btn btn-out" style="flex:1" onclick="chessFlipBoard()">${ic('swap',15)} Đổi bên</button>
    </div>
    <h3 style="margin-top:14px">Biên bản ván cờ</h3>
```
bằng:
```js
  <div class="xq-fs-panel${XQ_FS_MENU_OPEN?` show`:``}">
    <h1>${esc(st.red_name)} <span style="color:var(--muted);font-weight:400">vs</span> ${esc(st.black_name)}</h1>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">${mySide?'Bạn đang chơi bên '+(mySide==='r'?'Đỏ':'Đen'):'Bạn đang xem trực tiếp'}</p>
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
    <h3 style="margin-top:14px">Biên bản ván cờ</h3>
```

- [ ] **Step 4: Kiểm tra thủ công (dùng 2 tài khoản thành viên qua thách đấu bình thường — clock/cầu hoà/mất-kết-nối áp dụng cho MỌI ván active, không riêng ván phòng)**

1. Hai bên thách đấu, vào ván — cả hai thấy đồng hồ 10:00 chạy, bên đang đi lượt giảm dần, đổi màu đỏ khi dưới 1 phút (có thể tạm sửa `red_time_ms` thẳng trong DB để test nhanh nếu muốn, không bắt buộc).
2. Một bên bấm "Cầu hoà" — bên kia thấy băng "✋ ... xin hoà" với Đồng ý/Từ chối. Bấm Đồng ý — cả hai thấy "Hoà" (không phải "Đen thắng").
3. Thách đấu ván khác, một bên đóng hẳn tab giữa ván — bên còn lại sau vài giây thấy băng "⚡ Đối thủ mất mạng — chờ nối lại"; đợi đủ 60 giây (hoặc giảm tạm thời ngưỡng trong code để test nhanh rồi trả lại) thấy tự nhận thắng.
4. Giữa một ván đang chạy, bấm "Rời phòng" — hiện hộp xác nhận đúng câu cảnh báo; xác nhận → thua ván, đối thủ thấy kết quả.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm đồng hồ, cầu hoà, mất kết nối, rời phòng cho ván cờ tướng đang đấu"
```

---

### Task 6: Khách — khung màn `PUB['cotuong-phong']` và luồng vào/khôi phục phiên

**Files:**
- Modify: `web/index.html:2076` (`PUBLIC_SCREENS`), `web/index.html:2195` (`XQ_FULLSCREEN_SCREENS`)
- Modify: `web/index.html` — thêm `PUB['cotuong-phong']` ở cuối khối các hàm `PUB.*` hiện có (tìm bằng cách grep `PUB\.dangnhap\s*=` hoặc `PUB\[.dangnhap.\]` trong file — chèn ngay sau định nghĩa `PUB` cuối cùng đó).

**Interfaces:**
- Consumes: `loadGame`, `guestFetch`, `saveGuestSession`, `loadGuestSession`, `clearGuestSession`, `GUEST_TOKEN`, `GUEST_INVITE_TOKEN` (Task 2/3).
- Produces: `PUB['cotuong-phong']`, `guestJoinRoom(token)` — Task 7 thêm `guestGameHtml(st)` mà hàm này gọi tới (khai báo `function` nên thứ tự trong file không quan trọng).

- [ ] **Step 1: Đăng ký màn — dòng 2076**

Thay:
```js
const PUBLIC_SCREENS = new Set(['congchung','hosocongkhai','gianhap','dangnhap']);
```
bằng:
```js
const PUBLIC_SCREENS = new Set(['congchung','hosocongkhai','gianhap','dangnhap','cotuong-phong']);
```

- [ ] **Step 2: Đăng ký toàn màn hình — dòng 2195**

Thay:
```js
const XQ_FULLSCREEN_SCREENS = new Set(['cotuong','cotuong-may','cotuong-the','cotuong-van']);
```
bằng:
```js
const XQ_FULLSCREEN_SCREENS = new Set(['cotuong','cotuong-may','cotuong-the','cotuong-van','cotuong-phong']);
```
(Không cần sửa `XQ_FULLSCREEN_CLOSE` — mặc định `'congchung'` khi màn không có trong map đã đúng cho khách: không có sảnh thành viên nào để quay lại.)

- [ ] **Step 3: Thêm `PUB['cotuong-phong']` + `guestJoinRoom`**

```js
let GUEST_NAME_INPUT = '';
PUB['cotuong-phong'] = (params)=>{
  const token = params[0];
  if(!token) return `<div class="empty" style="margin-top:15vh"><h3>Link mời không hợp lệ</h3></div>`;
  if(GUEST_INVITE_TOKEN!==token){
    // Lần đầu vào token này (hoặc vừa đổi token): nạp lại từ đầu.
    GUEST_INVITE_TOKEN = token; GUEST_TOKEN = null;
    const saved = loadGuestSession(token);
    if(saved){
      GUEST_TOKEN = saved.guestToken;
      GAME_STATE_ID = null;
      loadGame(saved.gameId);
      return `<p style="padding-top:15vh;text-align:center;color:var(--muted)">Đang tải…</p>`;
    }
    // Không có phiên đã lưu — không có gì để chờ, rơi thẳng xuống form nhập
    // tên bên dưới trong cùng lượt render này (KHÔNG return ở đây — nếu
    // return vô điều kiện như một bản nháp trước đó của kế hoạch này từng
    // viết, khách lần đầu sẽ kẹt vĩnh viễn ở "Đang tải…" vì không có gì
    // kích hoạt render() lần hai).
  }
  if(!GUEST_TOKEN) return guestJoinFormHtml();
  if(GAME_STATE_ID===null || GAME_STATE===null){
    return `<p style="padding-top:15vh;text-align:center;color:var(--muted)">Đang tải ván cờ…</p>`;
  }
  if(GAME_STATE.error){
    // Token cũ không còn hợp lệ (chủ phòng đã đóng phòng, hoặc chính khách
    // đã tự rời ở tab khác trước đó) — xoá bản lưu, quay lại form nhập tên
    // thay vì kẹt lại một thông báo lỗi (mục 5/11 spec thiết kế).
    clearGuestSession(token); GUEST_TOKEN=null;
    return guestJoinFormHtml();
  }
  return guestGameHtml(GAME_STATE);
};
function guestJoinFormHtml(){
  return `<div class="xq-fs-card">
    <h1>Vào phòng cờ tướng</h1>
    <p style="font-size:13px;color:var(--muted);margin:8px 0 14px">Nhập tên để đối thủ biết bạn là ai — không cần tài khoản.</p>
    <input class="input" id="guest-name" placeholder="Tên của bạn" value="${esc(GUEST_NAME_INPUT)}" oninput="GUEST_NAME_INPUT=this.value" style="margin-bottom:10px">
    <button class="btn btn-blue" style="width:100%" onclick="guestJoinRoom()">${ic('users',15)} Vào phòng</button>
  </div>`;
}
// token đọc từ GUEST_INVITE_TOKEN (global), KHÔNG nhận qua tham số/nội suy
// vào onclick — token đến thẳng từ URL (params[0] của parseHash()), một
// link mời có thể bị chỉnh tay; nội suy thẳng vào onclick="...('${token}')"
// mở đường cho thoát chuỗi JS ngay trong thuộc tính HTML (esc() không chặn
// được kiểu này: HTML giải mã thực thể TRƯỚC khi trình duyệt phân tích nội
// dung thuộc tính thành JS, nên một dấu nháy đã "esc" vẫn quay lại thành
// dấu nháy thật lúc JS chạy). Đọc từ global tránh hẳn việc nội suy.
function guestJoinRoom(){
  const token = GUEST_INVITE_TOKEN;
  const name = (GUEST_NAME_INPUT||'').trim();
  if(!name){ toast('Nhập tên trước đã.','x'); return; }
  guestFetch('POST', '/games/rooms/'+encodeURIComponent(token)+'/join', {guest_name:name}, null).then(r=>{
    GUEST_TOKEN = r.guest_token;
    saveGuestSession(token, {gameId:r.id, guestToken:r.guest_token, guestName:name});
    loadGame(r.id);
  }).catch(e=>toast(e.message||'Không vào được phòng, thử lại.','x'));
}
```

- [ ] **Step 4: Kiểm tra thủ công (chưa có `guestGameHtml` — chỉ kiểm luồng vào)**

Ở trình duyệt còn đang mở phòng từ Task 4 (chủ phòng đã "Tạo phòng", đang ở "Phòng đang chờ đối thủ"), copy link mời, mở link đó ở cửa sổ ẩn danh khác. Phải thấy form "Vào phòng cờ tướng". Nhập tên, bấm "Vào phòng" — vì `guestGameHtml` (Task 7) chưa tồn tại, bước này sẽ báo lỗi JS trong Console (`guestGameHtml is not defined`) khi hàm cố render — CHẤP NHẬN ĐƯỢC ở task này; xác nhận riêng phần trước đó: request `POST /games/rooms/:token/join` trả 201 (xem tab Network), và `localStorage` (DevTools → Application → Local Storage) có key `xq_guest_<token>` với `gameId`/`guestToken`/`guestName` đúng.

- [ ] **Step 5: Commit**

```bash
git add web/index.html
git commit -m "feat(web): thêm màn công khai cho khách vào phòng cờ tướng bằng link mời"
```

---

### Task 7: Khách — vẽ bàn cờ và panel rút gọn cho mọi trạng thái phòng

**Files:**
- Modify: `web/index.html` — thêm `guestGameHtml(st)` ngay sau `PUB['cotuong-phong']` và các hàm phụ trợ của Task 6.

**Interfaces:**
- Consumes: `xqRoomPhase`, `xqFormatClock`, `xqDisplayClock`, `xqGameResultSide` (Task 2); `GAME_STATE`, `GAME_SELECTED`, `GAME_LEGAL`, `gameCellClick`, `resignGame` (Task 3); `roomReady`, `roomClose` (Task 4); `gameOfferDraw`, `gameAcceptDraw`, `gameDeclineDraw`, `gameLeaveActive` (Task 5); `chessGridSvg`, `xqAnnounceHtml`, `xqInCheck`, `CHESS_CHAR`, `esc`, `ic` (đã có sẵn trong file). Không định nghĩa hàm hành động riêng cho khách ở task này — `roomReady`/`roomClose`/`gameLeaveActive` đã rẽ nhánh `DATA.me` từ Task 4/5, dùng thẳng được.

- [ ] **Step 1: Thêm `guestGameHtml` — không cần hàm hành động riêng nào, mọi nút gọi thẳng `roomReady`/`roomClose` (Task 4) hoặc `gameOfferDraw`/`gameAcceptDraw`/`gameDeclineDraw`/`gameLeaveActive`/`resignGame` (Task 3/5), đúng y hệt các hàm chủ phòng đang dùng**

```js
function guestGameHtml(st){
  const isMyTurn = st.status==='active' && st.turn==='b';
  const phase = xqRoomPhase(st);
  if(phase && phase!=='dang-dau'){
    let body;
    if(phase==='du-nguoi' || phase==='cho-ben-kia'){
      body = st.black_ready_at
        ? `<h1>Đang chờ ${esc(st.red_name)} sẵn sàng…</h1>`
        : `<h1>Phòng đã đủ người</h1><div class="xq-ctrl-row" style="margin-top:12px"><button class="btn btn-blue" style="flex:1" onclick="roomReady('${st.id}')">${ic('check',15)} Sẵn sàng</button></div>`;
    } else {
      body = `<h1>Đang chờ chủ phòng…</h1>`; // 'cho-doi-thu': không xảy ra ở màn khách (khách chỉ vào được sau second_joined_at), giữ để không vỡ nếu dữ liệu bất thường
    }
    return `<div class="xq-fs-card">${body}
      <div class="xq-ctrl-row" style="margin-top:10px"><button class="btn btn-out" style="flex:1" onclick="roomClose('${st.id}')">${ic('x',15)} Rời phòng</button></div>
    </div>`;
  }
  const pts=[];
  for(let r=0;r<10;r++) for(let c=0;c<9;c++){
    const p = st.board[r][c];
    const isSel = GAME_SELECTED && GAME_SELECTED.r===r && GAME_SELECTED.c===c;
    const isDest = GAME_LEGAL.some(m=>m.r===r&&m.c===c);
    const isLast = st.last_move && ((st.last_move.from.r===r&&st.last_move.from.c===c)||(st.last_move.to.r===r&&st.last_move.to.c===c));
    const dr=9-r, dc=8-c; // khách luôn nhìn quân Đen của mình ở dưới — không có nút "Đổi bên"
    const leftFrac=dc/8, topFrac=dr/9;
    let inner='';
    if(p) inner = `<div class="xq-pc ${p.side==='r'?'red':'black'} ${isSel?'sel':''}">${CHESS_CHAR[p.side][p.type]}</div>`;
    else if(isDest) inner = `<div class="xq-dot"></div>`;
    pts.push(`<button type="button" class="xq-pt ${isDest&&p?'cap':''} ${isLast?'last':''}" style="left:calc(var(--xq-pad) + (100% - var(--xq-pad)*2) * ${leftFrac});top:calc(var(--xq-pad) + (100% - var(--xq-pad)*2) * ${topFrac})" onclick="gameCellClick(${r},${c})" ${isMyTurn?'':'disabled'}>${inner}</button>`);
  }
  const resultSide = st.status==='finished' ? xqGameResultSide(st) : undefined;
  const statusTxt = st.status==='finished'
    ? (resultSide===null ? 'Hoà' : (resultSide==='b'?'Bạn thắng':'Đối thủ thắng')+(st.end_reason==='resign'?' — đối thủ xin thua':''))
    : (isMyTurn?'Tới lượt bạn':'Đang chờ đối thủ');
  const drawFromOpp = st.status==='active' && st.draw_offered_by && st.draw_offered_by!=='b';
  const disconnectedOpp = st.status==='active' && st.disconnected_side==='r';
  const inCheck = st.status==='active' && xqInCheck(st.board, st.turn);
  const announce = st.status==='finished'
    ? xqAnnounceHtml(statusTxt, resultSide===null?'':(resultSide==='b'?'win':'lose'))
    : (disconnectedOpp ? xqAnnounceHtml('⚡ Đối thủ mất mạng — chờ nối lại', '') : (inCheck ? xqAnnounceHtml('Chiếu tướng!', '', true) : ''));
  return `
  <div class="xq-status-bar ${st.status==='finished'?'win':''}">${statusTxt}</div>
  ${announce}
  <div class="xq-wrap">
    <div class="xq-board">
      ${chessGridSvg()}
      <div class="xq-river">楚 河　　漢 界</div>
      ${pts.join('')}
    </div>
  </div>
  <div class="xq-fs-panel${XQ_FS_MENU_OPEN?` show`:``}">
    ${st.status==='active'?`<div class="xq-clock-row">
      <span class="xq-clock${xqDisplayClock(st,'r')<60000?' low':''}">${ic('clock',14)} ${esc(st.red_name)}: ${xqFormatClock(xqDisplayClock(st,'r'))}</span>
      <span class="xq-clock${xqDisplayClock(st,'b')<60000?' low':''}">${ic('clock',14)} Bạn: ${xqFormatClock(xqDisplayClock(st,'b'))}</span>
    </div>`:''}
    ${drawFromOpp?`<div style="background:rgba(255,255,255,.08);border-radius:10px;padding:10px;margin-bottom:10px">
      <p style="font-size:13.5px;margin-bottom:8px">✋ ${esc(st.red_name)} xin hoà</p>
      <div class="xq-ctrl-row"><button class="btn btn-blue" style="flex:1" onclick="gameAcceptDraw('${st.id}')">Đồng ý</button><button class="btn btn-out" style="flex:1" onclick="gameDeclineDraw('${st.id}')">Từ chối</button></div>
    </div>`:''}
    ${st.status==='active'?`<div class="xq-ctrl-row">
      <button class="btn btn-out" style="flex:1" onclick="gameOfferDraw('${st.id}')">${ic('handshake',15)} Cầu hoà</button>
      <button class="btn btn-out" style="flex:1" onclick="resignGame('${st.id}')">${ic('flag',15)} Xin thua</button>
    </div>`:''}
    <div class="xq-ctrl-row" style="margin-top:8px">
      <button class="btn btn-out" style="flex:1" onclick="gameLeaveActive('${st.id}')">${ic('x',15)} Rời phòng</button>
    </div>
    <h3 style="margin-top:14px">Biên bản ván cờ</h3>
    ${st.moves && st.moves.length?`<div>${st.moves.map(m=>`<div style="font-size:13px;padding:4px 0;color:var(--ink2)">${m.seq}. ${m.side==='r'?'Đỏ':'Đen'} (${m.from_r},${m.from_c}) → (${m.to_r},${m.to_c})${m.captured_type?' — ăn quân':''}</div>`).join('')}</div>`:'<p style="font-size:13px;color:var(--muted)">Chưa có nước nào.</p>'}
  </div>`;
}
```

`gameLeaveActive` (Task 5) đã tự hỏi xác nhận và rẽ nhánh `DATA.me`, nên nút "Rời phòng" giữa ván của khách chạy đúng cùng một hàm với chủ phòng — không có phiên bản khách riêng.

- [ ] **Step 2: Kiểm tra thủ công**

Lặp lại luồng ở Task 6 Step 4 (chủ phòng "Tạo phòng" → khách mở link ẩn danh → nhập tên → "Vào phòng") — lần này khách phải thấy đúng "Phòng đã đủ người" + nút Sẵn sàng, KHÔNG còn lỗi Console. Cả hai bấm Sẵn sàng — cả hai chuyển sang bàn cờ thật gần như đồng thời (SSE `game_start`). Xác nhận: quân Đen (của khách) nằm ở phía dưới màn hình khách; khách KHÔNG thấy nút "Đổi bên", không thấy "quân đã bắt"/mổ ván/hồ sơ đối thủ (những khối này chưa từng được thêm cho khách — đúng theo thiết kế "không vẽ, không phải ẩn").

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "feat(web): khách chơi được ván cờ tướng đầy đủ qua màn rút gọn"
```

---

### Task 8: Kiểm thử thủ công đầu-cuối theo 8 kịch bản của spec

**Files:** không sửa file trừ khi phát hiện lỗi cần vá (nếu có, vá trực tiếp trong `web/index.html` rồi quay lại đúng bước đang kiểm).

Không có bộ kiểm thử tự động cho `web/index.html` (xem Global Constraints) — đây là bước xác nhận cuối cùng bằng tay tại `http://localhost`, dùng 1 trình duyệt đăng nhập chủ phòng + 1 cửa sổ ẩn danh làm khách, đi hết lượt 8 kịch bản của mục 12 spec thiết kế:

- [ ] **Kịch bản 1:** Chủ phòng tạo phòng → thấy link mời → chép được.
- [ ] **Kịch bản 2:** Mở link ở ẩn danh, nhập tên, vào phòng → chủ phòng thấy tên khách xuất hiện trong ≤3 giây (polling Task 2/3).
- [ ] **Kịch bản 3:** Cả hai bấm Sẵn sàng → ván bắt đầu ở cả hai màn gần như đồng thời (SSE `game_start`).
- [ ] **Kịch bản 4:** Tải lại trang ở cửa sổ khách giữa ván → quay lại đúng ván, đúng màu quân, đúng đồng hồ còn lại (khôi phục từ `localStorage`).
- [ ] **Kịch bản 5:** Một bên cầu hoà → bên kia thấy băng thông báo, Đồng ý → ván kết thúc "Hoà" ở cả hai màn (không phải "Đen thắng"/"Đỏ thắng").
- [ ] **Kịch bản 6:** Đóng cửa sổ khách giữa ván → chủ phòng thấy băng "mất mạng" sau vài giây, đợi 60 giây → tự nhận thắng.
- [ ] **Kịch bản 7:** Khách bấm "Rời phòng" giữa ván → hộp xác nhận đúng câu cảnh báo → xác nhận → khách thua, chủ phòng thấy kết quả.
- [ ] **Kịch bản 8:** Tạo phòng mới, khách vào nhưng không bấm Sẵn sàng quá 30 giây → bị dọn khỏi phòng (đọc lại — F5 hoặc đợi lần poll kế — thấy phòng quay lại "chờ đối thủ"); link mời dùng lại được cho một khách khác.

- [ ] **Step cuối: Nếu mọi kịch bản qua, xác nhận không có thay đổi ngoài ý muốn ở `web/js/api.js` hay `api/`**

```bash
git status --short
git diff --stat main -- web/js/api.js api/
```
Cả hai lệnh phải không cho thấy gì đụng tới `web/js/api.js`/`api/` từ các Task 1-7 (đúng Global Constraint đầu kế hoạch).

- [ ] **Nếu cần vá lỗi phát sinh trong lúc kiểm:** vá trực tiếp, thêm 1 commit riêng mô tả đúng lỗi đã vá, rồi tiếp tục kịch bản đang dở — không gộp vá lỗi vào các commit Task 1-7 đã có.
