import { config } from '../../config/index.js';

// Gọi dịch vụ engine (mục 6 spec Kernel/Engine). Timeout dài hơn hẳn movetime
// thật: pool phía engine có thể đang bận, request phải CHỜ ĐƯỢC trong hàng
// đợi (mục 1 spec), không phải chỉ chờ đúng thời gian nghĩ của một lượt.
export async function bestMove({ fen, movetime, multipv }) {
  const res = await fetch(`${config.ENGINE_URL}/bestmove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, movetime, multipv }),
    signal: AbortSignal.timeout(movetime + 30_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`engine trả lỗi ${res.status}: ${body.error ?? ''}`);
  }
  return res.json();
}
