# Sảnh Cờ NHACCON6789 — Kernel & Engine (mở rộng `api/games`)

- **Ngày:** 2026-09-07
- **Nguồn yêu cầu:** `SANH_CO_GIAO_VIEC_DAY_DU.md`, `BAN_CHUAN_CO_TUONG.md`, `BAN_CHUAN_CO_THE.md` (đo từ máy ROSA, không dùng trong dự án này — dự án này xây mới để triển khai lên VPS, không phụ thuộc ROSA).
- **Phạm vi:** Đây là **sub-project 1/nhiều** của việc đưa Sảnh Cờ lên web. Phạm vi bản này: (1) hoàn thiện luật cờ tướng còn thiếu trong Kernel hiện có, (2) mô hình phòng — chủ phòng là thành viên, khách vào bằng link không cần tài khoản, (3) đồng hồ/cầu hoà/mất kết nối/rời phòng, (4) dịch vụ Engine bọc Pikafish thật, (5) máy đi hộ chủ phòng trong ván PvP.
- **Ngoài phạm vi (để sub-project sau):** giao diện web (Sảnh/Cờ Tướng/Cờ Thế, responsive) — quyết định làm Kernel+Engine trước; chế độ Cờ Thế và các công cụ phân tích của nó (⚖ phân tích, ⚔ tìm cách phá, 🏛 diễn giải, Luyện Thế); quy đổi ACPL sang tỉ lệ thắng (cần dữ liệu thật để hiệu chỉnh, chưa có); bảng tàn cuộc (chính spec gốc cũng nói rõ **đừng dựng**); "nhịp theo đối thủ" tinh chỉnh thời gian hiện nước của máy đi hộ.

---

## 0 · Bốn quyết định nền

| Quyết định | Chọn | Lý do |
|---|---|---|
| Kernel ở đâu | Mở rộng `api/src/modules/games/` đang có, không viết Kernel riêng | Auth/SSE/Postgres/audit/rate-limit đã chạy thật, đã qua production — không có lý do bỏ đi làm lại |
| Engine ở đâu | Container Docker riêng (`engine`), bọc Pikafish qua UCI, chỉ `api` gọi được qua mạng nội bộ | Pikafish ăn nhiều CPU (Threads=8, 8 giây/nước) — tách khỏi tiến trình `api` để không giành CPU với web chính |
| Khách vào phòng | Token ngắn hạn gắn với đúng 1 ván, không tạo hàng trong `members` | Đúng yêu cầu "khách không cần đăng nhập"; không cần dựng hệ tài khoản tạm song song với hệ thành viên thật |
| Đồng bộ 2 bên | Dùng lại SSE đã có (`core/realtime.js`, route `/:id/stream`) | Đã chứng minh chạy tốt — đúng thứ NHACCON6789 liệt kê là thiếu, ở đây **đã có sẵn** |

---

## 1 · Kiến trúc & vận hành

```
┌─────────┐   nước đi/lệnh    ┌────────────────┐   FEN, movetime    ┌─────────┐
│  Web     │ ───────────────► │  api (Kernel)   │ ──────────────────► │ engine   │
│ (sub-    │ ◄─────────────── │  games module   │ ◄────────────────── │ Pikafish │
│ project  │   SSE /stream    │  + Postgres     │  bestmove/score_cp   │  (UCI)   │
│  sau)    │                  └────────────────┘                     └─────────┘
```

`engine` thêm vào `docker-compose.yml` cạnh `db/api/storage/proxy/backup`, cùng `networks: [nhachung_net]`, **không** khai `ports:` ra ngoài — chỉ `api` gọi tới bằng tên service (`http://engine:8898`), giống cách `storage` (MinIO) hiện chỉ lộ qua `proxy`.

Container `engine` chạy sẵn 1 nhóm tiến trình con Pikafish (worker pool, kích thước cấu hình qua env `ENGINE_POOL_SIZE`), nhận request tuần tự theo hàng đợi khi số ván cần nước đi cùng lúc vượt kích thước pool. **Kích thước pool và Threads/ván phụ thuộc core CPU của VPS thật — chưa chốt, xem mục 9.**

---

## 2 · Mô hình dữ liệu

