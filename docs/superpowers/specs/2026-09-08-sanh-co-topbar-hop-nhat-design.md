# Sảnh Cờ — Topbar hợp nhất + Phòng đấu/Xếp hạng/Hướng dẫn — Thiết kế

**Trạng thái:** design đã duyệt qua brainstorming rút gọn (người dùng yêu cầu làm nhanh, không dừng hỏi lại giữa chừng — xem lịch sử phiên làm việc).

**Phạm vi:** chỉ Cờ Tướng online thật (đấu người) — `cotuong-online`, `cotuong-van`, `cotuong-phong`, cộng 3 màn mới. KHÔNG đụng `cotuong` (pass-and-play), `cotuong-may`/`cotuong-the-nhanh` (đấu máy offline), hay bất kỳ màn Cờ Thế nào (`cotuong-the*`) — Cờ Thế có thiết kế và nhánh phát triển riêng của phiên khác.

## 1. Vấn đề

Ảnh mẫu tham chiếu (người dùng gửi trong phiên) cho thấy màn đang đấu có một **thanh topbar riêng "SẢNH CỜ NHACCON6789"** (logo, 4 tab: Cờ Tướng/Phòng đấu/Xếp hạng/Hướng dẫn, chuông thông báo, menu tài khoản) phía trên bố cục 3 cột. Hiện trạng:

- `cotuong-online` (sảnh/tạo phòng) dùng khung TOÀN TRANG (`headerComp`/`wrapPage`) — thanh điều hướng chung "Nhà Chung 86" với rất nhiều mục không liên quan cờ tướng, "Sảnh Cờ" chỉ là 1 icon trong đó.
- `cotuong-van`/`cotuong-phong` (đang đấu) dùng `xqFullscreenShell()` — HOÀN TOÀN không có header, chỉ có nút ☰ (nếu có panel) và nút X thoát.

Hai màn này vì vậy trông như hai app khác nhau, không nhất quán, và không giống ảnh mẫu. Đây là điều "gộp phần đấu cờ và phần tạo phòng trong 1 cái" muốn sửa.

Ba tab trong ảnh mẫu — Phòng đấu, Xếp hạng, Hướng dẫn — hiện **không tồn tại** như màn hình riêng nào cả.

## 2. Kiến trúc: một "vỏ Sảnh Cờ" dùng chung

Thêm một khung mới, **thay thế hẳn** `wrapPage()`/`headerComp()` cho các màn Sảnh Cờ, không xếp chồng lên nó:

```
XQ_HALL_SCREENS = {'cotuong-online','cotuong-phong-dau','cotuong-xep-hang','cotuong-huong-dan'}
```

`render()` thêm một nhánh mới (song song với nhánh `XQ_FULLSCREEN_SCREENS` đã có, đặt TRƯỚC nó): nếu `screen` nằm trong `XQ_HALL_SCREENS`, gọi `xqHallShell(activeTab, bodyHtml)` thay vì `wrapPage(...)`. Cả 4 màn này vẫn yêu cầu đăng nhập (variant member) — giữ nguyên hành vi hiện tại của `cotuong-online`, không mở thêm đường công khai mới.

`xqHallShell()` và `xqFullscreenShell()` (đang đấu) đều gọi chung một hàm dựng topbar: `xqTopbarHtml(activeTab)` — đây chính là "gộp làm 1": tạo phòng và đang đấu giờ hiện đúng MỘT thanh topbar, cùng mã nguồn.

```js
function xqTopbarHtml(activeTab){
  // activeTab: 'cotuong-online' | 'cotuong-phong-dau' | 'cotuong-xep-hang' | 'cotuong-huong-dan' | null (đang đấu — không tab nào sáng)
  const tabs = [
    {id:'cotuong-online', label:'Cờ Tướng'},
    {id:'cotuong-phong-dau', label:'Phòng đấu'},
    {id:'cotuong-xep-hang', label:'Xếp hạng'},
    {id:'cotuong-huong-dan', label:'Hướng dẫn'},
  ];
  // logo trỏ về cotuong-online; tái dùng NGUYÊN VẸN #bellBtn/#notifPanel và
  // #umenuBtn/#umenu (đã có sẵn logic ở bindGlobal() — không cần đổi gì ở đó);
  // thêm 1 icon bánh răng trỏ thẳng #caidat.
}
```

`xqFullscreenShell()` sửa lại: khi `closeTarget` thuộc nhóm Sảnh Cờ (`cotuong-van`/`cotuong-phong`), render `xqTopbarHtml(null)` ngay phía trên `.wrap`, TRƯỚC nút ☰/X hiện tại (giữ nguyên nút ☰/X — đó là điều khiển panel/thoát của riêng ván đấu, không phải điều hướng site). Các màn fullscreen khác (`cotuong`, `cotuong-may`, `cotuong-the*`) giữ nguyên như cũ — không thêm topbar này, đúng phạm vi đã chốt.

