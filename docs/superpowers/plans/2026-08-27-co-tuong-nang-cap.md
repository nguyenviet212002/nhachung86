# Cờ tướng — Nâng cấp hình ảnh, chơi với máy, cờ thế — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp hình ảnh bàn cờ/quân cờ cho mọi màn cờ tướng, thêm chế độ chơi với máy (AI, 3 cấp độ) và chế độ cờ thế (giải thế cờ dở sẵn, đấu với AI).

**Architecture:** Toàn bộ nằm trong 1 file `web/thiet-ke-moi.html` (không build step, không backend mới). Thêm engine AI thuần (minimax + alpha-beta) chạy trong Web Worker, 1 hàm render bàn cờ dùng chung, 2 màn hình mới (`V['cotuong-may']`, `V['cotuong-the']`), và 1 bộ dữ liệu thế cờ tĩnh.

**Tech Stack:** JavaScript thuần (ES6+), không framework, không build step, Web Worker qua `Blob`/`URL.createObjectURL`.

**Spec:** `docs/superpowers/specs/2026-08-27-co-tuong-nang-cap-design.md`

## Global Constraints

- Mọi thay đổi chỉ trong `web/thiet-ke-moi.html` — không sửa `web/js/*.js`, không sửa `api/`.
- Không thêm ảnh/font ngoài, không gọi API mới, không lưu tiến trình cờ thế.
- Không có test framework frontend trong repo — xác minh bằng: (a) node script tạm trong thư mục scratchpad cho logic thuần (không đụng DOM), (b) skill `browser-automation` cho phần có DOM/tương tác. Không thêm hạ tầng test mới vào repo.
- **Cách bật màn thành viên để kiểm thử qua trình duyệt mà không cần backend thật** (dùng lại ở mọi bước có DOM): mở `web/thiet-ke-moi.html` trực tiếp (`file://` hoặc server tĩnh bất kỳ), đợi trang tải xong, rồi chạy trong console:
  ```js
  isAuthed = () => true;
  BOOT_ERROR = null;
  DATA.me = {id:'t1', name:'Người kiểm thử', avatar:null, role:'member'};
  ROLE = 'member';
  location.hash = '#cotuong-may'; // hoặc màn cần xem
  ```
  `DATA` đã có sẵn mảng/field rỗng an toàn cho mọi nơi khác (`DATA.jobs`, `DATA.aid`... đều khởi tạo `[]`), nên phần còn lại của khung trang (menu, badge) vẽ được bình thường dù chưa có dữ liệu thật từ API.
- Quân cờ dùng hiệu ứng "phóng to mờ dần" khi máy vừa đi (class `.xq-pc.moved`), **không** dùng animation trượt toạ độ thật — `render()` thay toàn bộ `innerHTML` mỗi lần vẽ nên không có 1 node DOM nào "di chuyển" giữa 2 lần vẽ để transition.
- Bộ dữ liệu cờ thế ở bản này có **6 thế** (2 mỗi cấp độ Dễ/Vừa/Khó), không phải 12-15 như phác thảo ban đầu trong spec — ưu tiên vài thế được kiểm chứng đúng luật (không tướng đối mặt, đúng 1 tướng mỗi bên, không ai bị chiếu sẵn lúc vào thế) hơn là nhiều thế chưa kiểm chứng kỹ. Thêm thế mới sau này chỉ cần nối thêm phần tử vào mảng `CO_THE` theo đúng khuôn dạng `xqPos(...)`.

---

### Task 1: Nâng cấp CSS bàn cờ/quân cờ

**Files:**
- Modify: `web/thiet-ke-moi.html:238-256` (khối CSS `.xq-*`)
- Modify: `web/thiet-ke-moi.html` — hàm `chessGridSvg()` (màu `stroke`, hiện dùng `var(--ink2)` 8 chỗ)

**Interfaces:**
- Consumes: không có (thuần CSS)
- Produces: các class `.xq-wrap`, `.xq-board`, `.xq-pc`, `.xq-pc.moved`, `.xq-dot`, `.xq-pt` với giao diện mới — mọi task sau dùng lại y nguyên tên class này, không đổi tên.

- [ ] **Step 1: Thay khối CSS `.xq-*`**

Tìm đúng khối CSS hiện tại (dòng 238-256):
```css
/* ===== Cờ tướng ===== */
.xq-wrap{display:flex;justify-content:center}
.xq-board{--xq-pad:26px;position:relative;width:100%;max-width:472px;aspect-ratio:8/9;background:#F3E4C0;border-radius:var(--r-md,10px);
  box-shadow:0 2px 10px rgba(0,0,0,.08);padding:var(--xq-pad);border:1px solid #D8C393;box-sizing:border-box}
.xq-lines{position:absolute;left:var(--xq-pad);top:var(--xq-pad);width:calc(100% - var(--xq-pad)*2);height:calc(100% - var(--xq-pad)*2)}
.xq-river{position:absolute;left:var(--xq-pad);right:var(--xq-pad);top:calc(var(--xq-pad) + (100% - var(--xq-pad)*2)*.5 - 9px);text-align:center;display:flex;justify-content:space-between;
  padding:0 14%;font-size:16px;font-weight:700;color:#9c8558;letter-spacing:2px;pointer-events:none}
.xq-pt{position:absolute;width:12%;aspect-ratio:1;transform:translate(-50%,-50%);border:0;background:transparent;
  padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2}
.xq-pt:disabled{cursor:default}
.xq-pc{width:84%;height:84%;border-radius:50%;background:#FBF3DE;border:1.5px solid #B08D46;display:flex;align-items:center;
  justify-content:center;font-size:17px;font-weight:800;font-family:'Songti SC','SimSun',serif;box-shadow:0 2px 3px rgba(0,0,0,.2)}
.xq-pc.red{color:#B4231F}
.xq-pc.black{color:#1f2937}
.xq-pc.sel{outline:3px solid var(--brand);outline-offset:1px}
.xq-pt.last .xq-pc{box-shadow:0 0 0 2px var(--brand),0 2px 3px rgba(0,0,0,.2)}
.xq-dot{width:28%;height:28%;border-radius:50%;background:rgba(14,107,79,.55)}
.xq-pt.cap{outline:2.5px solid var(--bad,#c13b31);outline-offset:-2px;border-radius:50%}
@media(max-width:600px){.xq-pc{font-size:14.5px}.xq-board{--xq-pad:18px}}
```