### 2.1 Bảng `games` — các cột thêm mới

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `black_member_id` | đổi thành **NULLABLE** | trước đây NOT NULL — phải mở để cho phép phòng chưa có khách |
| `black_guest_name` | text, null | tên khách tự đặt khi vào phòng bằng link |
| `black_guest_token` | uuid, null | "chứng minh thư" của khách cho đúng ván này, không phải tài khoản |
| `invite_token` | text, unique | mã phòng kiểu `G-4a91`, dùng trong link mời |
| `red_time_ms`, `black_time_ms` | int | thời gian còn lại mỗi bên, mặc định 600000 (10:00) |
| `turn_started_at` | timestamptz, null | mốc bắt đầu lượt hiện tại, dùng tính thời gian còn lại |
| `second_joined_at` | timestamptz, null | lúc khách vào phòng — mốc bắt đầu đếm 30 giây |
| `red_ready_at`, `black_ready_at` | timestamptz, null | mỗi bên bấm "Bắt đầu" |
| `draw_offered_by` | text ('r'/'b'), null | ai vừa cầu hoà |
| `disconnected_side`, `disconnected_at` | text/timestamptz, null | theo dõi mất kết nối |
| `red_ai_level`, `black_ai_level` | text, null | cấp máy đi hộ đang bật cho bên đó (`sieu`/`thong-minh`/`xuat-sac`), null = tắt |

`end_reason` CHECK thêm giá trị: `hoa-3-lan`, `hoa-60-nuoc`, `truong-chieu`, `het-gio`, `mat-ket-noi`, `roi-phong`, `hoa-thoa-thuan`.

Index `idx_games_active_pair` (migration 049) giữ nguyên nhưng thêm điều kiện `AND black_member_id IS NOT NULL` — ràng buộc "mỗi cặp thành viên chỉ 1 ván" chỉ có ý nghĩa cho kiểu thách-đấu-bạn, không áp cho phòng-khách-qua-link (chưa có `black_member_id` lúc tạo phòng).

### 2.2 Bảng `game_moves` — các cột thêm mới

| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `is_check` | boolean | nước này có chiếu tướng đối phương không — đã tính sẵn ở `applyMove` (`checkOpp`), chỉ cần lưu |
| `board_hash` | text | băm `(board, turn)` sau khi áp nước — dùng phát hiện lặp thế (mục 3) |

---

## 3 · Ba luật Kernel còn thiếu

Bốn luật Kernel theo spec: chiếu bí · hoà lặp thế 3 lần · hoà 60 nước không ăn quân · trường chiếu. **Chiếu bí đã có** (`het-nuoc-di`/`bat-tuong` trong `rules.js`). Ba luật còn lại:

### 3.1 Hoà lặp thế 3 lần + Trường chiếu (dùng chung 1 cơ chế)

Sau mỗi nước, đếm `board_hash` vừa sinh đã xuất hiện bao nhiêu lần trong `game_moves` của ván này. **Lần thứ 3** → thế đã lặp, cần phân xử tiếp:

Lấy dải nước đi giữa lần xuất hiện **liền trước** và lần này (đúng 1 chu kỳ lặp). Xét từng bên riêng: trong dải đó, các nước **của chính bên ấy** có `is_check = true` ở **tất cả** không?

- Đúng một bên chiếu liên tục suốt chu kỳ → bên đó **THUA** (`truong-chieu`).
- Không bên nào chiếu liên tục suốt chu kỳ, hoặc (hiếm) cả hai đều chiếu liên tục xen kẽ → **HOÀ** (`hoa-3-lan`). *(Trường hợp "cả hai cùng trường chiếu" spec gốc không nói rõ cách xử — chọn hoà làm mặc định an toàn, xem mục 9.)*

### 3.2 Hoà 60 nước không ăn quân

Đếm số nước liên tiếp gần nhất (`seq DESC`) có `captured_type IS NULL`. Đạt **120** (= `GIOI_HAN_60` bán nước, đúng số đo trong spec) → hoà (`hoa-60-nuoc`).

Cả ba luật đều tính **ở server ngay sau `applyMove`**, trước khi trả kết quả cho client — không có đường nào để client tự báo hoà/thua mà server không tính lại.

---

## 4 · Phòng & luồng vào trận

### 4.1 Tạo phòng, vào phòng

```
POST /games/rooms                    (cần đăng nhập)         -> {id, invite_token}
POST /games/rooms/:token/join        {ten}  (KHÔNG cần đăng nhập) -> {black_guest_token}
```

`red_member_id = host`. Khách vào bằng link `/ban/G-4a91` → nhập tên → `join` set `black_guest_name` + phát `black_guest_token`, khách lưu ở trình duyệt (sessionStorage), dùng cho mọi gọi tiếp theo trong đúng ván này.

Middleware mới `requireAuthOrGuestToken`: chấp nhận JWT thành viên (host) **hoặc** `black_guest_token` khớp đúng `game_id` (khách). Áp cho toàn bộ route trong phòng thay `requireAuth` thường.

### 4.2 Bốn trạng thái — suy ra từ dữ liệu, không thêm cột "trạng thái phòng"

```
① CHỜ ĐỐI THỦ    black_member_id và black_guest_name đều NULL
② ĐỦ NGƯỜI        đã có khách, red_ready_at và black_ready_at đều NULL
③ CHỜ BÊN KIA     đúng một trong hai ready_at có giá trị
④ ĐANG ĐẤU        status='active' (chuyển khi CẢ HAI ready_at có giá trị)
```

