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