Thay bằng:
```css
/* ===== Cờ tướng ===== */
.xq-wrap{display:flex;justify-content:center;padding:22px;border-radius:16px;
  background:radial-gradient(ellipse at 50% 0%,#1f4a3a,#0e2e22 70%);
  box-shadow:inset 0 2px 14px rgba(0,0,0,.35)}
.xq-board{--xq-pad:26px;position:relative;width:100%;max-width:472px;aspect-ratio:8/9;
  background:repeating-linear-gradient(90deg,rgba(140,100,45,.08) 0 2px,transparent 2px 22px),
    radial-gradient(ellipse at 30% 20%,#F6E6BE,#E8CE97 55%,#D6B87C 100%);
  border-radius:var(--r-md,10px);
  box-shadow:0 10px 24px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.25),inset 0 -6px 16px rgba(120,80,30,.25);
  padding:var(--xq-pad);border:5px solid #7a4e22;box-sizing:border-box}
.xq-lines{position:absolute;left:var(--xq-pad);top:var(--xq-pad);width:calc(100% - var(--xq-pad)*2);height:calc(100% - var(--xq-pad)*2)}
.xq-river{position:absolute;left:var(--xq-pad);right:var(--xq-pad);top:calc(var(--xq-pad) + (100% - var(--xq-pad)*2)*.5 - 9px);text-align:center;display:flex;justify-content:space-between;
  padding:0 14%;font-size:16px;font-weight:700;color:#8a6a3a;letter-spacing:2px;pointer-events:none}
.xq-pt{position:absolute;width:12%;aspect-ratio:1;transform:translate(-50%,-50%);border:0;background:transparent;
  padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2}
.xq-pt:disabled{cursor:default}
.xq-pc{width:84%;height:84%;border-radius:50%;
  background:radial-gradient(circle at 35% 28%,#FFFBEF,#F0DCA8 55%,#D8B978 100%);
  border:1.5px solid #8a5d24;display:flex;align-items:center;
  justify-content:center;font-size:17px;font-weight:800;font-family:'Songti SC','SimSun',serif;
  box-shadow:0 3px 5px rgba(0,0,0,.35),inset 0 1px 1px rgba(255,255,255,.85),inset 0 -2px 3px rgba(120,80,30,.4)}
.xq-pc.red{color:#B4231F}
.xq-pc.black{color:#1f2937}
.xq-pc.sel{box-shadow:0 0 0 3px var(--brand),0 3px 5px rgba(0,0,0,.35)}
.xq-pt.last .xq-pc{box-shadow:0 0 0 2px var(--brand),0 0 10px 2px rgba(212,175,55,.7)}
.xq-dot{width:28%;height:28%;border-radius:50%;background:rgba(14,90,60,.6);box-shadow:0 0 0 3px rgba(14,90,60,.15)}
.xq-pt.cap{outline:2.5px solid var(--bad,#c13b31);outline-offset:-2px;border-radius:50%}
@keyframes xq-pop{from{transform:scale(.35);opacity:0}to{transform:scale(1);opacity:1}}
.xq-pc.moved{animation:xq-pop .28s ease}
@media(max-width:600px){.xq-pc{font-size:14.5px}.xq-board{--xq-pad:18px}}
```

- [ ] **Step 2: Đổi màu đường kẻ bàn cờ trong `chessGridSvg()`**

Trong hàm `chessGridSvg()`, thay mọi `stroke="var(--ink2)"` (8 chỗ) bằng `stroke="#7a5326"`.

- [ ] **Step 3: Kiểm tra bằng trình duyệt (chỉ CSS, chưa cần đăng nhập/DATA)**

Dùng skill `browser-automation`: mở `web/thiet-ke-moi.html`, sau khi trang tải xong chạy trong console:
```js
document.body.innerHTML = '<div class="xq-wrap"><div class="xq-board">' + chessGridSvg() +
  '<div class="xq-river">楚 河　　漢 界</div>' +
  '<div class="xq-pt" style="left:20%;top:10%"><div class="xq-pc red">帥</div></div>' +
  '<div class="xq-pt" style="left:50%;top:50%"><div class="xq-pc black moved">將</div></div>' +
  '<div class="xq-pt" style="left:70%;top:70%"><div class="xq-dot"></div></div>' +
  '</div></div>';
```
Kỳ vọng: nền dạ xanh đậm quanh bàn, bàn cờ vân gỗ có viền đậm và bóng đổ, 2 quân cờ nổi khối 3D (một quân có hiệu ứng phóng to mờ dần lúc mới chèn vào DOM), chấm gợi ý nước đi hiện đúng màu. Không có lỗi console.

- [ ] **Step 4: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "style(cotuong): nang cap giao dien ban co va quan co"
```

---

### Task 2: Hàm vẽ bàn cờ dùng chung + refactor `V.cotuong`

**Files:**
- Modify: `web/thiet-ke-moi.html` — thêm hàm mới ngay sau `chessGridSvg()` (sau dòng 3871, trước khối comment `V['cotuong-online']`)
- Modify: `web/thiet-ke-moi.html` — thân hàm `V.cotuong` (dòng ~4121-4166), chỉ đổi phần dựng `pts`/bàn cờ, giữ nguyên phần `aside`

**Interfaces:**
- Consumes: `xqOpp`, `CHESS_CHAR`, `chessGridSvg()` (đã có sẵn)
- Produces: `chessBoardHtml(board, opts)` — `opts: {selected, legal, lastMove, flip, onCellClick, disabled, justMovedTo}` (tất cả optional trừ khi cần), trả về chuỗi HTML `<div class="xq-wrap">...</div>` hoàn chỉnh. **Mọi task sau (3 màn cờ còn lại) dùng đúng chữ ký này.**

- [ ] **Step 1: Thêm hàm `chessBoardHtml`**

Chèn ngay sau hàm `chessGridSvg(){...}` (sau dấu `}` đóng hàm, trước khối comment `/* ... V['cotuong-online'] ... */`):

```js
/* Vẽ 1 bàn cờ hoàn chỉnh (lưới + sông + toàn bộ 90 điểm) — dùng chung cho
   mọi màn cờ tướng chạy phía client (cotuong, cotuong-may, cotuong-the).
   opts.onCellClick là TÊN hàm global (chuỗi), theo đúng quy ước onclick=""
   nội tuyến đã dùng khắp file này — không truyền function reference. */