### 4.3 Luật 30 giây — kiểm kiểu lazy, không cần job nền

`second_joined_at` set lúc khách vào. Mỗi lần route trạng thái/SSE được gọi, tự kiểm: nếu `now() - second_joined_at > 30s AND black_ready_at IS NULL` thì dọn khách (`black_member_id/guest_name/token` về NULL, `second_joined_at` về NULL) **trước khi** trả kết quả — phòng quay lại ①. Chủ phòng không bấm thì không bị đuổi (đúng luật "chủ phòng tuyệt đối") — chỉ khách chịu giới hạn 30 giây.

---

## 5 · Đồng hồ, cầu hoà, mất kết nối, rời phòng

**Đồng hồ:** không đếm ngược ở server. `turn_started_at` set mỗi khi có nước mới. Thời gian còn lại = `stored_time_ms − (now − turn_started_at)`, tính lúc trả `/state`. Mỗi nước đi xong, trừ thời gian đã dùng vào `stored_time_ms` của bên vừa đi.

**Hết giờ:** `POST /games/:id/timeout` — client gọi khi thấy đồng hồ về 0, nhưng **server tự tính lại** từ `turn_started_at`, chỉ xử thua nếu server cũng xác nhận hết giờ thật. Không tin báo cáo từ client (fail-closed, đúng nguyên tắc spec).

**Cầu hoà:** `POST /games/:id/draw/offer` → set `draw_offered_by`. Bên kia `POST /games/:id/draw/accept|decline`. Từ chối → xoá cờ, ván chạy tiếp, đồng hồ không dừng.

**Mất kết nối:** tận dụng `req.on('close')` đã có trong route SSE hiện tại — set `disconnected_side/disconnected_at`, khoảng thời gian mất kết nối không tính vào `turn_started_at` (tạm dừng đồng hồ thật). Subscribe SSE mới từ đúng người trong 1 phút → xoá cờ, đồng hồ chạy tiếp. Quá 1 phút → `POST /games/:id/disconnect-timeout`, server verify lại mốc `disconnected_at` trước khi xử thua (cùng nguyên tắc fail-closed như mục hết giờ).

**Rời phòng:** chưa `active` → xoá thẳng, tự do. Đã `active` → dùng lại route `resign` hiện có — rời khi đang đấu = xin thua, đúng ý spec, không viết logic mới.

---

## 6 · Engine & máy đi hộ

```
POST /bestmove  {fen, movetime, multipv}  -> {bestmove, score_cp, mate, depth, pv}
GET  /health                              -> {ok, engine: "pikafish"}
```

Giữ nguyên hợp đồng gốc trong spec — không có lý do đổi hình dạng API đã được đo/chứng minh.

Thêm `boardToFen(board, turn)` vào `rules.js` (board hiện chỉ là jsonb nội bộ dạng `{side,type}` theo ô — chưa có khái niệm FEN, cần quy đổi mới gọi được Pikafish qua UCI). Bảng ánh xạ ký tự quân và thứ tự hàng để lại cho lúc lập kế hoạch (chi tiết cơ học, không phải quyết định thiết kế).

**Máy đi hộ:** bật cho 1 bên qua `red_ai_level`/`black_ai_level`. Khi tới lượt bên đang bật: server tự gọi `engine` (`multipv=3, movetime=8000`), lọc theo đúng bảng 3 cấp của spec (Siêu thông minh: nước tốt nhất, chênh 0 · Thông minh: nước 1-2, chênh ≤40 điểm · Xuất sắc: nước 1-3, chênh ≤120 điểm), áp nước qua **đúng hàm `service.move()` đang có** — không viết lại luồng áp nước, chỉ khác caller là hệ thống thay vì người chơi thật.

Thời gian hiện nước: bản đầu chờ cố định đủ 8 giây rồi hiện — "nhịp theo đối thủ" (làm mượt theo tốc độ đối phương, sàn 0.3s/trần 15s) để lại tinh chỉnh ở sub-project sau, không phải việc chặn ở bản đầu.

---

## 7 · Lỗi/biên & kiểm thử

Nguyên tắc xuyên suốt: **mọi thứ re-validate ở server**, không tin client báo cáo (hết giờ, mất kết nối, hoà, thắng) — đúng cách `service.js` đang làm cho `move()` (so lại lượt/tính lại nước hợp lệ trước khi áp), áp dụng y hệt cho mọi hành vi mới ở mục 3 và 5.

Kiểm thử: nối vào `api/tests/t40-chess-rules.test.js` (Vitest, hàm thuần, tên mô tả bằng tiếng Việt) cho 3 luật ở mục 3 và `boardToFen`. Thêm 1 file test riêng cho luồng phòng/khách/đồng hồ — soi 1 file test service khác trong repo trước khi viết để bám đúng khuôn mock CSDL đang dùng.

