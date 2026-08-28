# Cờ tướng — Nâng cấp hình ảnh, chơi với máy (AI), cờ thế

- **Ngày:** 2026-08-27
- **Phạm vi:** Nâng cấp hình ảnh bàn cờ/quân cờ cho mọi màn cờ tướng hiện có; thêm chế độ chơi với máy (AI) với 3 cấp độ; thêm chế độ cờ thế (giải thế cờ dở sẵn, đấu với AI, xếp theo 3 cấp độ).
- **Ngoài phạm vi:** thay đổi backend/API (mọi thứ chạy client-side), lưu tiến trình giải cờ thế, hiển thị gợi ý nước đi cho người chơi, engine AI mạnh kiểu chuyên nghiệp (WASM).

---

## 0. Bốn quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Vị trí code | Tất cả trong `web/thiet-ke-moi.html`, không tách file/build step | Đúng pattern hiện tại của file (hàm thuần `xq*`, object `V[]`, CSS trong `<style>`) |
| Cách xây AI | JS thuần (minimax + alpha-beta), chạy trong Web Worker | Không cần hạ tầng mới, dễ chỉnh "giống người" qua ngẫu nhiên hoá + độ trễ, không nặng như engine WASM |
| Hình ảnh | Chỉ CSS/SVG nâng cao, không thêm ảnh ngoài | Không lo bản quyền ảnh, không phụ thuộc mạng, tải nhanh |
| Nội dung cờ thế | Bộ thế cờ tĩnh nhúng trong code (~12-15 thế, 3 cấp độ) | Không cần backend, làm nhanh, dễ thêm sau |

---

## 1. Kiến trúc và ranh giới

### 1.1 Các mảnh mới trong `thiet-ke-moi.html`

```
<style>
  .xq-wrap, .xq-board, .xq-pc, .xq-dot, .xq-pt   ← CSS nâng cấp (áp dụng chung)

<script>
  // Engine luật đã có, không đổi
  xqInitBoard, xqLegalMoves, xqApplyMove, xqInCheck, ...

  // Mới — hàm thuần, không đụng DOM
  xqAI.evaluate(board)          // lượng giá thế cờ theo góc nhìn 'r'
  xqAI.search(board, side, level) // trả nước đi được chọn (chạy trong Worker)

  // Mới — render dùng chung, thay vì lặp lại ở 3 màn
  chessBoardHtml(board, opts)   // opts: {selected, legal, lastMove, flip, onCellClick, disabled}

  // Mới — dữ liệu tĩnh
  CO_THE = [ {id, name, level, playerSide, board}, ... ]

  // Mới — màn hình
  V['cotuong-may']   // chơi với máy: chọn bên + cấp độ, rồi vào ván
  V['cotuong-the']   // cờ thế: tab cấp độ + Thế Trước/Thế Sau
</script>
```

### 1.2 Refactor đi kèm (không phải phạm vi mới, chỉ dọn khi chạm tới)

Hiện `V.cotuong` và `chessCellClick` build HTML bàn cờ trực tiếp trên biến toàn cục `CHESS`, và `V['cotuong-van']` lặp lại gần y hệt khối vẽ đó cho state online. Thêm 2 màn nữa (`cotuong-may`, `cotuong-the`) mà copy-paste tiếp thì thành 5 bản gần giống nhau. Sẽ tách phần vẽ điểm/quân cờ (đoạn build `pts[]` ở dòng ~3908-3919 và ~3954-3965) thành một hàm `chessBoardHtml(board, {selected, legal, lastMove, flip, onCellClick, disabled})` dùng chung cho cả 5 nơi. Đây là refactor tối thiểu, không đổi hành vi màn cũ.

### 1.3 Trạng thái ván cờ

Mỗi chế độ giữ state riêng (không dùng chung `CHESS` để tránh xung đột khi chuyển màn):

- `CHESS` — pass-and-play, giữ nguyên như hiện tại.
- `CHESS_AI` — ván đấu với máy: `{board, turn, selected, legal, over, winner, reason, lastMove, playerSide, level, thinking}`.
- `CHESS_THE` — ván cờ thế: giống `CHESS_AI` cộng `{puzzleId}`, được nạp lại mỗi khi đổi thế cờ.

---

## 2. Nâng cấp hình ảnh

Chỉ sửa CSS + màu trong `chessGridSvg()`, không đổi cấu trúc HTML hay logic vẽ (`.xq-pt`, `.xq-pc`, `.xq-dot` giữ nguyên tên class và ý nghĩa).

