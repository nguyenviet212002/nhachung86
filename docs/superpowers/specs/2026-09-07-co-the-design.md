# Sảnh Cờ NHACCON6789 — Cờ Thế (module mới `api/src/modules/co-the`)

- **Ngày:** 2026-09-07
- **Nguồn yêu cầu:** `BAN_CHUAN_CO_THE.md`, `SANH_CO_GIAO_VIEC_DAY_DU.md` (Phần V) — đo từ máy ROSA, **không phụ thuộc ROSA**, xây mới cho dự án này.
- **Phạm vi:** sub-project kế tiếp sau Kernel+Engine
  (`docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md`, đã gộp
  `main`) và sau giao diện phòng/khách Cờ Tướng
  (`docs/superpowers/specs/2026-09-07-cotuong-phong-khach-ui-design.md`, đã
  gộp `main`). Dựng đủ 10 khối theo bản chuẩn: Trạng thái · Bày quân · Chốt
  thế/vào trận · ⚖ phân tích · Đối thủ · trình độ/số lần thử · ⚔ Tìm cách phá
  · Đang đấu · Đường giải · 🏛 diễn giải — cộng Luyện Thế 3 cấp, Mổ ván, Hồ sơ
  tự ghi, Kho thế (schema + duyệt/phân loại — nội dung thật để sau), màn
  khách/người xem.
- **Ngoài phạm vi:** Bảng tàn cuộc (chính `BAN_CHUAN_CO_THE.md` §7 cấm dựng);
  nội dung thật của Kho Thế cổ (sưu tầm tư liệu — `BAN_CHUAN_CO_THE.md` §11
  ghi "chưa định nguồn"); vòng học khép kín nối lỗi Cờ Tướng PvP thật ↔ bài
  luyện Cờ Thế (`BAN_CHUAN_CO_THE.md` §9 — cần hạ tầng mổ ván ACPL cho Cờ
  Tướng PvP, chưa có); "nhịp theo đối thủ" tinh chỉnh thời gian hiện nước
  (đã hoãn ở spec Engine, mục 9).

> **Quy ước trích dẫn trong tài liệu này:** `§N` (có dạng số La Mã/thập
> phân như tài liệu gốc) luôn trỏ tới `BAN_CHUAN_CO_THE.md` hoặc
> `SANH_CO_GIAO_VIEC_DAY_DU.md` (ghi rõ tên file khi trích). Tham chiếu tới
> **mục của chính tài liệu này** dùng chữ "mục N" (không có dấu `§`).

---

## 0 · Quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Module ở đâu | `api/src/modules/co-the/` **mới**, không mở rộng `games/service.js` | Cờ Thế là 1 người tự giải/luyện trước máy — không có phòng 2 người thật, không đồng hồ tính giờ thi đấu, không hợp với cột PvP-riêng (`red_ready_at`, `draw_offered_by`...) của `games` |
| Luật cờ | Import thẳng các hàm thuần đã có trong `rules.js` (`applyMove`, `legalMoves`, `hashBoard`, `detectRepetition`, `detectNoCaptureDraw`, `boardToFen`, `uciMoveToCells`, `findGeneral`, `flyingGeneral`) | Một nguồn luật duy nhất — đúng nguyên tắc I.1 của tài liệu; các hàm này không đụng CSDL, tái dùng an toàn |
| Máy phân tích | `engineClient.bestMove({fen, movetime, multipv})` dùng nguyên | Hợp đồng đã chạy thật qua Pikafish thật, đã qua soát xét — không đổi hình dạng |
| Chọn nước bên máy (Đối thủ · trình độ VÀ Luyện Thế 3 cấp) | Dùng lại `aiSelect.selectAiMove(lines, level, rng)` đã có (3 cấp `sieu`/`thong-minh`/`xuat-sac`) | Cùng một bài toán "chọn 1 trong N nước MultiPV theo ngưỡng chênh điểm" — không viết lại logic thứ hai |
| Tên gọi "nhaccon6789" | **Không dùng** — giữ đúng tiền lệ đã chốt ở nhánh `cotuong-phong-khach-ui` (không nhân cách hoá máy). Ba việc "nói/phân tích/diễn giải" của tài liệu vẫn giữ, chỉ đổi nhãn tiếng Việt trơn: **Kết luận / Phân tích / Diễn giải** | Nhất quán với quyết định đã có trong dự án, không tự ý lệch lần nữa |
| Khối riêng tư & màn khách | Route/endpoint riêng cho khách (không CSS-hide) — mô phỏng đúng `requireAuthOrGuestToken`/`guestFetch`/`GUEST_TOKEN` vừa dựng cho phòng Cờ Tướng, không tạo hệ tài khoản tạm | `SANH_CO_GIAO_VIEC_DAY_DU.md` §I.2 tự cảnh báo cách CSS-hide không an toàn; hạ tầng mẫu đã có, đã qua review |
| Giao diện | Dùng lại khung `.xq-fs-card`/`.xq-fs-panel` (mở/thu, tự thu khi chọn xong) hiện có | Nhất quán trải nghiệm; không chờ/phụ thuộc dự án "thiết kế mới" đang làm song song ở nhánh khác |
| Đồng hồ | **Không có** — Cờ Thế không thi đấu tính giờ, bản chuẩn liệt Trạng thái/Đang đấu không có mục đồng hồ nào (khác hẳn Cờ Tướng PvP) | Giữ đúng những gì đo được trong tài liệu, không thêm thứ nó không có |