---

## 8 · Thứ tự dựng đề xuất

| # | Việc | Vì sao trước |
|---|---|---|
| 1 | 3 luật còn thiếu (mục 3) + cột `is_check`/`board_hash` | Thuần hàm, không phụ thuộc gì khác, có thể viết test ngay |
| 2 | Migration mở bảng `games`/`game_moves` (mục 2) | Nền cho mọi việc sau |
| 3 | Phòng & luồng vào trận + khách-qua-link (mục 4) | Cần trước khi có "ván thật" để đồng hồ/cầu hoà gắn vào |
| 4 | Đồng hồ, cầu hoà, mất kết nối, rời phòng (mục 5) | Phụ thuộc mục 3 (ván đã tồn tại) |
| 5 | Dịch vụ `engine` (container + `/bestmove` + `boardToFen`) | Độc lập, làm song song được với 1-4 |
| 6 | Máy đi hộ (mục 6, phần còn lại) | Cần cả mục 4 (ván thật) và mục 5 (engine) xong |

---

## 9 · Còn chưa định

- **Kích thước VPS** (core/RAM) — chưa biết, nên `ENGINE_POOL_SIZE` khởi đầu để mặc định nhỏ (1-2) và `Threads` Pikafish để mặc định thấp (2-4) cho máy dev — chỉnh lại khi có số thật từ VPS. Không chặn việc dựng.
- ~~**Nguồn binary Pikafish + tệp NNUE**~~ — **đã chốt 2026-09-07:** build từ mã nguồn trong Dockerfile nhiều tầng (multi-stage), không tải binary dựng sẵn. Lý do: build đúng cờ CPU của máy build ra thì chắc chạy được trên chính máy đó — tải sẵn phải đoán đúng biến thể (AVX2/BMI2/generic) khớp CPU máy chạy, rủi ro "illegal instruction" khi chưa biết cấu hình VPS thật.
- **"Cả hai bên cùng trường chiếu"** trong 1 chu kỳ lặp (mục 3.1) — hiếm, spec gốc không nói rõ, tạm xử hoà, có thể cần xem lại nếu gặp thật.
- ~~**Ánh xạ ký tự FEN chính xác**~~ — **xong 2026-09-07:** `boardToFen`/`uciMoveToCells` (`api/src/modules/games/rules.js`), quy ước xác nhận trực tiếp từ mã nguồn Pikafish, xác nhận thêm lần nữa bằng cách chạy thật qua container thật lúc soát xét cuối nhánh (`docs/superpowers/plans/2026-09-07-sanh-co-engine-may-di-ho.md`).
- **Máy đi hộ không thấy được lịch sử ván** — phát hiện lúc soát xét cuối nhánh dựng Engine (2026-09-07), không phải lúc lập plan: `maybeAutoMove()` gọi engine bằng `position fen <FEN hiện tại>`, không kèm danh sách nước đã đi (`moves ...`), và `boardToFen()` luôn ghi cứng nửa-nước-đi là `0`. Hệ quả thật: engine không thấy nó đã lặp thế 2 lần, có thể đi tiếp một nước mà **server** (đang tự đếm `board_hash` qua `detectRepetition`, mục 3.1) xử hoà (`hoa-3-lan`) hoặc — nặng hơn — xử **thua** nếu đó là chuỗi chiếu liên tục (`truong-chieu`, bên chiếu thua theo mục 3.1). Engine cũng không thấy được đang gần tới hoà 60 nước (mục 3.2) vì trường nửa-nước-đi luôn là `0` thay vì đúng chuỗi hiện tại. Chưa sửa — cần `position fen <thế bắt đầu> moves m1 m2 ...` phát lại từ `game_moves`, việc thiết kế riêng ngang tầm việc đã làm cho `boardToFen`/`uciMoveToCells`, để dành làm cùng lúc với sub-project giao diện web (xem mục cuối tài liệu final-review, `.superpowers/sdd/2026-09-07-sanh-co-engine-may-di-ho/progress.md` nếu thư mục đó còn tồn tại — git log của nhánh là nguồn thật lâu dài).
- **Không có tín hiệu khi máy đi hộ thất bại** — phát hiện cùng đợt soát xét trên: mọi lỗi trong `maybeAutoMove()` (engine không tới được, hết thời gian, nước engine trả về hoá ra không hợp lệ) đều rơi vào cùng một `.catch(console.error)` — ván treo im lặng, không phát sự kiện SSE nào, không có thông báo, người chơi bên kia không biết vì sao đối thủ (máy) không đi. Chưa sửa — cần một sự kiện SSE mới (vd. `ai_error`) để màn hình sau này (sub-project giao diện web) có cái để hiện ra ("máy không đi được, thử lại?"). Không chặn ván không bật máy đi hộ; không làm hỏng dữ liệu.
