# Sảnh Cờ — Máy đi hộ, Mổ ván ACPL, Bố cục 3 cột (Design)

**Nguồn:** `BAN_CHUAN_CO_TUONG.md`, `SANH_CO_GIAO_VIEC_DAY_DU.md` (repo root).
**Kế thừa:** `docs/superpowers/specs/2026-09-07-cotuong-phong-khach-ui-design.md` (đã build, đã gộp `main`), `docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md` (Kernel, đã build).

Việc này được chia làm **3 dự án con, làm và gộp lần lượt**, không đợi xong cả 3 mới có gì dùng được:

1. **Máy đi hộ + đồng hồ 30 giây** — nối giao diện vào backend có sẵn (`red_ai_level`/`black_ai_level`, `POST /:id/ai-level`, `second_joined_at`). Không cần migration.
2. **Mổ ván ACPL + hồ sơ đối thủ** — backend hoàn toàn mới: migration, quy trình phân tích chạy sau ván, 2 endpoint đọc.
3. **Bố cục 3 cột cho chủ phòng** — sắp xếp lại `V['cotuong-van']` để chứa các khối riêng tư, dùng dữ liệu từ (2).

Mỗi dự án con có tập task riêng trong kế hoạch, review riêng, commit riêng.

---

## 1 · Máy đi hộ + đồng hồ 30 giây

### 1.1 Nút trượt "Máy đi hộ ta"

Chỉ hiện cho **chính bên đang xem** (đúng schema hiện có: `red_ai_level` VÀ `black_ai_level` đều tồn tại — ai cũng bật được máy đi hộ **cho chính mình**, không ai bật hộ người khác). Khớp câu "Không có lựa chọn Máy" trong bản chuẩn: câu đó nói về khối **Đối thủ** — không được CHỌN máy thay cho đối thủ, không phải nói khách không được tự bật máy cho chính họ.

Trạng thái thu gọn: `Máy đi hộ ta [bật/tắt] · <cấp hiện tại hoặc "tắt · ta tự đi">`.
Bấm mở ra 3 lựa chọn cấp (Xuất sắc / Thông minh / Siêu thông minh) — chọn cấp nào gọi `POST /games/:id/ai-level {level}` luôn (không có nút xác nhận riêng), tự thu lại. Tắt hẳn gọi cùng endpoint với `level: null`.

### 1.2 Nhãn "nhaccon6789 đang chơi"

Hiện dưới tên đối thủ khi **đối thủ's `ai_level` khác null** (đọc từ `GAME_STATE.red_ai_level`/`black_ai_level`, đã có sẵn trong response `GET /games/:id`). Không hiện khi máy đi hộ do chính người xem bật cho mình.

### 1.3 Đồng hồ 30 giây hiển thị

Thuần client: khi `xqRoomPhase()==='du-nguoi'`, tính `deadline = second_joined_at + 30000ms`, vẽ đồng hồ đếm ngược `gameClockTick()`-style (dùng lại `xqFormatClock`). Hết giờ vẫn hiện `0:00`, không tự gọi API gì — server đã tự đuổi khách theo đúng luật lazy-eviction có sẵn (`docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md`); lần poll/SSE kế tiếp phản ánh đúng trạng thái mới. Không cần thêm cơ chế phía client.

---

## 2 · Mổ ván ACPL + hồ sơ đối thủ

### 2.1 Vì sao KHÔNG dùng thang `20/45/80/140` cũ

Bản chuẩn đã tự chỉ ra thang cũ phán ngược (mất 500 điểm từ +1500→+1000 vẫn thắng 100% nhưng bị phán "còn yếu"; mất 100 điểm từ 0→-100 là mất cờ nhưng bị phán "khá"). Phải quy điểm sang tỉ lệ thắng trước khi đo mất mát.

### 2.2 Ruling: công thức quy đổi

Bản chuẩn định hướng tự dựng đường cong hiệu chỉnh từ 1.215 ván ROSA — **dữ liệu đó không truy cập được từ đây**, và nền tảng này hiện có rất ít ván đã đấu (chưa đủ để tự hiệu chỉnh một đường cong có ý nghĩa thống kê). **Ruling:** dùng công thức logistic tiêu chuẩn, cùng dạng cộng đồng cờ vua/cờ tướng hay dùng để quy `score_cp` sang tỉ lệ thắng ước lượng:

```
tỉ_lệ_thắng(cp) = 1 / (1 + 10^(-cp/400))
```

Đây là xấp xỉ hợp lý, không phải số đo tuyệt đối — nói rõ trong UI là **ƯỚC LƯỢNG**, đúng tinh thần mục V.3 bản chuẩn ("Luôn nói rõ nguồn... ◐ nhaccon6789 · ƯỚC LƯỢNG"). Khi ván trên nền tảng đủ nhiều (mốc gợi ý: vài trăm ván đã mổ), có thể hiệu chỉnh lại hằng số 400 từ dữ liệu thật — ghi lại làm việc tương lai, không chặn việc bây giờ.

