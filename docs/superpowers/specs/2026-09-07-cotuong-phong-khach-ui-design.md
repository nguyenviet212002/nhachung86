# Sảnh Cờ — Giao diện Phòng & Khách cho Cờ Tướng (Gen 2)

## 1. Bối cảnh

Nhánh `worktree-sanh-co-kernel` đã gộp vào `main` (commit `087aa22`), thêm trọn bộ API
"phòng cờ" cho Cờ Tướng: chủ phòng (thành viên) tạo phòng, khách (không tài khoản) vào
bằng link mời, đồng hồ đếm thật, cầu hoà, xử lý mất kết nối, rời phòng. Toàn bộ phần này
**chưa có giao diện** — tài liệu này thiết kế giao diện web để lộ ra đúng những gì backend
đã làm, dựa theo `BAN_CHUAN_CO_TUONG.md` (đặc tả hành vi/UX gốc mà backend đã bám theo).

`web/index.html` đã có sẵn một tính năng Cờ Tướng trực tuyến "thế hệ 1" (thách đấu + ghép
nhanh giữa hai thành viên, không phòng/không khách) hoạt động tốt — màn `V['cotuong-online']`
(sảnh) và `V['cotuong-van']` (bàn cờ đang đấu). Việc này **không phải xây mới từ đầu**: mục
tiêu là mở rộng hai màn đó cho vừa với chủ phòng, và thêm đúng một màn mới cho khách.

## 2. Mục tiêu / Ngoài phạm vi

**Trong phạm vi:**
- Chủ phòng: tạo phòng, chia sẻ link mời, chơi ván có đồng hồ/cầu hoà/mất kết nối/rời
  phòng — tất cả trong `V['cotuong-van']` đã có.
- Khách: vào bằng link mời, nhập tên, chơi ván với đúng giao diện rút gọn theo §1 của
  `BAN_CHUAN_CO_TUONG.md` (không thấy thế cờ, mổ ván, hồ sơ, quân đã bắt, mọi thiết lập).
- Khách tải lại trang hoặc đóng/mở lại tab giữa ván vẫn quay lại đúng ván đang chơi.

**Ngoài phạm vi (giữ nguyên các quyết định trước đó trong dự án):**
- Cờ Thế (`BAN_CHUAN_CO_THE.md`) — ứng dụng desktop độc lập, phụ thuộc Engine, không đụng
  tới trong đợt này.
- Engine/AI (Pikafish), "máy đi hộ", "mổ ván tự chạy" (ACPL), "hồ sơ đối thủ" chi tiết,
  "vòng học khép kín" — đều phụ thuộc Engine, chưa có lịch.
- Sửa backend. Toàn bộ API đã có sẵn, kể cả các endpoint mở cho khách qua
  `requireAuthOrGuestToken`. Tài liệu này chỉ gọi API đã có.
- Vá lỗ hổng "không có sự kiện SSE cho khách vào phòng/bên sẵn sàng đầu tiên" (mục 7 dưới
  đây nêu rõ đây là hạn chế đã biết, ghi trong backlog Kernel) — giải pháp ở đây là polling
  phía UI trong lúc chờ, không sửa backend.

## 3. Kiến trúc tổng thể

Hai điểm vào, theo đúng ranh giới xác thực đã có trong `render()`:

| Vai trò | Màn | Registry | Vào `PUBLIC_SCREENS`? | Lý do |
|---|---|---|---|---|
| Chủ phòng (thành viên) | `cotuong-van` (mở rộng) | `V` | Không (đã là màn thành viên) | Đăng nhập sẵn, dùng lại toàn bộ hạ tầng phiên/SSE hiện có |
| Khách (không tài khoản) | `cotuong-phong` (mới) | `PUB` | Có | `render()` chỉ gọi `PUB[screen]` khi `variantOf(screen)==='public'`; một hàm `V` không bao giờ chạy được cho người chưa đăng nhập |

