import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Bọc ĐÚNG MỘT tiến trình Pikafish qua giao thức UCI. Chỉ xử lý một lượt tìm
// tại một thời điểm — PikafishPool (pool.js) xếp hàng khi cần hơn một lượt
// cùng lúc (mục 1 spec Kernel/Engine).
export class PikafishEngine {
  constructor({ binPath, nnuePath, threads, hashMb }) {
    this.binPath = binPath;
    this.nnuePath = nnuePath;
    this.threads = threads;
    this.hashMb = hashMb;
    this.proc = null;
    this.rl = null;
    this.pending = null; // { resolve, reject, lines: Map<multipv, line> }
    this._currentMultiPv = 1;
  }

  start() {
    this.proc = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => this._onLine(line));
    this.proc.on('exit', (code) => {
      // Tiến trình chết giữa chừng (hiếm, vd. OOM) — huỷ lượt đang chờ thay vì
      // để promise treo vĩnh viễn, không ai gọi resolve/reject nữa.
      if (this.pending) { this.pending.reject(new Error(`Pikafish thoát bất ngờ (mã ${code})`)); this.pending = null; }
    });
    return this._handshake();
  }

  _send(cmd) { this.proc.stdin.write(cmd + '\n'); }

  _waitFor(token, onStart) {
    return new Promise((resolve) => {
      const handler = (line) => { if (line.trim() === token) { this.rl.off('line', handler); resolve(); } };
      this.rl.on('line', handler);
      onStart();
    });
  }

  async _handshake() {
    await this._waitFor('uciok', () => this._send('uci'));
    this._send(`setoption name Threads value ${this.threads}`);
    this._send(`setoption name Hash value ${this.hashMb}`);
    this._send(`setoption name EvalFile value ${this.nnuePath}`);
    this._send('setoption name MultiPV value 1');
    this._currentMultiPv = 1;
    await this._waitFor('readyok', () => this._send('isready'));
  }

  _onLine(line) {
    if (!this.pending) return;
    if (line.startsWith('info ') && line.includes(' multipv ')) {
      const mpv = Number(line.match(/\bmultipv (\d+)/)?.[1]);
      const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
      const depthMatch = line.match(/\bdepth (\d+)/);
      const pvMatch = line.match(/ pv (.+)$/);
      if (!mpv || !scoreMatch || !pvMatch) return;
      this.pending.lines.set(mpv, {
        move: pvMatch[1].split(' ')[0],
        score_cp: scoreMatch[1] === 'cp' ? Number(scoreMatch[2]) : null,
        mate: scoreMatch[1] === 'mate' ? Number(scoreMatch[2]) : null,
        depth: depthMatch ? Number(depthMatch[1]) : null,
        pv: pvMatch[1].split(' '),
      });
    } else if (line.startsWith('bestmove ')) {
      const bestmove = line.split(' ')[1];
      const { resolve, lines } = this.pending;
      this.pending = null;
      const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      const top = sorted[0] ?? { move: bestmove, score_cp: null, mate: null, depth: null, pv: [bestmove] };
      resolve({ bestmove, score_cp: top.score_cp, mate: top.mate, depth: top.depth, pv: top.pv, lines: sorted });
    }
  }

  async bestMove({ fen, movetime, multipv }) {
    if (this.pending) throw new Error('PikafishEngine đang bận một lượt tìm khác.');
    if (multipv !== this._currentMultiPv) {
      this._send(`setoption name MultiPV value ${multipv}`);
      this._currentMultiPv = multipv;
    }
    this._send(`position fen ${fen}`);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, lines: new Map() };
      this._send(`go movetime ${movetime}`);
    });
  }

  stop() { this.proc?.kill(); }
}
