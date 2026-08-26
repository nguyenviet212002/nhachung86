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
const gameClients = new Map(); // gameId -> Map<res, memberId>

export function subscribeGame(gameId, memberId, res) {
  let map = gameClients.get(gameId);
  if (!map) { map = new Map(); gameClients.set(gameId, map); }
  map.set(res, memberId);
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
  for (const id of map.values()) if (id === memberId) return true;
  return false;
}
