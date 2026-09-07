import { PikafishEngine } from './uci.js';

// N tiến trình Pikafish; request tới khi cả N đang bận thì xếp hàng FIFO —
// đúng mục 1 spec Kernel/Engine ("nhận request tuần tự theo hàng đợi khi số
// ván cần nước đi cùng lúc vượt kích thước pool").
export class PikafishPool {
  constructor({ size, binPath, nnuePath, threads, hashMb }) {
    this._workerOpts = { binPath, nnuePath, threads, hashMb }; // giữ lại để dựng worker thay thế cùng cấu hình
    this.workers = Array.from({ length: size }, () => new PikafishEngine(this._workerOpts));
    this.free = [];
    this.queue = [];
  }

  async start() {
    await Promise.all(this.workers.map((w) => w.start()));
    // Gắn onFatal SAU KHI tất cả đã bắt tay xong — xem lời giải thích trong
    // constructor của PikafishEngine (uci.js): nếu gắn sớm hơn, một worker chết
    // ngay trong lúc đang bắt tay sẽ vừa làm start() ném lỗi (chỗ gọi start() tự
    // bắt), vừa kích onFatal ở đây chạy thêm một luồng dựng lại song song thứ
    // hai cho CÙNG một cái chết — trùng lặp không cần thiết.
    this.workers.forEach((w) => { w.onFatal = (worker, err) => this._onWorkerDied(worker, err); });
    this.free = [...this.workers];
  }

  async bestMove(args) {
    const worker = await this._acquire();
    try { return await worker.bestMove(args); }
    finally { this._release(worker); }
  }

  _acquire() {
    if (this.free.length) return Promise.resolve(this.free.pop());
    // Giữ cả resolve lẫn reject của lượt xếp hàng — _replace() cần reject thẳng
    // khi không dựng lại được worker mới, thay vì để người gọi treo vĩnh viễn.
    return new Promise((resolve, reject) => this.queue.push({ resolve, reject }));
  }

  _release(worker) {
    // worker.alive === false ở đây nghĩa là _onWorkerDied() đã (hoặc sắp) xử lý
    // rồi — onFatal() luôn được uci.js gọi ĐỒNG BỘ ngay khi phát hiện tiến trình
    // chết, tức là TRƯỚC KHI đoạn finally này (chạy sau khi promise bestMove bị
    // reject) có cơ hội chạy tới. Không làm gì thêm ở đây — đặc biệt KHÔNG được
    // trả một worker đã chết về free/queue (xem uci.js vì sao nguy hiểm).
    if (!worker.alive) return;
    const next = this.queue.shift();
    if (next) next.resolve(worker); else this.free.push(worker);
  }

  _onWorkerDied(deadWorker) {
    // Bắn ra CHÍNH XÁC một lần cho mỗi worker khi nó chết (uci.js chỉ gọi
    // onFatal một lần nhờ cờ alive), bất kể lúc đó worker đang rảnh (free) hay
    // đang bận phục vụ một lượt tìm. Đây là điểm DUY NHẤT khởi động việc dựng
    // lại worker thay thế — _release() phía trên chỉ no-op khi thấy worker chết,
    // không tự dựng lại nữa, nên không có nguy cơ dựng lại hai lần cho cùng một
    // worker (khác với thiết kế cũ chỉ phát hiện chết lúc acquire/release, có
    // thể bỏ sót ca "chết lúc đang rảnh" cho tới tận lượt request kế tiếp).
    const i = this.free.indexOf(deadWorker);
    if (i !== -1) this.free.splice(i, 1); // gỡ ngay khỏi free — không để lọt vào tay người khác qua _acquire()
    this._replace(deadWorker);
  }

  async _replace(deadWorker, attempt = 1) {
    const idx = this.workers.indexOf(deadWorker);
    const fresh = new PikafishEngine(this._workerOpts);
    if (idx !== -1) this.workers[idx] = fresh;
    try {
      await fresh.start();
    } catch (err) {
      // Dựng lại thất bại (vd. binary hỏng, hết bộ nhớ, hoặc lại chết ngay giữa
      // lúc đang bắt tay UCI — xem _deathRace trong uci.js). Báo lỗi ngay cho
      // người đang xếp hàng đầu hàng đợi (nếu có) để họ không treo vô thời hạn,
      // rồi tự thử lại sau một khoảng lùi dần (tối đa 30s) thay vì bỏ rơi slot
      // này vĩnh viễn HOẶC dựng-rồi-chết-rồi-dựng liên tục nếu binary hỏng thật
      // — cả hai đều tệ hơn một service tạm thời thiếu một worker.
      const next = this.queue.shift();
      if (next) next.reject(err);
      const delay = Math.min(30000, 500 * 2 ** (attempt - 1));
      setTimeout(() => this._replace(fresh, attempt + 1), delay);
      return;
    }
    fresh.onFatal = (worker, err) => this._onWorkerDied(worker, err); // xem PikafishPool.start() — chỉ gắn sau khi bắt tay xong
    const next = this.queue.shift();
    if (next) next.resolve(fresh); else this.free.push(fresh);
  }
}
