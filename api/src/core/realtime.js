// SSE fan-out trong một process. Nếu chạy nhiều replica, giữ nguyên event
// contract và thay lớp này bằng Redis/NATS pub-sub.
const clients = new Map();

export function subscribeMember(memberId, res) {
  let set = clients.get(memberId);
  if (!set) { set = new Set(); clients.set(memberId, set); }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) clients.delete(memberId);
  };
}

export function publishToMember(memberId, event, data) {
  const set = clients.get(memberId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
  if (!set.size) clients.delete(memberId);
}

// Phòng theo ván cờ: nhiều kết nối (người chơi VÀ người xem) cùng nhận một
// luồng sự kiện. Khác subscribeMember ở chỗ giữ luôn memberId cạnh mỗi kết
// nối — /moves cần biết "đối thủ có đang mở kết nối phòng này không" để
// quyết định có cần gửi thêm notification hay không (xem service.js move()).
//
// Lệch có chủ đích khỏi bản gốc (vòng soát xét cuối cùng của cả nhánh, phát
// hiện Critical): giá trị map trước đây chỉ là memberId thô, không hề có khái
// niệm "bên" ('r'/'b'). Route /:id/stream (games/routes.js) gọi
// markDisconnected() ngay khi BẤT KỲ MỘT kết nối nào của ván này đóng lại,
// không kiểm xem bên đó còn kết nối nào khác đang mở hay không — người chơi
// mở ván ở hai tab trình duyệt, đóng một tab (tab kia vẫn sống) bị đánh dấu
// mất kết nối oan, đối thủ báo /disconnect-timeout thắng thật dù người kia
// vẫn đang chơi bình thường. Cùng lỗ hổng xảy ra khi EventSource tự động kết
// nối lại: kết nối mới subscribe TRƯỚC khi server kịp nhận biết kết nối cũ đã
// đóng vẫn có thể để sót cờ mất kết nối cho một người chưa từng thật sự rời.
// Sửa: giữ luôn `side` cạnh memberId, để routes.js chỉ gọi markDisconnected()
// sau khi xác nhận (qua isSideWatchingGame() bên dưới) không còn kết nối nào
// khác của ĐÚNG bên đó.
const gameClients = new Map(); // gameId -> Map<res, { memberId, side }>

export function subscribeGame(gameId, memberId, side, res) {
  let map = gameClients.get(gameId);
  if (!map) { map = new Map(); gameClients.set(gameId, map); }
  map.set(res, { memberId, side });
  return () => {
    map.delete(res);
    if (!map.size) gameClients.delete(gameId);
  };
}

export function publishToGame(gameId, event, data) {
  const map = gameClients.get(gameId);
  if (!map) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of map.keys()) {
    try { res.write(payload); } catch { map.delete(res); }
  }
  if (!map.size) gameClients.delete(gameId);
}

export function isWatchingGame(gameId, memberId) {
  const map = gameClients.get(gameId);
  if (!map) return false;
  for (const v of map.values()) if (v.memberId === memberId) return true;
  return false;
}

// Dùng ở routes.js req.on('close') để quyết định có nên coi một BÊN là mất
// kết nối hay không — trả true nếu còn ít nhất một kết nối khác (tab khác,
// hoặc kết nối mới do EventSource tự retry) của đúng bên này đang mở cho ván
// đó. Khác isWatchingGame() ở trên: hàm đó khớp theo memberId (ai), hàm này
// khớp theo side (bên nào) — một khách (memberId luôn null, xem resolveSide())
// vẫn có "bên" dù không có memberId để so.
export function isSideWatchingGame(gameId, side) {
  const map = gameClients.get(gameId);
  if (!map) return false;
  for (const v of map.values()) if (v.side === side) return true;
  return false;
}

// Phòng theo 1 nhu cầu việc — cùng cơ chế gameClients ở trên, dùng cho màn
// chi tiết việc làm (V['viec-detail']) để cả người đăng lẫn người ứng tuyển
// đang mở cùng 1 tin đều thấy trạng thái ứng tuyển/giới thiệu mới nhất mà
// không cần tải lại trang.
const jobClients = new Map(); // jobId -> Set<res>

export function subscribeJob(jobId, res) {
  let set = jobClients.get(jobId);
  if (!set) { set = new Set(); jobClients.set(jobId, set); }
  set.add(res);
  return () => {
    set.delete(res);
    if (!set.size) jobClients.delete(jobId);
  };
}

export function publishToJob(jobId, event, data) {
  const set = jobClients.get(jobId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
  if (!set.size) jobClients.delete(jobId);
}