---

## 1 · Kiến trúc

```
┌─────────┐  soạn thế/đi nước/luyện   ┌──────────────────────┐   FEN, movetime   ┌─────────┐
│  Web     │ ────────────────────────► │  api/modules/co-the   │ ─────────────────► │ engine   │
│ (giữ     │ ◄──────────────────────── │  + rules.js (tái dùng)│ ◄───────────────── │ Pikafish │
│ .xq-fs-*)│   SSE /stream (rút gọn    │  + engineClient.js    │  bestmove/score_cp │  (UCI)   │
└─────────┘   cho khách xem)           └──────────────────────┘                     └─────────┘
```

`co-the` là module ngang hàng `games`, không phụ thuộc nó ngoài việc dùng
chung `rules.js`/`engineClient.js`/`core/realtime.js` — 3 thứ vốn đã tách
bạch, không đụng vào CSDL trực tiếp của `games`.

---

## 2 · Mô hình dữ liệu (migration mới — xác nhận đúng số kế tiếp lúc dựng,
không hard-code, vì nhiều nhánh có thể đang tạo migration song song)

Theo đúng khuôn `048_chess_games.js`: mọi bảng `community_id`-scoped, khoá
ngoài ghép `(id, community_id)`, `REVOKE ALL` rồi `GRANT SELECT,INSERT,UPDATE`
cho `app_role`, có `down()`.