| Phần tử | Hiện tại | Nâng cấp |
|---|---|---|
| `.xq-wrap` | Không có nền riêng | Thêm nền dạ xanh đậm (gradient tối 2 tông) bao quanh bàn cờ, bo góc, padding, giống khung ảnh mẫu |
| `.xq-board` | Nền phẳng `#F3E4C0`, viền 1px | Gradient vân gỗ nhiều lớp (radial-gradient lặp + repeating-linear-gradient nhạt để tạo vân), viền gỗ đậm dày hơn (`border` 3-4px tông nâu sậm), `box-shadow` 2 lớp (đổ bóng ngoài mạnh hơn + inset nhẹ tạo lõm) |
| Đường kẻ (`chessGridSvg`) | `stroke="var(--ink2)"` (xám) | Đổi sang tông nâu sậm cố định (vd `#7a5326`), giữ nguyên toạ độ/logic vẽ |
| `.xq-pc` | Tròn viền 1.5px, nền `#FBF3DE` phẳng | Radial-gradient sáng tâm/tối viền (mô phỏng đĩa gỗ khắc chữ nổi khối), `box-shadow` nhiều lớp: đổ bóng dưới quân (tạo cảm giác nổi khỏi mặt bàn) + viền sáng mảnh phía trên (bevel). Giữ nguyên `.red`/`.black` chỉ đổi màu chữ |
| `.xq-pc.sel` / `.xq-pt.last .xq-pc` | outline đơn | Đổi thành glow (box-shadow lan toả màu `--brand`) cho mềm mắt hơn, không dùng outline cứng |
| `.xq-dot` | Chấm xanh rêu đặc | Giữ ý tưởng chấm gợi ý, chỉnh màu/độ mờ cho hợp tông gỗ mới |

Không thêm biến thể theo dark-mode riêng ngoài các biến CSS đã dùng (`--brand`, `--bad`...) — bàn cờ dùng bảng màu cố định (gỗ/dạ xanh) giống ảnh mẫu, không đổi theo theme sáng/tối của app.

---

## 3. AI chơi với máy

### 3.1 Lượng giá (`xqAI.evaluate`)

Giá trị quân (điểm chuẩn cờ tướng):

| Quân | Điểm |
|---|---|
| Sĩ / Tượng | 20 |
| Mã | 40 |
| Pháo | 45 |
| Xe | 90 |
| Tốt chưa qua sông | 10 |
| Tốt đã qua sông | 20 |

`evaluate(board)` = tổng điểm quân bên Đỏ trừ tổng điểm quân bên Đen, cộng thêm bonus nhỏ: số nước đi hợp lệ khả dụng của mỗi bên (mobility, hệ số thấp ~1 điểm/nước) để AI không đứng yên một chỗ. Hàm thuần, không đụng DOM, dễ viết vài phép thử độc lập trong console.

### 3.2 Tìm kiếm (`xqAI.search`)

- Minimax + alpha-beta pruning trên `xqLegalMoves`/`xqApplyMove` đã có.
- Sắp xếp nước ăn quân trước (move ordering đơn giản: nước có `captured` xét trước) để alpha-beta cắt tỉa hiệu quả hơn.
- Độ sâu theo cấp độ: **Dễ = 2 ply, Vừa = 3 ply, Khó = 4 ply.**
- Ở gốc cây, tính điểm cho **từng** nước đi hợp lệ (không chỉ trả về 1 nước tốt nhất), rồi chọn theo cấp độ:
  - **Dễ:** lấy mọi nước trong khoảng ±80 điểm so với nước tốt nhất, chọn ngẫu nhiên có trọng số (nước gần tốt nhất có xác suất cao hơn) — mô phỏng người mới hay bỏ lỡ nước tối ưu.
  - **Vừa:** khoảng ±30 điểm, trọng số nghiêng mạnh hơn về nước tốt.
  - **Khó:** khoảng ±5 điểm (gần như luôn chọn nước tốt nhất, chỉ né việc luôn đi y hệt một kiểu khi có nhiều nước ngang điểm).
- Chạy trong **Web Worker** (tạo qua `Blob` + `URL.createObjectURL`, không cần file `.js` riêng) để không đứng giao diện khi tính ở mức Khó. Worker nhận `{board, side, level}`, trả về `{from, to}`.

### 3.3 Giả lập "suy nghĩ" giống người

- Trước khi hiển thị nước đi của máy, chờ thêm một khoảng ngẫu nhiên: cơ số theo cấp độ (Dễ 500–1500ms, Vừa 800–2000ms, Khó 1000–2800ms) **cộng thêm** một phần nhỏ tỉ lệ với số nước hợp lệ ở gốc cây (thế cờ càng nhiều lựa chọn, máy "cân nhắc" càng lâu, có giới hạn trần).
- Trong lúc chờ, bàn cờ hiện trạng thái "Đối thủ đang đi..." (giống cách `cotuong-van` đang hiện "Đang chờ đối thủ"), người chơi không click được.
- Khi máy đi xong, quân cờ ở ô đích xuất hiện bằng hiệu ứng phóng to mờ dần (`@keyframes` scale+opacity, gắn qua class khi vẽ lại) thay vì bật ra tức thì. **Lưu ý kỹ thuật:** không dùng animation "trượt" thật (di chuyển toạ độ) vì `render()` hiện thay toàn bộ `innerHTML` của trang mỗi lần vẽ lại — các nút `.xq-pt` được định danh theo **toạ độ ô**, không theo quân cờ, nên không có 1 node DOM nào thực sự "di chuyển" giữa 2 lần vẽ để mà transition toạ độ. Hiệu ứng phóng to mờ dần trên quân ở ô đích đạt được cảm giác "vừa có gì đó xảy ra" tương đương mà không cần viết lại kiến trúc render.
- Không hiển thị gợi ý/đánh giá nước đi cho người chơi ở chế độ này (khác với để lộ máy đang "tính toán").

