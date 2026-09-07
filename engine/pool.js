import { PikafishEngine } from './uci.js';

// N tiến trình Pikafish; request tới khi cả N đang bận thì xếp hàng FIFO —
// đúng mục 1 spec Kernel/Engine ("nhận request tuần tự theo hàng đợi khi số
// ván cần nước đi cùng lúc vượt kích thước pool").
export class PikafishPool {
  constructor({ size, binPath, nnuePath, threads, hashMb }) {
    this.workers = Array.from({ length: size }, () => new PikafishEngine({ binPath, nnuePath, threads, hashMb }));
    this.free = [];
    this.queue = [];
  }

  async start() {
    await Promise.all(this.workers.map((w) => w.start()));
    this.free = [...this.workers];
  }

  async bestMove(args) {
    const worker = await this._acquire();
    try { return await worker.bestMove(args); }
    finally { this._release(worker); }
  }

  _acquire() {
    if (this.free.length) return Promise.resolve(this.free.pop());
    return new Promise((resolve) => this.queue.push(resolve));
  }

  _release(worker) {
    const next = this.queue.shift();
    if (next) next(worker); else this.free.push(worker);
  }
}