### 2.1 `co_the_positions` — một thế cờ đã soạn (nháp hoặc đã lưu kho)

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id`, `community_id` | uuid | chuẩn |
| `created_by_member_id` | uuid, NULL | NULL = thế mẫu hệ thống nạp sẵn trong community đó |
| `board` | jsonb NOT NULL | cùng hình dạng `{side,type}` theo ô như `games.board` |
| `side_to_move` | text CHECK ('r','b') | |
| `origin` | text CHECK ('tu-soan','kho-co-dien') DEFAULT 'tu-soan' | ai tạo ra thế này |
| `category` | text NULL CHECK (NULL hoặc 1 trong 'tan-cuoc-it-quan','sat-cuoc','nghe-thuat','nhieu-nghiem','loi') | phân loại theo `SANH_CO_GIAO_VIEC_DAY_DU.md` §V.5 — chỉ gán khi lưu vào kho |
| `label` | text NULL | tên hiển thị trong Kho thế |
| `saved_to_library` | boolean NOT NULL DEFAULT false | phân biệt "chỉ giải nháp" (Chiều B tự do) và "đã lưu Kho thế" |
| `verdict` | text NULL CHECK ('thang','hoa','thua') | kết quả **Phân tích** cho `side_to_move` |
| `verdict_certainty` | text NULL CHECK ('chung-minh','uoc-luong') | đọc theo bảng `BAN_CHUAN_CO_THE.md` §3.2: `mate≠0` → chứng minh, còn lại → ước lượng |
| `verdict_score_cp`, `verdict_mate`, `verdict_depth` | int NULL | |
| `engine_version`, `engine_movetime_ms` | text/int NULL | ghi kèm để so được lần sau (`BAN_CHUAN_CO_THE.md` §3.3/§4.4) |
| `analyzed_at` | timestamptz NULL | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

### 2.2 `co_the_sessions` — một lượt vào trận cụ thể (giải hoặc luyện)

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id`, `community_id` | uuid | |
| `position_id` | uuid NOT NULL, FK ghép → `co_the_positions` | |
| `solver_member_id` | uuid NOT NULL, FK ghép → `members` | luôn cần đăng nhập, đúng "màn Chủ Công cần đăng nhập" |
| `solver_side` | text CHECK ('r','b') | bên người giải cầm |
| `mode` | text CHECK ('giai','luyen-the') | |
| `opponent_level` | text NULL CHECK ('yeu','vua','manh') | độ khó bên máy chống — dùng khi `mode='giai'`, tái dùng cơ chế `selectAiMove` nhưng đảo ngược mục đích (chống yếu = dễ cho người giải) |
| `luyen_the_cap` | text NULL CHECK ('ha','trung','cao') | dùng khi `mode='luyen-the'` |
| `status` | text DEFAULT 'dang-choi' CHECK ('dang-choi','ket-thuc') | |
| `board` | jsonb NOT NULL | board hiện tại, cập nhật mỗi nước |
| `turn` | text CHECK ('r','b') | |
| `result` | text NULL CHECK ('thang','hoa','thua') | so với `solver_side` |
| `end_reason` | text NULL CHECK ('giai-dung','mat-the-thang','chieu-bi','het-nuoc-di','hoa-3-lan','hoa-60-nuoc','truong-chieu','bo-cuoc') | `mat-the-thang` = Mổ ván phát hiện đánh mất thế thắng đã chứng minh |
| `invite_token` | text NULL UNIQUE | link cho màn khách xem |
| `guest_token` | uuid NULL | khách đang xem (nếu có) |
| `created_at`, `ended_at` | timestamptz | |

### 2.3 `co_the_moves` — nhật ký nước đi (giống `game_moves`, thêm điểm)

Cùng cột `seq/side/from_r/from_c/to_r/to_c/captured_type/is_check/created_at`
như `game_moves`, cộng:

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `board_hash` | text NOT NULL | phát hiện lặp thế, tái dùng `detectRepetition` |
| `score_cp`, `mate` | int NULL | điểm SAU nước này — tính lười (chỉ lúc `ket-thuc`, xem mục 3 "Mổ ván") để không tốn CPU giữa chừng lúc đang giải |

---

## 3 · Vòng đời một thế cờ

```
Soạn quân (bàn trống/khai cuộc/xoay bàn/chép thế)
        ↓
KIỂM hợp lệ — fail-closed: đủ 2 Tướng, không đối mặt trực tiếp
        │  (hàm mới rules.validatePosition(board), tái dùng findGeneral/flyingGeneral)
        │  sai → chặn cứng, thông báo CÓ DẤU tiếng Việt đầy đủ, không cho lưu/vào trận
        ↓
Chốt thế → chọn bên cầm, side_to_move → tạo co_the_positions
        ↓
Phân tích (1 lần gọi engine, multipv=1, đọc score_cp/mate có sẵn — không tốn
           thêm lần gọi nào, đúng phát hiện cốt lõi của tài liệu) → verdict
        ↓
"BẮT ĐẦU" → tạo co_the_session (mode giải HOẶC luyện thế)
        ↓
Đang đấu: Chủ Công đi 1 nước → server validate qua rules.legalMoves/applyMove
          → nếu chưa xong ván, đến lượt "Đối thủ" (LUÔN LÀ MÁY, tái dùng
          engineClient + aiSelect ở opponent_level) → máy tự đi
        ↓
Kết thúc (chiếu bí/hết nước đi/lặp thế/60 nước/bỏ cuộc)
        ↓
TỰ ĐỘNG: Mổ ván (chấm từng nước theo score_cp delta, `BAN_CHUAN_CO_THE.md` §6.1) + tự ghi Hồ sơ
         — không chờ bấm, học đúng bài học "0 bản ghi sau 1.215 ván"
```