Quyết định này khác với đề xuất ban đầu ("1 màn dùng chung cho cả hai vai") — lý do đổi:
đọc kỹ `render()` (dòng 2140-2163) cho thấy `PUBLIC_SCREENS` không chỉ là cờ bỏ qua màn
đăng nhập, mà đổi hẳn **registry** dùng để dựng nội dung (`PUB[screen]` thay vì
`V[screen]`). Một màn dùng chung thật sự sẽ cần định nghĩa ở cả hai registry (như
`hosocongkhai`/`congchung` đang làm) — với phòng cờ, chủ phòng không bao giờ cần bản
`PUB`, nên tách hẳn hai hàm là ít việc hơn và không chạm gì vào luồng thành viên đang chạy.

Cả hai đều nằm trong `XQ_FULLSCREEN_SCREENS` (dòng 2195) để hiện toàn màn hình qua
`xqFullscreenShell()` — thêm `cotuong-phong` vào tập này. Không cần thêm vào
`XQ_FULLSCREEN_CLOSE` vì mặc định đã đúng: khách bấm X sẽ về `congchung` (trang chủ công
khai) — không có sảnh thành viên nào để quay lại.

## 4. Chủ phòng: mở rộng `V['cotuong-van']`

**Vào phòng:** thêm nút "Tạo phòng" vào `.xq-hub-topbar` của `V['cotuong-online']` (cạnh
nút "Thách đấu" hiện có, dòng 5983). Bấm vào gọi `POST /games/rooms` (`requireAuth`, không
tham số) → `{id, invite_token}`, rồi `go('cotuong-van/'+id)` — **giống hệt** luồng "chấp
nhận thách đấu xong vào `cotuong-van`" đang chạy, không thêm cơ chế điều hướng mới.

`invite_token` chỉ được trả về **một lần duy nhất** ở bước tạo phòng (server chỉ lưu bản
băm `invite_token_hash`, không thể lấy lại token thô từ `GET /games/:id` sau đó) — vì vậy
`V['cotuong-van']` cần giữ token này (biến bộ nhớ phía client, ví dụ `ROOM_INVITE_TOKEN`,
gán ngay sau khi tạo phòng) để hiện link mời trong lúc chờ. Nếu chủ phòng tải lại trang
đúng lúc đang ở trạng thái CHỜ ĐỐI THỦ, token thô không còn — chấp nhận đây là giới hạn hợp
lý (chủ phòng đã đăng nhập, có thể tạo phòng khác nếu mất link).

**Trạng thái mới cần vẽ**, chèn song song với 2 nhánh đặc biệt đã có
(`st.status==='pending'` cho lời thách đấu, `st.status==='finished' && !st.board` cho lời
từ chối) — xem bảng máy trạng thái ở mục 6. Khi ở một trong ba trạng thái phòng
(CHỜ ĐỐI THỦ/ĐỦ NGƯỜI/CHỜ BÊN KIA), thay vì vẽ bàn cờ, vẽ:
- CHỜ ĐỐI THỦ: khung `.xq-fs-card` hiện link mời dạng `<input readonly>` +
  nút "Chép" — tái dùng nguyên mẫu đã có ở dòng 3869 (`navigator.clipboard.writeText` +
  `toast('Đã sao chép mã mời')`), giá trị input là
  `location.origin + location.pathname + '#cotuong-phong/' + ROOM_INVITE_TOKEN`.
- ĐỦ NGƯỜI: tên khách đã vào (`st.black_name`) + nút "Sẵn sàng" (`POST /:id/ready`).
- CHỜ BÊN KIA: nếu chủ phòng đã bấm sẵn sàng, hiện "Đang chờ [tên khách] sẵn sàng…"; nếu
  chưa, hiện nút "Sẵn sàng" như trên (áp dụng đúng quy tắc "chủ phòng tuyệt đối" — chủ
  phòng có bấm trước hay sau đều được, không bị đuổi, không có đồng hồ đếm ngược nào áp lên
  họ; đồng hồ 30 giây chỉ tính cho khách, xem mục 6).

Ở cả ba trạng thái trên, chủ phòng còn có nút "Đóng phòng" — gọi cùng `POST /:id/leave` mà
khách dùng để rời phòng (cùng chạy `service.leaveRoom`), nhưng khi người gọi là chủ phòng
thì hàm này xoá hẳn ván (`DELETE FROM games ...`, audit `chess_game.room_closed`) thay vì
chỉ dọn chỗ của khách (`chess_game.guest_left`) — một endpoint, rẽ nhánh theo người gọi,
không cần route riêng. Không cần hộp xác nhận (chưa ai mất gì khi ván còn ở bước chuẩn bị).