**Vì sao thay thế thay vì xếp chồng:** ảnh mẫu chỉ có một thanh ngang duy nhất trên cùng. Xếp 2 topbar (site + Sảnh Cờ) chồng nhau vừa không giống ảnh, vừa tốn chỗ dọc — màn hình điện thoại vốn đã chật (bài học từ lỗi panel che bàn cờ vừa sửa trong phiên này).

**Rủi ro đã cân nhắc:** rời khung site đồng nghĩa các mục điều hướng khác (Nhà Chung/Hệ Thống/Quỹ...) không còn hiện trên các màn Sảnh Cờ. Tab "Cờ Tướng" trong topbar mới trỏ về đúng `cotuong-online` — không có đường quay lại "Bảng nhà" trực tiếp trên thanh này. Chấp nhận đánh đổi này vì logo Sảnh Cờ (giống mọi topbar khác trên site) vẫn là lối thoát tự nhiên; nếu về sau thấy bất tiện, thêm một liên kết nhỏ "← Nhà Chung" cạnh logo là việc nhỏ, không cần thiết kế lại.

## 3. Phòng đấu (`cotuong-phong-dau`) — màn mới, không cần API mới

Dữ liệu đã có sẵn: `loadGamesList()` đã gọi `GET /games?status=active&limit=20` (ván đang diễn ra, `GAMES_LIST.open`) và `GET /games?mine=true&status=pending,active&limit=20` (`GAMES_LIST.mine`) — hiện chỉ dùng để đếm badge, chưa từng hiện thành danh sách. Màn mới hiện đúng hai danh sách đó:

- **"Ván của bạn"** (`GAMES_LIST.mine`, nếu có): mỗi dòng — tên đối thủ, trạng thái (chờ đối thủ/đang đấu), nút "Vào tiếp" → `go('cotuong-van:'+id)`.
- **"Đang diễn ra"** (`GAMES_LIST.open`, lọc bỏ ván đã có trong "mine" để không lặp): mỗi dòng — tên 2 người chơi, nút "Xem" → `go('cotuong-van:'+id)` (màn `cotuong-van` đã tự vẽ đúng chế độ xem — `mySide` null — khi người xem không phải 1 trong 2 người chơi, xem nhánh `!mySide` hiện có).
- Rỗng cả hai: thông báo trống + nút "Tạo phòng" (gọi lại `roomCreate()` đã có).

Không route mới, không schema mới — chỉ 1 hàm render frontend dùng lại `GAMES_LIST`/`loadGamesList()`.

## 4. Xếp hạng (`cotuong-xep-hang`) — màn mới + 1 API mới

Chưa có hệ thống điểm/rating nào (ELO...). Chọn **tỉ lệ thắng** trên các ván đã kết thúc VÀ đã mổ xong (`analyzed_at IS NOT NULL` — cùng điều kiện `getMemberProfile` đã dùng, tránh tính cả ván máy chưa kịp mổ), với **ngưỡng tối thiểu 5 ván** để vào bảng — dưới ngưỡng thì tỉ lệ thắng của 1-2 ván dễ gây hiểu lầm (100% sau đúng 1 ván thắng may).

**Backend — `api/src/modules/games/service.js`**, hàm mới `getLeaderboard({ actor })`:

```sql
SELECT member_id, full_name, avatar_url,
       COUNT(*) AS games_played,
       SUM(CASE WHEN won THEN 1 ELSE 0 END) AS wins,
       AVG(avg_loss) AS avg_loss
FROM (
  SELECT g.red_member_id AS member_id, g.winner_member_id = g.red_member_id AS won, g.red_avg_loss AS avg_loss
    FROM games g WHERE g.community_id = ? AND g.status='finished' AND g.analyzed_at IS NOT NULL
  UNION ALL
  SELECT g.black_member_id, g.winner_member_id = g.black_member_id, g.black_avg_loss
    FROM games g WHERE g.community_id = ? AND g.status='finished' AND g.analyzed_at IS NOT NULL
      AND g.black_member_id IS NOT NULL -- loại ván khách (không thành viên, không xếp hạng)
) x JOIN members m ON m.id = x.member_id
GROUP BY member_id, full_name, avatar_url
HAVING COUNT(*) >= 5
ORDER BY (SUM(CASE WHEN won THEN 1 ELSE 0 END)::float / COUNT(*)) DESC, games_played DESC
LIMIT 50
```

Khách (`black_guest_token`, không có `black_member_id`) bị loại khỏi vế UNION thứ hai — đúng nguyên tắc đã có ở `getAnalysis`/`getMemberProfile`: khách không có hồ sơ, không xếp hạng được.

**Route:** `GET /games/leaderboard`, `requireAuth` (không `requireAuthOrGuestToken` — khách không xem bảng xếp hạng, cùng lý do trên). Trả `{ data: [{ member_id, full_name, avatar_url, games_played, wins, win_rate, avg_loss }] }` (`win_rate` tính sẵn ở service, làm tròn 1 chữ số thập phân — tránh frontend phải tính lại).