**Mổ ván (`BAN_CHUAN_CO_THE.md` §6.1):** với thế đã **chứng minh**
(`verdict_certainty='chung-minh'`), chấm theo *giữ hay mất* trạng thái
thắng/hoà/thua tuyệt đối qua từng nước (so `verdict` gốc với dấu của
`score_cp` sau mỗi nước người giải đi, theo đúng bảng đọc điểm §3.2 của
cùng tài liệu) — **không dùng ACPL thô**, vì thang đó tài liệu gốc đã chỉ
rõ phán ngược cho tàn cuộc nhị phân.

**Diễn giải (khối 🏛):** dự án **không có** hạ tầng sinh văn bản tự do
(không LLM). Bản đầu diễn giải bằng **câu mẫu tiếng Việt lắp từ dữ liệu đã
tính** (giữ/mất thế thắng ở nước nào, đường nào đổi từ chứng minh sang ước
lượng...) — **không phải** bình luận cờ tự do kiểu người viết. Ghi rõ ranh
giới này để tránh kỳ vọng sai; nếu muốn diễn giải tự nhiên thật, đó là một
quyết định khác (tích hợp LLM) cần bàn riêng.

---

## 4 · API (`/co-the/...`)

```
POST /co-the/positions                  soạn+kiểm (đăng nhập) → tạo position nháp
POST /co-the/positions/:id/luu-kho      lưu vào Kho thế {label, category}
GET  /co-the/positions                  danh sách Kho thế (lọc origin/category)
GET  /co-the/positions/:id
POST /co-the/positions/:id/phan-tich    gọi engine 1 lần multipv=1 → verdict
POST /co-the/positions/:id/tim-cach-pha multipv lớn hơn + quét nhánh thắng → {đường, số nước}/đường

POST /co-the/sessions                   {position_id, solver_side, mode, opponent_level?, luyen_the_cap?}
GET  /co-the/sessions/:id               đăng nhập chủ HOẶC guest_token đúng
GET  /co-the/sessions/:id/stream        SSE — tái dùng subscribeGame/publishToGame (core/realtime.js)
GET  /co-the/sessions/:id/moves         nhật ký — dùng cho Đường giải ⏮◀▶⏭
POST /co-the/sessions/:id/moves         chỉ Chủ Công đi; máy tự đi lượt kế nếu còn ván
POST /co-the/sessions/:id/mach-1-nuoc   chỉ host — gọi engine 1 lần, KHÔNG lưu lịch sử
POST /co-the/sessions/:id/roi           kết thúc/bỏ cuộc (end_reason='bo-cuoc')
GET  /co-the/sessions/:id/mo-van        chỉ host — tự có sẵn khi status='ket-thuc'
POST /co-the/sessions/:id/luyen-the/chay  N ván tự đấu máy-vs-máy nền theo cấp, báo qua SSE khi xong

POST /co-the/sessions/:id/moi-xem       chủ tạo/lấy invite_token cho màn khách xem
POST /co-the/xem/:token/vao             KHÔNG đăng nhập, nhận guest_token
GET  /co-the/xem/:token/stream          SSE rút gọn — chỉ board/turn/2 tên/nhật ký, KHÔNG phân tích/đường giải
```

Middleware khách mới `requireAuthOrCoTheGuestToken` (mô phỏng
`middleware/gameAuth.js`, tra `co_the_sessions.guest_token` thay
`games.black_guest_token`) — không tổng quát hoá middleware cũ thành tham
số bảng, vì 2 domain có luật khác nhau (Cờ Thế: khách CHỈ xem, không bao
giờ được gọi `/moves`).