**Khi `status==='active'`:** panel `.xq-fs-panel` hiện có (dòng 6270) thêm:
- Đồng hồ mỗi bên (định dạng mm:ss, đếm dựa trên `red_time_ms`/`black_time_ms` +
  `turn_started_at` — công thức giống hệt `computeRemainingMs()` phía server, tính lại ở
  client mỗi giây bằng `setInterval` để hiện đếm ngược mượt; giá trị server trả về qua
  `GET`/SSE mỗi lần là mốc đúng để đồng bộ lại, tránh trôi).
- Nút "Cầu hoà" (`POST /:id/draw/offer`) cạnh nút "Xin thua" đã có; băng thông báo khi
  `draw_offered_by` khác `null` và khác `mySide` (đối thủ vừa cầu hoà) với 2 nút
  Đồng ý/Từ chối, dùng `xqAnnounceHtml()` đã có — nội dung kiểu
  "✋ [tên đối thủ] xin hoà" theo đúng ví dụ ở §6 bản chuẩn.
- Băng thông báo mất kết nối khi `disconnected_side` khớp phía đối thủ: "⚡ [tên đối thủ]
  mất mạng — chờ nối lại trong [mm:ss]", đếm ngược 60 giây từ `disconnected_at`; hết giờ thì
  gọi `POST /:id/disconnect-timeout` để nhận thắng.
- Nút "Rời phòng" (`POST /:id/leave`) — xác nhận bằng `confirm()` hoặc modal có sẵn của
  trang khi `status==='active'` ("Rời phòng? Ván đang chạy — rời bây giờ tính là THUA" theo
  đúng câu ở §6); không cần xác nhận khi còn ở trạng thái phòng (trước khi vào ván).

Các phần đã có sẵn trong `cotuong-van` — vẽ bàn cờ, xử lý nước đi (`gameCellClick`), biên
bản ván cờ, xin thua, đổi bên, SSE (`GAME_EVENTSOURCE`) — **giữ nguyên, không viết lại**;
chỉ bổ sung nhánh trạng thái và panel như trên.

## 5. Khách: màn mới `PUB['cotuong-phong']`

```js
PUB['cotuong-phong'] = (params) => { const token = params[0]; ... }
```

cùng khuôn tham số với `V['cotuong-van']` (`params[0]` là id/token), đăng ký qua `go()` nên
không cần cơ chế định tuyến mới. Luồng bên trong:

1. Không có `token` (link hỏng) → thông báo lỗi, không gọi API.
2. Có `token`, tra `localStorage` (mục 8) theo đúng token này:
   - **Chưa từng vào** (không có bản lưu) → hiện form 1 ô "Tên của bạn" + nút "Vào phòng".
     Bấm vào gọi `POST /games/rooms/:token/join` (không cần đăng nhập) với
     `{guest_name}` → `{id, guest_token}`. Lưu ngay vào `localStorage`, rồi coi như đã vào.
   - **Đã từng vào** (có bản lưu `{gameId, guestToken}`) → bỏ qua form, gọi thẳng
     `GET /games/:gameId` bằng `guestToken` để lấy trạng thái hiện tại. Nếu lệnh này báo lỗi
     xác thực (đã tự "Rời phòng" ở tab khác trước đó, hoặc chủ phòng đã "Đóng phòng" —
     `guestToken` không còn khớp `black_guest_token` phía server) → xoá bản lưu cũ trong
     `localStorage`, quay lại nhánh "chưa từng vào" ở trên (hiện lại form nhập tên).
3. Sau khi có `{gameId, guestToken}`, vẽ giao diện theo đúng trạng thái phòng (mục 6) —
   dùng lại các hàm vẽ bàn cờ/định dạng đồng hồ/`xqAnnounceHtml()` mà `cotuong-van` dùng
   (các hàm thuần, không phụ thuộc `DATA`/`api.js`, nên gọi được từ cả hai màn).