**Mất mát một nước (từ góc nhìn bên vừa đi):**
```
mất_mát = tỉ_lệ_thắng(điểm_trước_khi_đi) − tỉ_lệ_thắng(điểm_sau_khi_đi, cùng góc nhìn)
```
`ACPL-tương-đương` của một bên = trung bình `mất_mát` trên mọi nước bên đó đã đi.

### 2.3 Quy trình phân tích — chạy khi nào, chạy thế nào

**Ruling — kích hoạt:** tự động, không chờ bấm (đúng yêu cầu "tự mổ, tự ghi hồ sơ, không chờ ai bấm" — bài học từ `ho_so` 0 bản ghi sau 1.215 ván vì chờ một cú bấm chưa ai bấm). Khi `service.js` chuyển ván sang `status='finished'` (mọi lối ra: chiếu bí, hết nước đi, xin thua, hết giờ, mất kết nối quá hạn, hoà) — bắn một job nền `analyzeGame(gameId)`, **không chờ nó** trước khi trả response cho client (fire-and-forget qua `setImmediate`/hàng đợi trong-tiến-trình đơn giản — nền tảng này chưa có hàng đợi ngoài như Redis/BullMQ cho việc này, quy mô nhỏ nên không cần).

**Ruling — tốc độ movetime:** bản chuẩn quy định `movetime=8000ms` là cho **máy đi hộ SỐNG** (mục 4: "nhịp theo đối thủ" — phải đủ lâu để không mù đòn *khi đang thay người chơi thật*). Mổ ván là **phân tích nền, không ai chờ trực tiếp** — dùng `movetime=400ms, multipv=1` mỗi nước (đủ sâu để không random nhiễu quá mức, đủ nhanh để một ván 60 nước phân tích xong trong ~24 giây thay vì ~8 phút). Đây là hằng số khác mục đích khác, ghi rõ trong code để không ai nhầm lẫn gộp chung với mục 4.

**Cách tính điểm mỗi nước:** replay ván từ thế cờ ban đầu bằng `game_moves` (đã có `from_r/from_c/to_r/to_c` mỗi nước, dùng lại logic dựng bàn cờ đã có trong `rules.js`). Với mỗi nước thứ *i*:
1. Trước khi áp nước *i*: gọi `bestMove({fen: fen_i, movetime:400, multipv:1})` → `score_cp`/`mate` là điểm-tốt-nhất-có-thể tại thế đó, theo góc nhìn bên sắp đi.
2. Áp nước *i* thật (nước người chơi đã đi, không phải nước máy chọn) → được `fen_{i+1}`.
3. Điểm "sau khi đi" của nước *i* = điểm-tốt-nhất tại `fen_{i+1}` (đã tính ở bước 1 của nước *i+1* — không tính trùng, chỉ đảo dấu vì đổi lượt), theo góc nhìn CŨ (bên vừa đi ở nước *i*).
4. `mất_mát_i = tỉ_lệ_thắng(điểm bước 1) − tỉ_lệ_thắng(điểm bước 3)`.

Chiếu bí quy theo `effectiveScore()` đã có sẵn trong `aiSelect.js` (dùng lại nguyên hàm, không viết bản thứ hai).

### 2.4 Lưu trữ

Migration mới, thêm cột vào `game_moves` (đã có bảng, mỗi hàng đúng 1 nước — không cần bảng riêng):
```sql
ALTER TABLE game_moves ADD COLUMN eval_before_cp int;
ALTER TABLE game_moves ADD COLUMN eval_before_mate int;
ALTER TABLE game_moves ADD COLUMN win_loss real;
```
Và cột tóm tắt trên `games` (đọc nhanh cho hồ sơ đối thủ, khỏi JOIN/AVG mỗi lần):
```sql
ALTER TABLE games ADD COLUMN red_avg_loss real;
ALTER TABLE games ADD COLUMN black_avg_loss real;
ALTER TABLE games ADD COLUMN analyzed_at timestamptz;
```
`analyzed_at NULL` = chưa mổ xong (job đang chạy hoặc chưa chạy) — UI hiện "Đang mổ ván…" thay vì lỗi.

### 2.5 API

```
GET /games/:id/analysis
  -> { analyzed_at, moves: [{seq, side, eval_before_cp, eval_before_mate, win_loss}],
       red_avg_loss, black_avg_loss }
```
**Chỉ hai người chơi (thành viên thật) được gọi** — `actor` phải khớp `red_member_id` hoặc `black_member_id`; **guest token bị chặn tuyệt đối** (403), đúng "Khách KHÔNG thấy... mổ ván". Ván chưa `finished` → 409.