function chessBoardHtml(board, opts){
  opts = opts || {};
  const selected = opts.selected || null, legal = opts.legal || [], lastMove = opts.lastMove || null;
  const flip = !!opts.flip, disabled = !!opts.disabled, onCellClick = opts.onCellClick || null;
  const justMovedTo = opts.justMovedTo || null;
  const pts = [];
  for(let r=0;r<10;r++) for(let c=0;c<9;c++){
    const p = board[r][c];
    const isSel = selected && selected.r===r && selected.c===c;
    const isDest = legal.some(m=>m.r===r&&m.c===c);
    const isLast = lastMove && ((lastMove.from.r===r&&lastMove.from.c===c)||(lastMove.to.r===r&&lastMove.to.c===c));
    const isJustMoved = justMovedTo && justMovedTo.r===r && justMovedTo.c===c;
    const dr = flip?9-r:r, dc = flip?8-c:c;
    const leftFrac = dc/8, topFrac = dr/9;
    let inner = '';
    if(p) inner = `<div class="xq-pc ${p.side==='r'?'red':'black'} ${isSel?'sel':''} ${isJustMoved?'moved':''}">${CHESS_CHAR[p.side][p.type]}</div>`;
    else if(isDest) inner = `<div class="xq-dot"></div>`;
    const clickAttr = onCellClick ? ` onclick="${onCellClick}(${r},${c})"` : '';
    pts.push(`<button type="button" class="xq-pt ${isDest&&p?'cap':''} ${isLast?'last':''}" style="left:calc(var(--xq-pad) + (100% - var(--xq-pad)*2) * ${leftFrac});top:calc(var(--xq-pad) + (100% - var(--xq-pad)*2) * ${topFrac})"${clickAttr} ${disabled?'disabled':''}>${inner}</button>`);
  }
  return `<div class="xq-wrap"><div class="xq-board">${chessGridSvg()}<div class="xq-river">楚 河　　漢 界</div>${pts.join('')}</div></div>`;
}
```

- [ ] **Step 2: Refactor `V.cotuong` để dùng `chessBoardHtml`**

Tìm thân hàm `V.cotuong` hiện tại (dòng ~4121-4166):
```js
V.cotuong = ()=>{
  const st = CHESS;
  const pts=[];
  for(let r=0;r<10;r++) for(let c=0;c<9;c++){
    const p = st.board[r][c];
    const isSel = st.selected && st.selected.r===r && st.selected.c===c;
    const isDest = st.legal.some(m=>m.r===r&&m.c===c);
    const isLast = st.lastMove && ((st.lastMove.from.r===r&&st.lastMove.from.c===c)||(st.lastMove.to.r===r&&st.lastMove.to.c===c));
    const dr=CHESS_FLIP?9-r:r, dc=CHESS_FLIP?8-c:c;
    const leftFrac=dc/8, topFrac=dr/9;
    let inner='';
    if(p) inner = `<div class="xq-pc ${p.side==='r'?'red':'black'} ${isSel?'sel':''}">${CHESS_CHAR[p.side][p.type]}</div>`;
    else if(isDest) inner = `<div class="xq-dot"></div>`;
    pts.push(`<button type="button" class="xq-pt ${isDest&&p?'cap':''} ${isLast?'last':''}" style="left:calc(var(--xq-pad) + (100% - var(--xq-pad)*2) * ${leftFrac});top:calc(var(--xq-pad) + (100% - var(--xq-pad)*2) * ${topFrac})" onclick="chessCellClick(${r},${c})">${inner}</button>`);
  }
  const turnTxt = st.turn==='r' ? 'Đỏ đi' : 'Đen đi';
  const reasonTxt = {chieu:'Chiếu tướng!', ['chieu-bi']:'Chiếu bí — hết cờ!', ['het-nuoc-di']:'Hết nước đi!', ['bat-tuong']:'Bắt được tướng!'}[st.reason]||'';
  return `
  <div class="page-head"><div><h1>Cờ tướng giao lưu</h1><p>Bàn cờ chơi trực tiếp 2 người trên cùng màn hình — dành cho anh chị em ghé Nhà Chung giải trí. Đủ luật: mã cản chân, tượng không qua sông, pháo cần ngòi, chiếu tướng và cấm lộ mặt tướng.</p></div></div>
  <div class="cols">
    <div class="xq-wrap">
      <div class="xq-board">
        ${chessGridSvg()}
        <div class="xq-river">楚 河　　漢 界</div>
        ${pts.join('')}
      </div>
    </div>
    <aside class="cols-side">
```
(giữ nguyên toàn bộ phần `<aside class="cols-side">...</aside>` phía sau, không đổi)

Thay phần từ đầu hàm tới hết `</div>` đóng `.cols-side` mở (chỉ phần TRƯỚC `<aside>`) bằng:
```js
V.cotuong = ()=>{
  const st = CHESS;
  const turnTxt = st.turn==='r' ? 'Đỏ đi' : 'Đen đi';
  const reasonTxt = {chieu:'Chiếu tướng!', ['chieu-bi']:'Chiếu bí — hết cờ!', ['het-nuoc-di']:'Hết nước đi!', ['bat-tuong']:'Bắt được tướng!'}[st.reason]||'';
  return `
  <div class="page-head"><div><h1>Cờ tướng giao lưu</h1><p>Bàn cờ chơi trực tiếp 2 người trên cùng màn hình — dành cho anh chị em ghé Nhà Chung giải trí. Đủ luật: mã cản chân, tượng không qua sông, pháo cần ngòi, chiếu tướng và cấm lộ mặt tướng.</p></div></div>
  <div class="cols">
    ${chessBoardHtml(st.board, {selected:st.selected, legal:st.legal, lastMove:st.lastMove, flip:CHESS_FLIP, onCellClick:'chessCellClick'})}
    <aside class="cols-side">
```

Toàn bộ phần còn lại của hàm (từ `<div class="box" style="text-align:center">` tới hết) giữ nguyên y hệt.

- [ ] **Step 3: Kiểm tra bằng trình duyệt — `V.cotuong` vẫn chơi được y hệt trước refactor**

Dùng skill `browser-automation`, áp dụng đoạn bật màn thành viên ở Global Constraints, rồi:
```js
location.hash = '#cotuong';
```
Kỳ vọng: bàn cờ hiện đúng vị trí bắt đầu (16 quân mỗi bên), giao diện dùng CSS mới từ Task 1. Bấm chọn 1 quân Đỏ hợp lệ (ví dụ ô tương ứng quân Binh) rồi bấm ô sáng để đi — nước đi thực hiện đúng, đổi lượt sang Đen, không có lỗi console. Bấm "Ván mới" và "Đổi bên" hoạt động như cũ.

- [ ] **Step 4: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "refactor(cotuong): tach ham chessBoardHtml dung chung, ap dung cho V.cotuong"
```

---

### Task 3: Thuật toán AI (thuần, không đụng DOM)

**Files:**
- Modify: `web/thiet-ke-moi.html` — thêm khối mới ngay trước khối comment `V.cotuong — Cờ tướng giao lưu...` (tức ngay trước dòng hiện có `const CHESS_CHAR = {`, dòng ~3820), để engine AI nằm cạnh engine luật `xq*` nó dùng lại
- Test tạm (không commit): `<scratchpad>/xqai-test.mjs`

**Interfaces:**
- Consumes: `xqClone`, `xqOpp`, `xqLegalMoves`, `xqApplyMove`, `xqInitBoard` (đã có sẵn trong file)
- Produces: `XQ_VALUE`, `XQ_LEVELS`, `xqPieceValue(p,r)`, `xqEvaluate(board)`, `xqCountMoves(board,side)`, `xqAllMoves(board,side)` → `[{from:{r,c},to:{r,c},captured:bool}]`, `xqMinimax(board,side,depth,alpha,beta)` → số, `xqBestMoves(board,side,level)` → mảng nước đi đã lọc theo biên độ, sắp tốt dần, mỗi phần tử `{from,to,captured,val}`, `xqPickWeighted(list)` → 1 phần tử, `xqChooseMove(board,side,level)` → `{from,to}`. **Task 4 (Worker) và Task 5/7 (màn hình) gọi thẳng `xqChooseMove` qua Worker — không đổi tên/chữ ký các hàm này.**

- [ ] **Step 1: Viết kịch bản kiểm thử tạm (thất bại vì hàm chưa tồn tại)**

Tạo file `<thư mục scratchpad của phiên>/xqai-test.mjs`:
```js
// Kiểm thử tạm cho xqAI — KHÔNG commit vào repo, chỉ chạy bằng `node`.
// Dán các hàm xq* engine + xqAI vào đúng bên dưới (đồng bộ tay với bản trong
// thiet-ke-moi.html) rồi chạy: node xqai-test.mjs

function assert(cond, msg){ if(!cond){ console.error('THẤT BẠI:', msg); process.exitCode = 1; } else console.log('OK:', msg); }

// --- dán xqInitBoard/xqClone/xqOnBoard/xqOpp/xqRawMoves/xqFindGeneral/
//     xqSquareAttacked/xqFlyingGeneral/xqInCheck/xqLegalMoves/xqSideHasMoves/
//     xqApplyMove (copy y nguyên từ thiet-ke-moi.html) VÀO ĐÂY trước khi chạy lần 1 —
//     nếu chưa dán, các lệnh assert bên dưới sẽ ném ReferenceError, đúng như
//     bước "thất bại" mong đợi.

const b0 = xqInitBoard();
assert(xqEvaluate(b0) === 0, 'thế cờ khởi đầu cân bằng (0 điểm)');

// Đỏ hơn 1 xe: xoá xe Đen ở (0,0)
const b1 = xqClone(b0); b1[0][0] = null;
assert(xqEvaluate(b1) > 80, 'Đỏ hơn 1 xe (90 điểm) phải cho điểm dương lớn, có: ' + xqEvaluate(b1));

const moves = xqAllMoves(b0, 'r');
assert(moves.length === 44, 'Đỏ có đúng 44 nước đi hợp lệ ở thế khởi đầu, có: ' + moves.length);

const chosen = xqChooseMove(b0, 'r', 'kho');
assert(chosen && chosen.from && chosen.to, 'xqChooseMove trả về 1 nước đi hợp lệ có from/to');
assert(xqLegalMoves(b0, chosen.from.r, chosen.from.c).some(m=>m.r===chosen.to.r&&m.c===chosen.to.c), 'nước AI chọn nằm trong danh sách nước hợp lệ');
```

- [ ] **Step 2: Chạy, xác nhận thất bại**

```bash
node <đường dẫn scratchpad>/xqai-test.mjs
```
Kỳ vọng: `ReferenceError: xqInitBoard is not defined` (vì chưa dán engine luật vào) — đúng bước thất bại ban đầu.

- [ ] **Step 3: Dán engine luật hiện có vào file kiểm thử, chạy lại — assert đầu (`xqEvaluate` chưa định nghĩa) vẫn thất bại**

Copy nguyên văn các hàm `xqInitBoard, xqClone, xqOnBoard, xqOpp, xqRawMoves, xqFindGeneral, xqSquareAttacked, xqFlyingGeneral, xqInCheck, xqLegalMoves, xqSideHasMoves, xqApplyMove` từ `web/thiet-ke-moi.html` vào đầu `xqai-test.mjs`. Chạy lại — lần này lỗi phải là `xqEvaluate is not defined`.

- [ ] **Step 4: Cài đặt `xqAI` — thêm vào cả file kiểm thử và `thiet-ke-moi.html`**

Nội dung cài đặt (dán vào file kiểm thử VÀ chèn vào `thiet-ke-moi.html` ngay trước dòng `const CHESS_CHAR = {`):

```js
/* ══════════════════════════════════════════════════════════════
   xqAI — chọn nước đi cho máy. Hàm thuần, không đụng DOM, dùng lại
   move generator xq* ở trên. Chạy được cả ở main thread lẫn trong
   Web Worker (xem xqBuildWorker ở dưới) nên không được đụng DOM/window.
   ══════════════════════════════════════════════════════════════ */
const XQ_VALUE = {advisor:20, elephant:20, horse:40, cannon:45, chariot:90};
const XQ_LEVELS = { de:{depth:2, margin:80}, vua:{depth:3, margin:30}, kho:{depth:4, margin:5} };

function xqSoldierValue(r, side){ return (side==='r' ? r<=4 : r>=5) ? 20 : 10; }
function xqPieceValue(p, r){
  if(p.type==='soldier') return xqSoldierValue(r, p.side);
  if(p.type==='general') return 0;
  return XQ_VALUE[p.type];
}
function xqCountMoves(board, side){
  let n=0;
  for(let r=0;r<10;r++) for(let c=0;c<9;c++){
    const p=board[r][c];
    if(p && p.side===side) n += xqLegalMoves(board,r,c).length;
  }
  return n;
}
/* + tốt cho Đỏ, - tốt cho Đen. */
function xqEvaluate(board){
  let score=0;
  for(let r=0;r<10;r++) for(let c=0;c<9;c++){
    const p=board[r][c]; if(!p) continue;
    const v=xqPieceValue(p,r);
    score += p.side==='r' ? v : -v;
  }
  score += xqCountMoves(board,'r') - xqCountMoves(board,'b');
  return score;
}
function xqAllMoves(board, side){
  const out=[];
  for(let r=0;r<10;r++) for(let c=0;c<9;c++){
    const p=board[r][c];
    if(p && p.side===side){
      xqLegalMoves(board,r,c).forEach(m=>out.push({from:{r,c}, to:{r:m.r,c:m.c}, captured:!!board[m.r][m.c]}));
    }
  }
  out.sort((a,b)=>(b.captured?1:0)-(a.captured?1:0));
  return out;
}
function xqMinimax(board, side, depth, alpha, beta){
  const moves = xqAllMoves(board, side);
  if(moves.length===0) return side==='r' ? -99000 : 99000;
  if(depth===0) return xqEvaluate(board);
  const maximizing = side==='r';
  let best = maximizing ? -Infinity : Infinity;
  for(const m of moves){
    const res = xqApplyMove(board, m.from, m.to);
    const val = res.gameOver
      ? (res.winner==='r' ? 99000 : -99000)
      : xqMinimax(res.board, xqOpp(side), depth-1, alpha, beta);
    if(maximizing){ if(val>best) best=val; if(val>alpha) alpha=val; }
    else{ if(val<best) best=val; if(val<beta) beta=val; }
    if(beta<=alpha) break;
  }
  return best;
}
/* Tính điểm mọi nước ở gốc cây, trả về các nước trong biên độ margin so với
   nước tốt nhất (đã sắp tốt dần), để bên gọi chọn ngẫu nhiên có trọng số. */
function xqBestMoves(board, side, level){
  const cfg = XQ_LEVELS[level] || XQ_LEVELS.vua;
  const moves = xqAllMoves(board, side);
  const maximizing = side==='r';
  const scored = moves.map(m=>{
    const res = xqApplyMove(board, m.from, m.to);
    const val = res.gameOver
      ? (res.winner===side ? 99000 : -99000)
      : xqMinimax(res.board, xqOpp(side), cfg.depth-1, -Infinity, Infinity);
    return {from:m.from, to:m.to, captured:m.captured, val};
  });
  scored.sort((a,b)=> maximizing ? b.val-a.val : a.val-b.val);
  const bestVal = scored[0].val;
  return scored.filter(m => Math.abs(m.val-bestVal) <= cfg.margin);
}
/* Trọng số giảm dần theo thứ hạng (hạng 0 trọng số cao nhất). */
function xqPickWeighted(list){
  const weights = list.map((_,i)=> list.length - i);
  const total = weights.reduce((a,b)=>a+b,0);
  let r = Math.random()*total;
  for(let i=0;i<list.length;i++){ r-=weights[i]; if(r<=0) return list[i]; }
  return list[list.length-1];
}
function xqChooseMove(board, side, level){
  const m = xqPickWeighted(xqBestMoves(board, side, level));
  return {from:m.from, to:m.to};
}
```

- [ ] **Step 5: Chạy lại kịch bản kiểm thử, xác nhận đạt**

```bash
node <đường dẫn scratchpad>/xqai-test.mjs
```
Kỳ vọng: toàn bộ dòng in `OK: ...`, `process.exitCode` không bị set (không có dòng `THẤT BẠI`).

- [ ] **Step 6: Đối chiếu khối vừa chèn vào `thiet-ke-moi.html` khớp 100% với khối đã chạy qua kiểm thử ở Step 4** (copy-paste từ đúng 1 nguồn, không gõ lại tay 2 lần).

- [ ] **Step 7: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "feat(cotuong): them thuat toan AI (minimax + alpha-beta, 3 cap do)"
```

---

### Task 4: Web Worker + độ trễ "suy nghĩ"

**Files:**
- Modify: `web/thiet-ke-moi.html` — thêm ngay sau khối `xqAI` vừa thêm ở Task 3 (trước `const CHESS_CHAR = {`)

**Interfaces:**
- Consumes: `xqAllMoves`, `xqChooseMove`, `XQ_VALUE`, `XQ_LEVELS` và toàn bộ hàm engine luật (Task 3)
- Produces: `xqRequestMove(board, side, level)` → `Promise<{from:{r,c},to:{r,c}}>`, `xqStopWorker()`. **Task 5 và Task 7 gọi `xqRequestMove` mỗi khi tới lượt máy, và gọi `xqStopWorker()` khi rời màn.**

- [ ] **Step 1: Thêm mã dựng Worker + hàm yêu cầu nước đi**

Chèn ngay sau khối `xqAI` (các hàm `xqChooseMove` trở lên) đã thêm ở Task 3:

```js
/* Worker chạy xqChooseMove ngoài luồng chính để không đứng giao diện ở mức
   Khó. Không tách file .js riêng (dự án không có build step) — nạp mã worker
   bằng cách nối .toString() của đúng các hàm thuần cần thiết rồi tạo Blob. */
const XQ_WORKER_FNS = [xqClone, xqOnBoard, xqOpp, xqRawMoves, xqFindGeneral, xqSquareAttacked,
  xqFlyingGeneral, xqInCheck, xqLegalMoves, xqSideHasMoves, xqApplyMove,
  xqSoldierValue, xqPieceValue, xqCountMoves, xqEvaluate, xqAllMoves, xqMinimax, xqBestMoves, xqPickWeighted, xqChooseMove];
function xqBuildWorker(){
  const src = `const XQ_VALUE=${JSON.stringify(XQ_VALUE)};\nconst XQ_LEVELS=${JSON.stringify(XQ_LEVELS)};\n`
    + XQ_WORKER_FNS.map(fn=>fn.toString()).join('\n')
    + `\nself.onmessage=function(e){ const {board,side,level}=e.data; self.postMessage(xqChooseMove(board,side,level)); };`;
  const blob = new Blob([src], {type:'application/javascript'});
  return new Worker(URL.createObjectURL(blob));
}
let XQ_WORKER = null;
function xqGetWorker(){ if(!XQ_WORKER) XQ_WORKER = xqBuildWorker(); return XQ_WORKER; }
function xqStopWorker(){ if(XQ_WORKER){ XQ_WORKER.terminate(); XQ_WORKER=null; } }

const XQ_THINK_MS = { de:[500,1500], vua:[800,2000], kho:[1000,2800] };
/* Trả nước đi của máy sau 1 khoảng "suy nghĩ" tự nhiên — thời gian chờ tối
   thiểu tính song song với lúc Worker tính toán, không cộng dồn nối tiếp. */
function xqRequestMove(board, side, level){
  const [lo,hi] = XQ_THINK_MS[level] || XQ_THINK_MS.vua;
  const extra = Math.min(xqAllMoves(board, side).length * 15, 900);
  const minDelay = lo + Math.random()*(hi-lo) + extra;
  const started = Date.now();
  return new Promise(resolve=>{
    const w = xqGetWorker();
    w.onmessage = (e)=>{
      const wait = Math.max(0, minDelay - (Date.now()-started));
      setTimeout(()=>resolve(e.data), wait);
    };
    w.postMessage({board, side, level});
  });
}
```

- [ ] **Step 2: Kiểm tra bằng trình duyệt — Worker trả nước đi hợp lệ**

Dùng skill `browser-automation`, mở `web/thiet-ke-moi.html` (không cần đăng nhập, đây là hàm global thuần), chạy trong console:
```js
xqRequestMove(xqInitBoard(), 'r', 'kho').then(m => console.log('AI CHOSE:', JSON.stringify(m)));
```
Kỳ vọng: sau khoảng 1-3 giây, log in ra 1 object `{from:{r,c},to:{r,c}}` với toạ độ hợp lệ (r trong 0-9, c trong 0-8), không có lỗi console (không có lỗi "xqEvaluate is not defined" bên trong worker — dấu hiệu thiếu hàm khi build chuỗi worker).

- [ ] **Step 3: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "feat(cotuong): chay AI trong Web Worker, them do tre suy nghi tu nhien"
```

---

### Task 5: Màn "Chơi với máy"

**Files:**
- Modify: `web/thiet-ke-moi.html` — thêm state + hàm dùng chung + `V['cotuong-may']` ngay sau khối `V.cotuong = ()=>{...};` (sau dòng ~4166, trước comment `V.chat`)
- Modify: `web/thiet-ke-moi.html:1289` — dòng `if(PREV_SCREEN==='cotuong-van' && screen!=='cotuong-van') stopGameStream();` trong `render()`
- Modify: `web/thiet-ke-moi.html` — umenu (dòng chứa `Cờ tướng giao lưu`) và drawer footer (dòng chứa `data-go="cotuong"`)

**Interfaces:**
- Consumes: `chessBoardHtml` (Task 2), `xqRequestMove`/`xqStopWorker` (Task 4), `xqInitBoard/xqOpp/xqApplyMove/xqLegalMoves/chessSound` (đã có)
- Produces: `chessVsAiCellClick(state,r,c,onPlayerMoved)`, `chessVsAiMaybeMove(state,isStillCurrent)` — **Task 7 (cờ thế) gọi lại đúng 2 hàm này**, không viết lại logic áp nước đi lần nữa.

- [ ] **Step 1: Thêm state + 2 hàm dùng chung `chessVsAi*` + màn "Chơi với máy"**

Chèn ngay sau dấu `};` đóng `V.cotuong` (trước khối comment `V.chat`):

```js
/* ══════════════════════════════════════════════════════════════
   V['cotuong-may'] — chơi với máy (AI). Dùng chung 2 hàm chessVsAi* với
   V['cotuong-the'] (cờ thế, Task 7) — cả 2 chỉ khác nhau ở CÁCH nạp state
   ban đầu, không khác ở cách áp nước đi.
   ══════════════════════════════════════════════════════════════ */
let CHESS_AI = null; // null = đang ở màn chọn bên/cấp độ, chưa vào ván
let CHESS_AI_SETUP = { side:'r', level:'vua' };

/* Áp 1 nước đi của NGƯỜI vào state, vẽ lại, rồi gọi tiếp onPlayerMoved (thường
   là để kích máy đi nếu chưa xong ván). */
function chessVsAiPlayMove(state, from, to, onPlayerMoved){
  const res = xqApplyMove(state.board, from, to);
  state.lastMove = {from, to};
  state.justMoved = null;
  state.board = res.board;
  state.turn = xqOpp(state.board[to.r][to.c].side);
  state.selected = null; state.legal = [];
  if(res.gameOver){ state.over=true; state.winner=res.winner; state.reason=res.reason; chessSound('end'); }
  else if(res.checkOpp){ state.reason='chieu'; chessSound('check'); }
  else{ state.reason=null; chessSound(res.captured?'capture':'place'); }
  render();
  if(onPlayerMoved) onPlayerMoved();
}
function chessVsAiCellClick(state, r, c, onPlayerMoved){
  if(!state || state.over || state.thinking) return;
  if(state.turn !== state.playerSide) return;
  const p = state.board[r][c];
  if(state.selected){
    const isDest = state.legal.some(m=>m.r===r&&m.c===c);
    if(isDest){ chessVsAiPlayMove(state, state.selected, {r,c}, onPlayerMoved); return; }
    if(p && p.side===state.board[state.selected.r][state.selected.c].side){
      state.selected={r,c}; state.legal=xqLegalMoves(state.board,r,c); render(); return;
    }
    state.selected=null; state.legal=[]; render(); return;
  }
  if(p && p.side===state.turn){ state.selected={r,c}; state.legal=xqLegalMoves(state.board,r,c); render(); }
}
/* isStillCurrent: hàm kiểm tra "ván này còn là ván đang hiện trên màn không"
   — bắt buộc so bằng ĐỊNH DANH object (===), không so bằng biến global, để
   không áp nhầm nước máy vừa tính xong cho 1 ván đã bị "Ván mới"/đổi thế cờ
   ghi đè trong lúc Worker còn đang chạy. */
function chessVsAiMaybeMove(state, isStillCurrent){
  if(!state || state.over) return;
  if(state.turn === state.playerSide) return;
  state.thinking = true; render();
  xqRequestMove(state.board, state.turn, state.level).then(move=>{
    if(!isStillCurrent()) return;
    const res = xqApplyMove(state.board, move.from, move.to);
    state.lastMove = {from:move.from, to:move.to};
    state.justMoved = move.to;
    state.board = res.board;
    state.turn = xqOpp(state.board[move.to.r][move.to.c].side);
    state.thinking = false;
    if(res.gameOver){ state.over=true; state.winner=res.winner; state.reason=res.reason; chessSound('end'); }
    else if(res.checkOpp){ state.reason='chieu'; chessSound('check'); }
    else{ state.reason=null; chessSound(res.captured?'capture':'place'); }
    render();
  });
}

function chessAiSetSide(side){ CHESS_AI_SETUP.side = side; render(); }
function chessAiSetLevel(level){ CHESS_AI_SETUP.level = level; render(); }
function chessAiStart(){
  CHESS_AI = { board:xqInitBoard(), turn:'r', selected:null, legal:[], over:false, winner:null, reason:null,
    lastMove:null, justMoved:null, thinking:false, playerSide:CHESS_AI_SETUP.side, level:CHESS_AI_SETUP.level };
  render();
  const captured = CHESS_AI;
  chessVsAiMaybeMove(captured, ()=> CHESS_AI === captured);
}
function chessAiBackToSetup(){ xqStopWorker(); CHESS_AI = null; render(); }
function chessAiReset(){ chessAiStart(); }
function chessAiCellClick(r,c){
  chessVsAiCellClick(CHESS_AI, r, c, ()=>{
    const captured = CHESS_AI;
    chessVsAiMaybeMove(captured, ()=> CHESS_AI === captured);
  });
}

V['cotuong-may'] = ()=>{
  if(!CHESS_AI){
    return `
    <div class="page-head"><div><h1>Chơi với máy</h1><p>Chọn bên và cấp độ rồi bắt đầu ván — máy suy nghĩ và đi như một đối thủ thật, không phải lúc nào cũng đi nước tối ưu.</p></div></div>
    <div class="box" style="max-width:420px">
      <h3>Bạn cầm bên</h3>
      <div style="display:flex;gap:8px;margin:10px 0 18px">
        <button class="btn ${CHESS_AI_SETUP.side==='r'?'btn-blue':'btn-out'}" style="flex:1" onclick="chessAiSetSide('r')">Đỏ (đi trước)</button>
        <button class="btn ${CHESS_AI_SETUP.side==='b'?'btn-blue':'btn-out'}" style="flex:1" onclick="chessAiSetSide('b')">Đen</button>
      </div>
      <h3>Cấp độ máy</h3>
      <div style="display:flex;gap:8px;margin:10px 0 18px">
        <button class="btn ${CHESS_AI_SETUP.level==='de'?'btn-blue':'btn-out'}" style="flex:1" onclick="chessAiSetLevel('de')">Dễ</button>
        <button class="btn ${CHESS_AI_SETUP.level==='vua'?'btn-blue':'btn-out'}" style="flex:1" onclick="chessAiSetLevel('vua')">Vừa</button>
        <button class="btn ${CHESS_AI_SETUP.level==='kho'?'btn-blue':'btn-out'}" style="flex:1" onclick="chessAiSetLevel('kho')">Khó</button>
      </div>
      <button class="btn btn-blue btn-full" onclick="chessAiStart()">${ic('star',15)} Bắt đầu</button>
    </div>`;
  }
  const st = CHESS_AI;
  const flip = st.playerSide==='b';
  const turnTxt = st.turn===st.playerSide ? 'Tới lượt bạn' : 'Đối thủ đang đi...';
  const reasonTxt = {chieu:'Chiếu tướng!', ['chieu-bi']:'Chiếu bí — hết cờ!', ['het-nuoc-di']:'Hết nước đi!', ['bat-tuong']:'Bắt được tướng!'}[st.reason]||'';
  const levelLabel = {de:'Dễ', vua:'Vừa', kho:'Khó'}[st.level];
  return `
  <div class="page-head"><div><h1>Chơi với máy</h1><p>Cấp độ: ${levelLabel} · Bạn cầm bên ${st.playerSide==='r'?'Đỏ':'Đen'}</p></div></div>
  <div class="cols">
    ${chessBoardHtml(st.board, {selected:st.selected, legal:st.legal, lastMove:st.lastMove, flip, onCellClick:'chessAiCellClick', disabled: st.over||st.thinking||st.turn!==st.playerSide, justMovedTo:st.justMoved})}
    <aside class="cols-side">
      <div class="box" style="text-align:center">
        <div class="status ${st.over?'done':st.turn===st.playerSide?'accepted':'pending'}" style="font-size:14px;padding:8px 16px">${st.over?'Ván đã kết thúc':turnTxt}</div>
        ${reasonTxt?`<div class="notice ${st.over?'brand':'wait'}" style="margin-top:10px">${ic(st.over?'check':'bolt',16)}${reasonTxt}${st.over?` — Bên ${st.winner==='r'?'Đỏ':'Đen'} thắng!`:''}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-out" style="flex:1" onclick="chessAiReset()">${ic('refresh',15)} Ván mới</button>
          <button class="btn btn-out" style="flex:1" onclick="chessAiBackToSetup()">${ic('swap',15)} Đổi bên/cấp độ</button>
        </div>
      </div>
    </aside>
  </div>`;
};
```

- [ ] **Step 2: Dừng Worker khi rời màn**

Trong `render()` (dòng 1289), tìm:
```js
  if(PREV_SCREEN==='cotuong-van' && screen!=='cotuong-van') stopGameStream();
```
Thay bằng:
```js
  if(PREV_SCREEN==='cotuong-van' && screen!=='cotuong-van') stopGameStream();
  if((PREV_SCREEN==='cotuong-may'||PREV_SCREEN==='cotuong-the') && screen!=='cotuong-may' && screen!=='cotuong-the') xqStopWorker();
```

- [ ] **Step 3: Thêm mục điều hướng**

Trong `umenu` (dòng chứa `<a href="#cotuong-online" data-go="cotuong-online">${ic('star',15)} Cờ tướng giao lưu</a>`), thêm ngay sau dòng đó:
```html
<a href="#cotuong-may" data-go="cotuong-may">${ic('star',15)} Chơi với máy</a>
```

Trong drawer footer (dòng chứa `<a href="#cotuong" class="btn btn-out" data-go="cotuong">${ic('star',15)} Cờ tướng</a>`), thêm ngay sau đó (trong cùng chuỗi template, trước link "Hồ sơ của tôi"):
```html
<a href="#cotuong-may" class="btn btn-out" data-go="cotuong-may">${ic('star',15)} Chơi với máy</a>
```

- [ ] **Step 4: Kiểm tra bằng trình duyệt — chơi trọn 1 ván ở cả 3 cấp độ**

Dùng skill `browser-automation`, áp dụng đoạn bật màn thành viên ở Global Constraints, rồi với mỗi cấp độ (`de`, `vua`, `kho`):
```js
location.hash = '#cotuong-may';
chessAiSetLevel('kho'); // hoặc 'de' / 'vua'
chessAiStart();
```
Sau đó bấm 1 quân Đỏ hợp lệ và 1 ô đích (qua `document.querySelectorAll('.xq-pt')` để tìm nút đúng toạ độ rồi `.click()`, hoặc gọi thẳng `chessAiCellClick(r,c)` 2 lần trong console). Kỳ vọng:
- Sau nước của người, trạng thái chuyển "Đối thủ đang đi...", nút bàn cờ bị `disabled`.
- Sau khoảng thời gian hợp lý (không tức thì, không quá vài giây), máy tự đi 1 nước hợp lệ, bàn cờ cập nhật, quân vừa đi có hiệu ứng phóng to mờ dần.
- Không có lỗi console trong suốt quá trình.
- "Ván mới" và "Đổi bên/cấp độ" hoạt động đúng, không để lại ván cũ ảnh hưởng ván mới (thử bấm "Ván mới" ngay khi máy đang "suy nghĩ" — nước máy đang tính không được áp nhầm vào ván mới).

- [ ] **Step 5: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "feat(cotuong): them man Choi voi may (AI), 3 cap do"
```

---

### Task 6: Dữ liệu cờ thế

**Files:**
- Modify: `web/thiet-ke-moi.html` — thêm ngay sau khối vừa thêm ở Task 5 (sau `V['cotuong-may']`), trước comment `V.chat`

**Interfaces:**
- Consumes: `xqClone`, `xqInCheck`, `xqSideHasMoves`, `xqFindGeneral` (đã có sẵn)
- Produces: `xqPos(pieces)`, `CO_THE` (mảng `{id, name, level, playerSide, board}`). **Task 7 lọc/đọc trực tiếp mảng này.**

- [ ] **Step 1: Thêm hàm dựng vị trí + 6 thế cờ**

```js
/* ══════════════════════════════════════════════════════════════
   CO_THE — bộ thế cờ tĩnh cho chế độ "Cờ thế". Soạn dựa trên các tình huống
   tàn cuộc quen thuộc (chênh lệch quân, tốt/xe/pháo áp sát cung tướng...),
   KHÔNG phải bản chép lại các thế cờ cổ điển đã được kiểm chứng lời giải —
   xem ghi chú trong spec. Mỗi thế đã được kiểm tra: đúng 1 tướng mỗi bên,
   2 tướng không đối mặt trực diện, không bên nào đang bị chiếu sẵn lúc vào
   thế (xem bước kiểm tra ở cuối task).
   ══════════════════════════════════════════════════════════════ */
function xqPos(pieces){
  const b = Array.from({length:10},()=>Array(9).fill(null));
  pieces.forEach(([side,type,r,c])=>{ b[r][c] = {side,type}; });
  return b;
}
const CO_THE = [
  { id:'de-1', name:'Song xa đuổi tướng', level:'de', playerSide:'r', board: xqPos([
    ['r','general',9,4], ['r','chariot',2,1], ['r','chariot',3,7],
    ['b','general',1,3], ['b','advisor',0,4], ['b','elephant',0,2],
  ])},
  { id:'de-2', name:'Tốt qua sông áp cung', level:'de', playerSide:'r', board: xqPos([
    ['r','general',9,4], ['r','soldier',4,2], ['r','soldier',4,6], ['r','cannon',6,4],
    ['b','general',1,3], ['b','soldier',3,3],
  ])},
  { id:'vua-1', name:'Xe pháo phối hợp', level:'vua', playerSide:'r', board: xqPos([
    ['r','general',9,4], ['r','chariot',6,1], ['r','cannon',6,7], ['r','advisor',8,4],
    ['b','general',1,5], ['b','advisor',1,4], ['b','elephant',0,2], ['b','elephant',0,6], ['b','soldier',5,5],
  ])},
  { id:'vua-2', name:'Song pháo áp cung', level:'vua', playerSide:'r', board: xqPos([
    ['r','general',9,4], ['r','cannon',7,2], ['r','cannon',7,6], ['r','horse',6,4],
    ['b','general',1,4], ['b','advisor',0,3], ['b','advisor',0,5], ['b','elephant',2,2],
  ])},
  { id:'kho-1', name:'Cờ tàn cân bằng', level:'kho', playerSide:'r', board: xqPos([
    ['r','general',9,4], ['r','chariot',5,2], ['r','horse',6,6], ['r','advisor',8,4],
    ['b','general',1,5], ['b','chariot',2,6], ['b','advisor',0,4], ['b','elephant',2,2],
  ])},
  { id:'kho-2', name:'Chiếu bí trong thế phức tạp', level:'kho', playerSide:'r', board: xqPos([
    ['r','general',9,4], ['r','chariot',4,1], ['r','cannon',5,7], ['r','horse',7,2],
    ['b','general',1,3], ['b','advisor',0,4], ['b','elephant',0,2], ['b','soldier',6,3], ['b','horse',2,6],
  ])},
];
```

- [ ] **Step 2: Kiểm tra tính hợp lệ của cả 6 thế bằng trình duyệt**

Dùng skill `browser-automation`, mở `web/thiet-ke-moi.html`, chạy trong console (không cần đăng nhập — chỉ gọi hàm thuần):
```js
CO_THE.forEach(p=>{
  const reds = p.board.flat().filter(x=>x&&x.side==='r'&&x.type==='general').length;
  const blacks = p.board.flat().filter(x=>x&&x.side==='b'&&x.type==='general').length;
  const redInCheck = xqInCheck(p.board,'r');
  const blackInCheck = xqInCheck(p.board,'b');
  const mover = p.playerSide;
  const moverHasMoves = xqSideHasMoves(p.board, mover);
  console.log(p.id, {reds, blacks, redInCheck, blackInCheck, moverHasMoves});
});
```
Kỳ vọng cho **cả 6 dòng**: `reds:1, blacks:1, redInCheck:false, blackInCheck:false, moverHasMoves:true`. Nếu có thế nào sai (ví dụ 2 tướng, hoặc 1 bên đang bị chiếu sẵn), sửa lại toạ độ quân trong `CO_THE` cho thế đó rồi chạy lại tới khi cả 6 đều đạt.

- [ ] **Step 3: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "feat(cotuong): them du lieu 6 the co (2 moi cap do)"
```

---

### Task 7: Màn "Cờ thế"

**Files:**
- Modify: `web/thiet-ke-moi.html` — thêm ngay sau khối `CO_THE` (Task 6), trước comment `V.chat`
- Modify: `web/thiet-ke-moi.html` — umenu và drawer footer (thêm 1 dòng nữa, cạnh dòng đã thêm ở Task 5)

**Interfaces:**
- Consumes: `chessBoardHtml` (Task 2), `chessVsAiCellClick`/`chessVsAiMaybeMove` (Task 5), `CO_THE`/`xqClone` (Task 6, đã có)
- Produces: `V['cotuong-the']`

- [ ] **Step 1: Thêm state + hàm điều khiển + màn hình**

```js
/* ══════════════════════════════════════════════════════════════
   V['cotuong-the'] — cờ thế: chọn 1 thế có sẵn theo độ khó, chơi tiếp với
   AI (dùng lại chessVsAi* ở Task 5) tới khi chiếu bí hoặc bị chiếu bí.
   ══════════════════════════════════════════════════════════════ */
let CHESS_THE_LEVEL = 'de';
let CHESS_THE_IDX = 0;
let CHESS_THE = null;

function coTheList(level){ return CO_THE.filter(p=>p.level===level); }
function chessTheBuild(level, idx){
  const list = coTheList(level);
  if(!list.length) return null;
  const i = ((idx % list.length) + list.length) % list.length;
  const puz = list[i];
  return { board:xqClone(puz.board), turn:puz.playerSide, selected:null, legal:[], over:false, winner:null, reason:null,
    lastMove:null, justMoved:null, thinking:false, playerSide:puz.playerSide, level:puz.level,
    puzzleId:puz.id, name:puz.name, idx:i, total:list.length };
}
function chessTheEnsureLoaded(){
  if(!CHESS_THE) CHESS_THE = chessTheBuild(CHESS_THE_LEVEL, CHESS_THE_IDX);
}
function chessTheSetLevel(level){ CHESS_THE_LEVEL=level; CHESS_THE_IDX=0; CHESS_THE=chessTheBuild(level,0); render(); }
function chessThePrev(){ CHESS_THE=chessTheBuild(CHESS_THE_LEVEL, CHESS_THE_IDX-1); if(CHESS_THE) CHESS_THE_IDX=CHESS_THE.idx; render(); }
function chessTheNext(){ CHESS_THE=chessTheBuild(CHESS_THE_LEVEL, CHESS_THE_IDX+1); if(CHESS_THE) CHESS_THE_IDX=CHESS_THE.idx; render(); }
function chessTheRetry(){ CHESS_THE=chessTheBuild(CHESS_THE_LEVEL, CHESS_THE_IDX); render(); }
function chessTheCellClick(r,c){
  chessVsAiCellClick(CHESS_THE, r, c, ()=>{
    const captured = CHESS_THE;
    chessVsAiMaybeMove(captured, ()=> CHESS_THE === captured);
  });
}

V['cotuong-the'] = ()=>{
  chessTheEnsureLoaded();
  const levelDefs = [['de','Thế Dễ'],['vua','Thế Vừa'],['kho','Thế Khó']];
  const tabs = levelDefs.map(([lv,label])=>
    `<button class="btn ${CHESS_THE_LEVEL===lv?'btn-blue':'btn-out'} btn-sm" onclick="chessTheSetLevel('${lv}')">${label}</button>`
  ).join('');
  if(!CHESS_THE){
    return `<div class="page-head"><div><h1>Cờ thế</h1></div></div>
    <div style="display:flex;gap:8px;margin-bottom:18px">${tabs}</div>
    <div class="empty"><h3>Chưa có thế cờ nào ở mức này</h3></div>`;
  }
  const st = CHESS_THE;
  const flip = st.playerSide==='b';
  const turnTxt = st.turn===st.playerSide ? 'Tới lượt bạn' : 'Đối thủ đang đi...';
  const reasonTxt = {chieu:'Chiếu tướng!', ['chieu-bi']:'Chiếu bí — hết cờ!', ['het-nuoc-di']:'Hết nước đi!', ['bat-tuong']:'Bắt được tướng!'}[st.reason]||'';
  const solved = st.over && st.winner===st.playerSide;
  const failed = st.over && st.winner!==st.playerSide;
  return `
  <div class="page-head"><div><h1>Cờ thế — ${esc(st.name)}</h1><p>Bạn cầm bên ${st.playerSide==='r'?'Đỏ':'Đen'} · Thế ${st.idx+1}/${st.total}</p></div></div>
  <div style="display:flex;gap:8px;margin-bottom:18px">${tabs}</div>
  <div class="cols">
    ${chessBoardHtml(st.board, {selected:st.selected, legal:st.legal, lastMove:st.lastMove, flip, onCellClick:'chessTheCellClick', disabled: st.over||st.thinking||st.turn!==st.playerSide, justMovedTo:st.justMoved})}
    <aside class="cols-side">
      <div class="box" style="text-align:center">
        <div class="status ${st.over?'done':st.turn===st.playerSide?'accepted':'pending'}" style="font-size:14px;padding:8px 16px">${st.over?'Ván đã kết thúc':turnTxt}</div>
        ${solved?`<div class="notice brand">${ic('check',16)}Giải thành công!</div>`:''}
        ${failed?`<div class="notice wait">${ic('bolt',16)}Chưa xong, thử lại thế này.</div>`:''}
        ${!st.over&&reasonTxt?`<div class="notice wait" style="margin-top:10px">${ic('bolt',16)}${reasonTxt}</div>`:''}
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="btn btn-out" style="flex:1" onclick="chessThePrev()">← Thế trước</button>
          <button class="btn btn-out" style="flex:1" onclick="chessTheNext()">Thế sau →</button>
        </div>
        <button class="btn btn-out btn-full" style="margin-top:8px" onclick="chessTheRetry()">${ic('refresh',15)} Chơi lại thế này</button>
      </div>
    </aside>
  </div>`;
};
```

- [ ] **Step 2: Dừng lại đúng chỗ khi rời màn** — đã xử lý chung cho cả `cotuong-may` và `cotuong-the` ở Task 5 Step 2, không cần sửa thêm.

- [ ] **Step 3: Thêm mục điều hướng**

Trong `umenu`, ngay sau dòng vừa thêm ở Task 5 (`<a href="#cotuong-may" ...>Chơi với máy</a>`), thêm:
```html
<a href="#cotuong-the" data-go="cotuong-the">${ic('star',15)} Cờ thế</a>
```

Trong drawer footer, ngay sau dòng vừa thêm ở Task 5, thêm:
```html
<a href="#cotuong-the" class="btn btn-out" data-go="cotuong-the">${ic('star',15)} Cờ thế</a>
```

- [ ] **Step 4: Kiểm tra bằng trình duyệt — duyệt hết danh sách, giải ít nhất 1 thế Dễ và 1 thế Khó**

Dùng skill `browser-automation`, áp dụng đoạn bật màn thành viên ở Global Constraints, rồi:
```js
location.hash = '#cotuong-the';
```
Kỳ vọng ban đầu: tab "Thế Dễ" đang chọn, hiện thế `de-1` (1/2), bàn cờ vẽ đúng theo dữ liệu `CO_THE`.

- Bấm "Thế sau" → sang `de-2` (2/2); bấm "Thế sau" lần nữa → quay vòng về `de-1` (1/2).
- Chuyển tab "Thế Khó" → hiện `kho-1` (1/2).
- Chơi thử 1 thế Dễ tới khi chiếu bí Đen thành công (gọi `chessTheCellClick(r,c)` 2 lần mỗi nước qua console, xen kẽ chờ máy đi) — banner "Giải thành công!" hiện đúng.
- Bấm "Chơi lại thế này" — thế nạp lại từ đầu, không giữ trạng thái ván vừa thắng.
- Không có lỗi console trong suốt quá trình.

- [ ] **Step 5: Commit**

```bash
git add web/thiet-ke-moi.html
git commit -m "feat(cotuong): them man Co the (giai the co co san, dau voi AI)"
```

---

## Tự rà soát (self-review)

**Phủ hết spec:**
- Mục 1 (kiến trúc) → Task 2 (`chessBoardHtml` dùng chung), Task 3-4 (`xqAI` tách namespace thuần). Riêng việc dùng chung cho **cả `cotuong-van`** (spec mục 1.2 nói "cả 5 nơi") đã **thu hẹp còn 3 nơi chạy client-thuần** (`cotuong`, `cotuong-may`, `cotuong-the`) — xem ghi chú dưới.
- Mục 2 (hình ảnh) → Task 1.
- Mục 3 (AI) → Task 3 (thuật toán), Task 4 (Worker + độ trễ), Task 5 (màn hình + điều hướng).
- Mục 4 (cờ thế) → Task 6 (dữ liệu), Task 7 (màn hình + điều hướng).
- Mục 5 (kiểm thử) → mỗi task có bước kiểm tra bằng trình duyệt hoặc node riêng.
- Mục 6 (ngoài phạm vi) → không task nào động tới gợi ý nước đi, lưu tiến trình, engine WASM, hay backend.

**Sai lệch có chủ đích so với spec (đã nêu rõ trong Global Constraints và đã sửa lại spec tương ứng):**
1. `V['cotuong-van']` (đấu người thật online) **không** bị refactor sang `chessBoardHtml` — vẫn giữ khối vẽ riêng. Lý do: đã tự động đẹp lên nhờ CSS dùng chung ở Task 1 (cùng tên class `.xq-*`) mà không cần đụng vào logic của 1 tính năng đang chạy thật với người dùng thật; refactor thêm chỉ tăng rủi ro cho tính năng đó mà không thêm giá trị.
2. Animation "quân cờ trượt" đổi thành "phóng to mờ dần" — đã cập nhật trong spec (mục 3.3) kèm lý do kỹ thuật (kiến trúc `render()` thay toàn bộ `innerHTML`, không có node bền vững giữa 2 lần vẽ để transition toạ độ).
3. Số thế cờ: 6 (2/cấp độ) thay vì 12-15 — đã cập nhật trong Global Constraints, dữ liệu theo khuôn `xqPos(...)` nên thêm thế mới sau này không cần đổi cấu trúc.

**Rà soát placeholder:** không còn "TBD"/"TODO"/"tương tự Task N" — mọi bước code đều có mã đầy đủ, kể cả 6 thế cờ (toạ độ cụ thể) và test node (assertion cụ thể).

**Nhất quán tên/chữ ký:** `chessBoardHtml(board, opts)` dùng đúng 1 chữ ký xuyên suốt Task 2/5/7. `chessVsAiCellClick`/`chessVsAiMaybeMove` định nghĩa ở Task 5, tái dùng nguyên văn ở Task 7 (không định nghĩa lại). `xqRequestMove`/`xqStopWorker` định nghĩa ở Task 4, dùng ở Task 5/7. `CO_THE`/`xqPos` định nghĩa ở Task 6, đọc ở Task 7.