**Những gì khách KHÔNG thấy** (đúng §1 bản chuẩn — thực hiện bằng cách không vẽ, không
phải ẩn CSS): cột riêng tư, quân đã bắt, mổ ván, hồ sơ đối thủ, mọi nút thiết lập. Layout
khách chỉ có: bàn cờ (xoay 180° — khách luôn là Đen, luôn nhìn quân mình ở dưới, tương ứng
`CHESS_FLIP`-kiểu-cờ-cố-định chứ không phải nút "Đổi bên" như chủ phòng), đồng hồ, biên bản
nước đi rút gọn, và 3 nút: Cầu hoà / Xin thua / Rời phòng.

## 6. Máy trạng thái phòng

Không có cột trạng thái phòng riêng trong CSDL — suy ra trực tiếp từ các cột đã có
(`status`, `second_joined_at`, `red_ready_at`, `black_ready_at`), giống hệt cách backend tự
suy luận trong `evictStaleGuestIfNeeded()`/`ready()`:

| Trạng thái | Điều kiện | Ai thấy gì |
|---|---|---|
| CHỜ ĐỐI THỦ | `status==='pending' && !second_joined_at` | Chủ phòng: link mời. Khách: chưa vào được (link chưa ai mở lần nào thì không tồn tại state này phía khách). |
| ĐỦ NGƯỜI | `status==='pending' && second_joined_at && !red_ready_at && !black_ready_at` | Cả hai: nút Sẵn sàng. |
| CHỜ BÊN KIA | `status==='pending' && second_joined_at && (red_ready_at || black_ready_at)` (chưa đủ cả hai) | Bên đã bấm: chờ. Bên chưa bấm: nút Sẵn sàng. Khách có đúng 30 giây kể từ `second_joined_at` trước khi bị dọn khỏi phòng (`evictStaleGuestIfNeeded`, phía server) — hiện đếm ngược cho khách. |
| ĐANG ĐẤU | `status==='active'` | Bàn cờ thật, đồng hồ chạy. |

Chuyển ĐỦ NGƯỜI/CHỜ BÊN KIA → ĐANG ĐẤU đã có sự kiện SSE (`ready()` gọi
`publishToGame(id, 'game_start', ...)` khi `becameActive`) — cả hai màn có thể mở
`GAME_EVENTSOURCE` ngay khi vào phòng (kể cả lúc còn `pending`) và bắt sự kiện này bình
thường, dùng lại nguyên `startGameStream(id, token)` đã có (token là access token của chủ
phòng hoặc `guest_token` của khách — endpoint stream đã nhận cả hai qua
`requireAuthOrGuestToken`, không cần sửa gì).

## 7. Đồng bộ dữ liệu lúc đang chờ: vì sao cần polling

Ba sự kiện **không** có push SSE tương ứng (rà `publishToGame(...)` trong
`api/src/modules/games/service.js`, không thấy gọi khi khách vào phòng hay khi một bên bấm
sẵn sàng lần đầu — hai việc này chỉ đổi cột CSDL, không publish gì; ghi nhận đây là khoảng
trống đã biết, nằm trong backlog theo dõi của nhánh Kernel, **không sửa ở đây**):

- Khách vào phòng (CHỜ ĐỐI THỦ → ĐỦ NGƯỜI).
- Một bên bấm sẵn sàng lần đầu (ĐỦ NGƯỜI → CHỜ BÊN KIA).
- Khách bị dọn vì quá 30 giây (CHỜ BÊN KIA → ĐỦ NGƯỜI, thật ra quay lại CHỜ ĐỐI THỦ vì
  `evictStaleGuestIfNeeded` xoá luôn `black_guest_name`) — việc dọn còn là **lazy**, chỉ
  thật sự xảy ra khi có request đọc/ghi tiếp theo tới ván đó.