**Frontend:** bảng đơn giản — hạng (thứ tự trong mảng trả về), avatar+tên, số ván, % thắng, ACPL trung bình. Dòng cuối: ghi chú "Chỉ xếp hạng thành viên đã chơi ít nhất 5 ván (đã mổ xong)."

## 5. Hướng dẫn (`cotuong-huong-dan`) — màn mới, không API

Nội dung tĩnh hoàn toàn, viết thẳng trong hàm render (không cần bảng CSDL cho nội dung tĩnh — YAGNI, sửa nội dung sau này là sửa code, đúng thực hành hiện có của site cho các trang tĩnh khác). Hai phần:

1. **Luật chơi cơ bản** — quân, cách đi, cách thắng/hoà (tóm tắt, không cần đầy đủ như sách luật).
2. **Cách dùng Sảnh Cờ** — giải thích ngắn từng tính năng đã có: tạo phòng & mời (link mời không cần tài khoản), máy đi hộ, mổ ván (ACPL) sau khi kết thúc, hồ sơ đối thủ, xếp hạng.

## 6. Mã phòng + Chia sẻ nhanh — bổ sung màn chờ đối thủ

Vị trí: khối "Phòng đang chờ đối thủ" hiện có trong `V['cotuong-van']` (nhánh `phase==='cho-doi-thu'`, quanh dòng 6868-6881 hiện tại) — giữ nguyên ô link mời + nút "Chép" đã có, THÊM:

- **Mã phòng** (chỉ để nhận diện bằng mắt, KHÔNG phải một cách đăng nhập mới): `'G-' + gameId.slice(0,4)`. Không thêm cột CSDL, không thêm endpoint tra cứu theo mã ngắn — join phòng CHỈ qua link mời đầy đủ như hiện tại. Lý do: thêm một đường vào bằng mã ngắn (dễ đoán/dò) sẽ là một bề mặt tấn công mới cho một tính năng chỉ cần đẹp mắt, không cần chức năng thật.
- **Chia sẻ nhanh**: 4 nút — Facebook (dùng thẳng `https://www.facebook.com/sharer/sharer.php?u=<link đã encode>`, mở tab mới — đây là endpoint công khai, ổn định, không cần SDK), "Chia sẻ khác" dùng Web Share API (`navigator.share({url: link})`) khi trình duyệt hỗ trợ (phủ được Zalo/Messenger/SMS... qua bảng chia sẻ hệ điều hành trên điện thoại — đúng nơi tính năng này hữu ích nhất), nút Copy (dùng lại logic "Chép" đã có), nút QR — hiện ảnh QR qua `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=<link đã encode>">` (dịch vụ ảnh QR công khai, không cần thư viện mới; link mời vốn dĩ đã được tạo ra để chia sẻ nên gửi nó qua dịch vụ tạo ảnh QR không phát sinh rò rỉ thông tin mới).
  - Không tự dựng driver Zalo riêng (không có tài liệu chính thức đáng tin cậy cho một share-intent URL của Zalo tại thời điểm viết spec này) — Web Share API là lựa chọn an toàn hơn, đúng chuẩn, và trong thực tế đã bao gồm Zalo trên điện thoại có cài app đó.

## 7. Việc KHÔNG làm (giữ nguyên)

- `xqAiToggleHtml`/`gameSetAiLevel`, `xqAnalysisPanelHtml`, `xqOpponentProfileHtml`, `xqCapturedHtml`/`xqMoveLogHtml`, lưới CSS `.xq-3col*` — đã đúng, không đụng vào.
- `guestGameHtml` (màn khách) — không thêm topbar (khách vào thẳng bằng link mời, không có khái niệm "duyệt Sảnh Cờ"; ảnh mẫu chỉ mô tả màn CHỦ PHÒNG).
- Không đổi `cotuong` (pass-and-play), `cotuong-may`/`cotuong-the-nhanh`, hay bất kỳ màn `cotuong-the*` nào.
- Không thêm hệ thống rating/ELO — chỉ tỉ lệ thắng đơn giản, đúng YAGNI cho quy mô 1 khoá/cộng đồng nhỏ này.

## 8. Kiểm thử

- Backend: test mới cho `getLeaderboard` — đủ ngưỡng 5 ván lên bảng, dưới ngưỡng bị loại, khách không tính, sắp xếp đúng theo tỉ lệ thắng rồi số ván; test route (`requireAuth`, 401 nếu không có token).
- Frontend: không có test tự động hiện có cho `web/index.html` (site không có bộ test frontend) — xác minh bằng browser-automation thật cho: (a) topbar hiện đúng ở cả 4 màn hall + màn đang đấu, tab đang active tô đúng màu; (b) Phòng đấu hiện đúng danh sách/rỗng; (c) Xếp hạng hiện đúng bảng (dựng dữ liệu test qua CSDL trực tiếp để có đủ 5 ván mổ xong); (d) nút chia sẻ nhanh mở đúng URL/copy đúng link.