### 3.4 Màn `V['cotuong-may']`

- Trạng thái ban đầu (chưa vào ván): cho chọn bên (Đỏ mặc định) + cấp độ (Vừa mặc định) + nút "Bắt đầu".
- Vào ván: dùng `chessBoardHtml` để vẽ, người chơi click đi quân của mình; khi tới lượt máy, gọi `xqAI.search` qua Worker rồi áp nước đi qua `xqApplyMove` như hiện tại.
- Nút "Ván mới" (giữ nguyên bên/cấp độ), "Đổi cấp độ/bên" (quay lại màn chọn), "Xin thua".
- Thêm mục điều hướng "Chơi với máy" cạnh "Cờ tướng giao lưu" ở menu (dòng ~1359, ~1392).

---

## 4. Cờ thế

### 4.1 Dữ liệu

```js
const CO_THE = [
  {
    id: 'de-1',
    name: 'Tốt qua hà uy hiếp',
    level: 'de',           // 'de' | 'vua' | 'kho'
    playerSide: 'r',
    board: /* mảng 10x9 cùng khuôn dạng xqInitBoard(), phần lớn ô null */
  },
  // ... ~4-5 thế mỗi cấp độ, tổng ~12-15 thế
];
```

Các thế được soạn dựa trên các tình huống tàn cuộc quen thuộc (chênh lệch quân số, tốt/xe/pháo áp sát cung tướng đối phương...), **không phải bản chép lại chính xác các "cờ thế" cổ điển có tên riêng đã được kiểm chứng lời giải** — vì không có cách xác minh độc lập lời giải của các thế cổ trong phạm vi dự án này. Mỗi thế được soạn để bên người chơi có lợi thế rõ ràng (chất/lượng quân) phù hợp độ khó, và là một vị trí hợp lệ (tướng không đối mặt, không đang bị chiếu bí sẵn).

### 4.2 Màn `V['cotuong-the']`

- Tab "Thế Dễ / Thế Vừa / Thế Khó" lọc danh sách `CO_THE` theo `level`.
- Nút "Thế Trước / Thế Sau" chuyển vị trí trong danh sách đang lọc (có quay vòng).
- Chọn 1 thế → nạp vào `CHESS_THE` (board từ dữ liệu, `turn` = `playerSide`), vẽ bằng `chessBoardHtml`.
- Người chơi đi trước theo `playerSide`; sau mỗi nước của người chơi, nếu ván chưa kết thúc thì máy (dùng chung `xqAI.search`, cấp độ máy = cấp độ của thế: Dễ dùng độ mạnh Dễ, v.v.) đi bên còn lại — tái dùng toàn bộ luồng ở mục 3.2-3.3.
- Kết thúc ván (dùng `gameOver`/`winner` có sẵn từ `xqApplyMove`):
  - Người chơi thắng → banner "Giải thành công!" + nút "Thế tiếp theo".
  - Máy thắng (người chơi đi hớ) → banner "Chưa xong, thử lại thế này" + nút "Chơi lại".
- Không lưu trạng thái đã-giải giữa các phiên (bản đầu).

---

## 5. Kiểm thử

Không có test framework frontend sẵn có trong repo (chỉ `api/tests` cho backend), engine cờ tướng nằm inline trong 1 file HTML — không thêm hạ tầng test mới cho việc này. Kiểm thử bằng cách chạy thật qua trình duyệt (browser-automation):

1. Nâng cấp hình ảnh không phá vỡ 3 màn cờ hiện có (`cotuong`, `cotuong-online` + `cotuong-van`) — vẫn đi quân, ăn quân, chiếu tướng đúng như trước.
2. `Chơi với máy`: chơi thử ít nhất 1 ván trọn vẹn ở mỗi cấp độ (Dễ/Vừa/Khó) — máy luôn đi nước hợp lệ, có độ trễ "suy nghĩ", không đứng hình giao diện lúc máy tính nước.
3. `Cờ thế`: mở từng tab độ khó, dùng Thế Trước/Thế Sau duyệt hết danh sách, chơi thử ít nhất 2 thế (1 dễ, 1 khó) tới khi kết thúc ván — banner thắng/thua hiện đúng.
4. Không có lỗi console phát sinh ở cả 3 mục trên.

---

## 6. Việc không làm ở lần này

- Không thêm nút "gợi ý nước đi" hay hiển thị điểm lượng giá cho người chơi.
- Không lưu tiến trình cờ thế qua các phiên/thiết bị.
- Không tích hợp engine mạnh dạng WASM (Pikafish...).
- Không đổi backend/API — `cotuong-online` (đấu người thật qua server) giữ nguyên không đụng tới.