Vì vậy: trong lúc `status==='pending'`, cả `cotuong-van` (chủ phòng) và `cotuong-phong`
(khách) tự `setInterval` gọi lại `GET /games/:id` mỗi 3 giây (đủ nhanh để cảm giác mượt,
đủ thưa để không tải server) — dừng ngay khi `status` khác `'pending'` (chuyển hẳn sang
dựa vào SSE như bàn cờ đang đấu vẫn làm). Đây cũng là cơ chế khiến việc dọn khách quá hạn
thực sự được kích hoạt phía server (poll của chính người đó, hoặc của chủ phòng, đều đủ —
`evictStaleGuestIfNeeded` chạy trên mọi lượt đọc). Dừng interval khi rời màn (`render()` đã
có chỗ dọn tương tự cho `GAME_EVENTSOURCE` ở dòng 2128 — thêm một dòng dọn poll-timer theo
đúng mẫu đó cho cả hai màn).

## 8. Lưu phiên khách (localStorage)

Theo quyết định đã chốt: lưu thuần `localStorage`, không nhúng token vào URL sau lần đầu,
không cơ chế kép. Khoá theo **token mời trong URL** (ổn định, có sẵn ngay khi vào link),
không theo `gameId` (khách chưa biết `gameId` trước khi join lần đầu):

```text
key:   xq_guest_<invite_token>
value: JSON { gameId, guestToken, guestName }
```

Ghi ngay sau khi `POST /games/rooms/:token/join` thành công. Đọc khi `PUB['cotuong-phong']`
mount với cùng `token` trong URL. Không cần dọn/hết hạn chủ động — ván kết thúc thì API các
thao tác chơi tự chối (409), màn khách khi đó chỉ hiện kết quả cuối cùng từ `GET`, không
gọi lại các endpoint đó nữa; bản ghi cũ trong `localStorage` không gây hại gì nếu người
dùng quay lại link cũ sau này (sẽ thấy đúng ván đã kết thúc).

## 9. Client HTTP cho khách

**Không** dùng `window.api` (`web/js/api.js`) cho khách — module đó gắn chặt với phiên
thành viên: `access`/`refresh` token cặp đôi trong `localStorage['nc_access']`, cơ chế làm
mới token khi 401, `api.onAuthLost()`. Token khách (`black_guest_token`) không có refresh,
không gắn đăng nhập, phạm vi đúng một ván — ép vào khuôn đó sai ngữ nghĩa và có thể vô tình
làm mất phiên thành viên đang đăng nhập trên cùng trình duyệt (ví dụ nếu ai đó vừa là thành
viên vừa mở link khách ở tab khác).

Thêm một hàm nhỏ, ví dụ `guestFetch(guestToken, method, path, body)`, dùng `fetch()` thẳng
tới `api.baseUrl() + path` (tái dùng `api.baseUrl()` — chỉ là hằng số URL gốc, không dính
phiên) với header `Authorization: Bearer ${guestToken}`, parse JSON, map lỗi qua cùng bảng
`MESSAGES` mà `api.js` dùng cho thông báo tiếng Việt nhất quán. Không cần logic retry/refresh
— gặp lỗi thì hiện thông báo, để người chơi tự thử lại (khớp mức độ nghiêm trọng thấp của
một ván cờ so với các luồng thanh toán/dữ liệu quan trọng khác trong app).

## 10. Giao diện: tái sử dụng style

Không tạo class mới ngoài những gì hai trạng thái phòng (CHỜ ĐỐI THỦ/ĐỦ NGƯỜI/CHỜ BÊN KIA)
thật sự cần mà family `.xq-*` hiện có (từ dòng 365) chưa có sẵn — cụ thể có thể cần thêm:
- `.xq-room-card` hoặc tái dùng thẳng `.xq-fs-card` (đã dùng cho lời thách đấu đang chờ ở
  `cotuong-van`, bố cục thẻ giữa màn giống hệt nhu cầu "CHỜ ĐỐI THỦ").
- `.xq-clock`/`.xq-clock.low` (dưới 1 phút, đổi màu cảnh báo) — chưa có tương đương, thêm
  mới, đặt cạnh các định nghĩa `.xq-status-bar`/`.xq-announce`.

Băng thông báo mất kết nối/cầu hoà dùng thẳng `xqAnnounceHtml()` + `.xq-announce` đã có
(đang dùng cho "Chiếu tướng!"/kết quả ván) — chỉ đổi nội dung và loại (`win`/`lose`/rỗng),
không cần biến thể mới.