---

## 5 · 10 khối → giao diện

Dùng lại đúng khung `.xq-fs-card`/`.xq-fs-panel` hiện có. Màn Chủ Công có đủ
10 khối + Luyện Thế + Mổ ván + Hồ sơ + Kho thế. Màn khách/người xem (route
riêng `PUB['co-the-xem']`, tái dùng `guestFetch`/`GUEST_TOKEN` mẫu) chỉ nhận
từ server: bàn cờ, 2 tên, nhật ký nước — 6 khối riêng tư (Phân tích, Đối
thủ, trình độ, Tìm cách phá, Đường giải, Diễn giải) **không bao giờ** có
trong response gửi khách, không phải ẩn bằng CSS.

---

## 6 · Lỗi/biên & kiểm thử

Nguyên tắc xuyên suốt (giống spec Kernel/Engine mục 7): **mọi thứ
re-validate ở server**. Áp thêm cho Cờ Thế:

- `POST /co-the/positions` fail-closed đúng `BAN_CHUAN_CO_THE.md` §5 — sai
  thế thì 422, không tạo row nào cả (không lưu thế sai rồi mới báo lỗi).
- `POST /co-the/sessions/:id/moves` so lại lượt/tính lại nước hợp lệ trước
  khi áp — y hệt `games/service.js` đang làm cho `move()`.
- Test: `api/tests/t4x-co-the-*.test.js` — soi khuôn mock CSDL của
  `t42-games-rooms.test.js`/`t46-ai-auto-move.test.js` trước khi viết.
  `rules.validatePosition` là hàm thuần, test trực tiếp như các hàm khác
  trong `t40-chess-rules.test.js`.

---

## 7 · Thứ tự dựng đề xuất

| # | Việc | Vì sao trước |
|---|---|---|
| 1 | `rules.validatePosition` + migration 3 bảng | Nền, không phụ thuộc gì khác |
| 2 | Soạn thế + kiểm + lưu Kho thế (không cần engine) | Test được ngay, không cần engine sống |
| 3 | Phân tích (⚖) — gọi engine, đọc score_cp/mate | Giá trị cốt lõi nhất theo tài liệu, làm sớm |
| 4 | Tìm cách phá (⚔) | Cùng nhóm gọi engine, làm liền sau Phân tích |
| 5 | Sessions + Đang đấu (đi nước, máy tự đi lượt kế qua `aiSelect`) | Cần 1-4 xong (thế đã có, đã phân tích) |
| 6 | Mổ ván + Hồ sơ tự ghi (tự chạy khi kết thúc) | Cần 5 xong (có nước đi thật để chấm) |
| 7 | Đường giải (⏮◀▶⏭) | Thuần đọc lại `co_the_moves`, làm sau 5 |
| 8 | Diễn giải (🏛, câu mẫu) | Cần 6 xong (dữ liệu chấm điểm mỗi nước) |
| 9 | Luyện Thế 3 cấp (tự đấu máy-vs-máy nền) | Nặng nhất, cần 5 ổn định trước |
| 10 | Màn khách/người xem | Độc lập, làm song song được với 5-9 |

---

## 8 · Còn chưa định

- **Diễn giải câu mẫu** ở mục 3 — nếu người dùng thật kỳ vọng bình luận tự
  nhiên hơn (không phải câu lắp sẵn), cần bàn riêng việc tích hợp sinh văn
  bản (LLM), ngoài phạm vi bản này.
- **Nội dung Kho thế thật** — nguồn sách cổ/tự nhặt, chưa quyết (đúng như
  `BAN_CHUAN_CO_THE.md` §11 cũng chưa quyết) — bản đầu chỉ có vài thế mẫu để demo
  chức năng duyệt/phân loại.
- **`opponent_level` 3 mức (yếu/vừa/mạnh)** dùng ngưỡng cụ thể nào khi tái
  dùng `selectAiMove` — để lúc lập kế hoạch chi tiết chốt số, không phải
  quyết định kiến trúc.