```
GET /games/members/:memberId/profile
  -> { games_count, wins, avg_loss }
```
**Ruling — phạm vi hồ sơ:** thống kê **toàn bộ ván đã mổ của người đó trên nền tảng** (không phải riêng đối đầu giữa hai người) — khớp cách đọc tự nhiên của "Hồ sơ đối thủ" như một hồ sơ chung, và tránh N+1: một bên mới có thể chưa từng đấu ai trong lịch sử chung mà vẫn có hồ sơ. Chỉ đếm ván đã `analyzed_at IS NOT NULL`. Truy vấn trực tiếp (không cache) — quy mô cộng đồng nhỏ, chưa cần.

---

## 3 · Bố cục 3 cột cho chủ phòng

**Chỉ áp dụng cho `V['cotuong-van']`** (màn thành viên đăng nhập). `guestGameHtml`/`PUB['cotuong-phong']` (2 cột, khách) **không đổi** — đúng "Khách KHÔNG thấy" của bản chuẩn.

**Cột trái (mới, riêng tư)** — hiện khi màn hình đủ rộng (breakpoint theo quy ước responsive hiện có của trang, thu gọn/ẩn dưới ngưỡng đó, không phá layout di động):
- **Thế cờ**: thanh đo dựa trên `red_avg_loss`/`black_avg_loss` sau `analyzed_at` có giá trị — **chỉ hiện sau khi ván kết thúc**, tuyệt đối không hiện lúc đang đánh (đúng chú thích ① của bản chuẩn — không rò rỉ đánh giá thế cờ sống cho một bên đang đấu, giữ tính công bằng ván đấu người-với-người).
- **Quân đã bắt**: suy trực tiếp từ `game_moves.captured_type` đã có sẵn (không cần dữ liệu mới) — nhóm theo bên bị bắt, vẽ hàng quân nhỏ.
- **Nhật ký**: danh sách nước từ `game_moves` hiện có (ký hiệu theo toạ độ hoặc chữ Hán ngắn), cuộn được.
- **Mổ ván**: gọi `GET /games/:id/analysis` khi ván `finished`, vẽ nước lỗi nặng nhất (`win_loss` cao nhất) + trung bình mỗi bên.
- **Hồ sơ đối thủ**: gọi `GET /games/members/:memberId/profile` với id đối thủ, hiện luôn (không chờ ván xong).

**Cột phải**: giữ khối Ván/Đối thủ/nút hành động đã có, cộng thêm nút trượt máy đi hộ (mục 1.1) và ô "Màn của khách" (link mời, đã có ở trạng thái chờ, chuyển vào đây khi đang đấu — bấm để chép, không đổi hành vi, chỉ đổi chỗ hiện).

**CSS**: class mới `.xq-3col` (grid 3 cột desktop, 1 cột di động — ẩn cột trái dưới breakpoint hẹp bằng cách thu vào một tab "Chi tiết" thay vì luôn hiện, tránh vỡ bàn cờ trên điện thoại). Tái dùng token màu/khoảng cách đã có trong site (không tạo bảng màu riêng).

---

## 4 · Thứ tự build & phụ thuộc

```
1 (Máy đi hộ + 30s) ─── độc lập, build trước, gộp ngay
2 (Mổ ván ACPL)     ─── độc lập, build song song được với 1
3 (Bố cục 3 cột)     ─── PHỤ THUỘC (2) — cần endpoint /analysis và /profile tồn tại trước khi vẽ khối tương ứng
```

## 5 · Ràng buộc chung

- Không đổi hành vi màn khách (`PUB['cotuong-phong']`, `guestGameHtml`) ngoài việc dữ liệu đối thủ có thêm nhãn "nhaccon6789 đang chơi" (mục 1.2) — mọi khối riêng tư khác của mục 3 **tuyệt đối không lộ ra khách**.
- Endpoint `/analysis` và `/profile` dùng middleware xác thực member hiện có (`requireAuth`, không phải `requireAuthOrGuestToken`) — chặn khách ở tầng route, không chỉ ở tầng UI.
- `analyzeGame()` lỗi (engine timeout, v.v.) không được làm hỏng luồng kết thúc ván — bọc try/catch, ghi log, `analyzed_at` cứ để NULL, UI tự hiện "chưa mổ được", không crash.
- Test: theo đúng khuôn TDD hiện có của `api/` (vitest) — riêng `analyzeGame()` cần mock `engineClient.bestMove` (đừng gọi Pikafish thật trong test, đúng tinh thần `aiSelect.js` "thuần hàm, kiểm bằng dữ liệu bịa được").