## 11. Xử lý lỗi

- Link mời sai/đã dùng hết (phòng đã có khách) → `POST /rooms/:token/join` trả lỗi
  `INVALID_STATE` (409, thông điệp "Phòng này đã có khách hoặc đã bắt đầu.") — hiện thẳng
  thông điệp đó, không có hành động khôi phục (khách cần link mới từ chủ phòng).
- Ván không tồn tại (id sai, hoặc chủ phòng đã "Đóng phòng" lúc còn `pending` — mục 4) →
  `GET /games/:id` trả 404 → màn hiện "Không tìm thấy ván cờ", giống hệt cách
  `V['cotuong-van']` đã xử lý `GAME_STATE.error` hiện tại.
- Token khách trong `localStorage` không còn hợp lệ (mục 5: tự rời phòng ở tab khác, hoặc
  chủ phòng đóng phòng) → xử lý đúng như mục 5 đã nêu: xoá bản lưu cũ, quay lại form nhập
  tên thay vì lặp lại lỗi cho người dùng.
- Mất mạng khi đang gọi API (không phải lỗi HTTP, mà `fetch` reject) → toast lỗi chung, giữ
  nguyên trạng thái hiện tại trên màn hình (không tự lùi lại UI), người chơi tự thử lại thao
  tác — khớp cách `chatSend()`/các hàm khác trong file đang xử lý lỗi mạng (bắt rồi bỏ qua
  có kiểm soát, không throw ra ngoài làm vỡ `render()`).

## 12. Kiểm thử

Không có bộ kiểm thử tự động cho `web/index.html` (không build step, không test runner phía
front-end trong dự án — xác nhận qua cấu trúc thư mục `web/`, chỉ có `tests/t36-web-api-wiring.test.js`
phía `api/` kiểm tra vài chuỗi cố định tồn tại trong HTML, không chạy DOM thật). Kế hoạch
triển khai cần liệt kê kịch bản kiểm thử thủ công tối thiểu:
1. Chủ phòng tạo phòng → thấy link mời → chép được.
2. Mở link mời ở cửa sổ ẩn danh khác (đóng vai khách) → nhập tên → vào phòng → chủ phòng
   thấy tên khách xuất hiện trong ≤3 giây (polling).
3. Cả hai bấm Sẵn sàng → ván bắt đầu ở cả hai màn gần như đồng thời (SSE `game_start`).
4. Khách tải lại trang giữa ván → quay lại đúng ván, đúng màu quân, đúng đồng hồ còn lại.
5. Một bên cầu hoà → bên kia thấy băng thông báo, Đồng ý → ván kết thúc hoà ở cả hai màn.
6. Đóng tab khách giữa ván → chủ phòng thấy băng "mất mạng" sau vài giây, đếm ngược 60s,
   hết giờ nhận thắng.
7. Khách bấm Rời phòng giữa ván → có hộp xác nhận đúng câu cảnh báo → xác nhận → khách
   thua, chủ phòng thấy kết quả.
8. Khách vào phòng nhưng không bấm Sẵn sàng quá 30 giây → bị dọn khỏi phòng, link mời dùng
   lại được cho một khách khác.

## 13. Tệp bị đụng (tóm tắt cho bước lập kế hoạch)

- `web/index.html` — sửa `V['cotuong-online']` (thêm nút Tạo phòng), sửa `V['cotuong-van']`
  (thêm nhánh trạng thái phòng + panel đồng hồ/cầu hoà/mất kết nối/rời phòng), thêm mới
  `PUB['cotuong-phong']` + các hàm phụ trợ (client khách, format đồng hồ, poll-timer), thêm
  `cotuong-phong` vào `PUBLIC_SCREENS` (dòng 2076) và `XQ_FULLSCREEN_SCREENS` (dòng 2195),
  thêm CSS mới (`.xq-clock` và biến thể) vào khối `.xq-*` (từ dòng 365).
- Không đụng `web/js/api.js`, không đụng bất kỳ file phía `api/` nào — toàn bộ endpoint đã
  có sẵn và đã merge.
