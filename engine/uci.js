import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Bắt tay UCI bình thường gần như tức thời — nạp NNUE là bước chậm nhất và
// thường mất chưa tới vài giây. 15s đủ dư cho máy chậm, đủ ngắn để vòng lặp
// retry-với-backoff của PikafishPool._replace() (pool.js) không treo vô thời
// hạn chờ một tiến trình đã treo.
const HANDSHAKE_TIMEOUT_MS = 15000;

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
    this.alive = false; // true chỉ sau khi start() spawn thành công tới khi exit/error
    // PikafishPool gắn hàm này SAU KHI start() bắt tay xong (xem pool.js) để
    // được báo NGAY khi worker này chết trong lúc đang phục vụ (free hoặc bận)
    // — không gắn từ constructor, vì nếu chết ngay trong lúc đang bắt tay thì
    // lỗi phải rơi thẳng vào chỗ đang await start() (pool._replace), tránh việc
    // onFatal kích thêm một luồng dựng lại thứ hai chạy song song.
    this.onFatal = null;
  }

  start() {
    this.proc = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.alive = true;
    // _waitFor() bên dưới (dùng trong bắt tay UCI) tự hết giờ sau
    // HANDSHAKE_TIMEOUT_MS nếu dòng mong đợi không xuất hiện (xem _waitFor) —
    // nhưng đó là đường dành cho tiến trình TREO (spawn được, không nói gì,
    // không exit). Nếu tiến trình CHẾT NGAY trong lúc đang bắt tay (vd. bị
    // PikafishPool._replace() khởi động lại rồi bị kill/OOM trước khi kịp gửi
    // "uciok"/"readyok"), sẽ không còn dòng nào tới nữa và không có gì để chờ
    // hết giờ cho đúng nghĩa treo — _deathRace là lối thoát riêng cho ca này:
    // hễ tiến trình chết trước khi bắt tay xong, race() để phần "chết" thắng
    // ngay lập tức và trả lỗi thay vì đợi hết 15s một cách vô ích.
    let rejectOnDeath;
    this._deathRace = new Promise((_resolve, reject) => { rejectOnDeath = reject; });
    this._rejectOnDeath = rejectOnDeath;
    this.rl = createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => this._onLine(line));
    this.proc.on('exit', (code) => {
      // Tiến trình chết giữa chừng (hiếm, vd. OOM) — huỷ lượt đang chờ thay vì
      // để promise treo vĩnh viễn, không ai gọi resolve/reject nữa.
      this._onDead(new Error(`Pikafish thoát bất ngờ (mã ${code})`));
    });
    // 'error' trên child_process hoặc trên stream stdin của nó KHÔNG có listener
    // nào mặc định trong Node là sự kiện "unhandled" — nếu không bắt ở đây, ghi
    // vào stdin của một tiến trình đã chết (vd. worker bị PikafishPool cấp lại
    // sau khi crash) sẽ ném ra một exception không ai bắt và sập TOÀN BỘ service
    // Node, không chỉ lượt tìm đang lỗi. Xử lý giống hệt 'exit': huỷ lượt đang
    // chờ, đánh dấu worker chết để pool thay worker mới (xem PikafishPool._onWorkerDied/_replace).
    this.proc.on('error', (err) => this._onDead(err));
    this.proc.stdin.on('error', (err) => this._onDead(err));
    return Promise.race([this._handshake(), this._deathRace]);
  }

  _onDead(err) {
    if (!this.alive) return; // đã xử lý rồi (vd. exit rồi tới error trùng lặp) — tránh reject lượt đang chờ hai lần
    this.alive = false;
    if (this.pending) { this.pending.reject(err); this.pending = null; }
    this._rejectOnDeath?.(err); // huỷ start()/_handshake() đang treo nếu tiến trình chết giữa lúc bắt tay
    this.onFatal?.(this, err); // báo cho PikafishPool biết ngay — null nếu đang còn trong start() (xem constructor)
  }

  _send(cmd) { this.proc.stdin.write(cmd + '\n'); }

  _waitFor(token, onStart, timeoutMs = HANDSHAKE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const handler = (line) => {
        if (line.trim() === token) {
          clearTimeout(timer);
          this.rl.off('line', handler);
          resolve();
        }
      };
      // Không có timeout thì một tiến trình Pikafish "treo" trong lúc bắt tay
      // (spawn được nhưng không bao giờ nói "uciok"/"readyok", không crash,
      // không exit) làm promise này treo vĩnh viễn — kéo theo start() treo
      // theo, và với worker thay thế của PikafishPool._replace(), cả một lượt
      // retry-với-backoff treo theo chứ không lùi rồi thử lại như thiết kế.
      // Hết giờ ở đây thì xử lý HỆT như tiến trình chết thật: gọi _onDead() để
      // đi đúng con đường alive=false/_deathRace/onFatal mà crash thật đi qua
      // (xem _onDead bên dưới), rồi tự kill tiến trình treo — khác với crash
      // thật (tiến trình đã tự thoát rồi), ở đây KHÔNG ai khác dọn nó nếu
      // không chủ động kill.
      const timer = setTimeout(() => {
        this.rl.off('line', handler);
        const err = new Error(
          `Pikafish không phản hồi "${token}" trong bắt tay UCI sau ${timeoutMs}ms — tiến trình có thể đã treo.`
        );
        this.stop();
        this._onDead(err);
        reject(err);
      }, timeoutMs);
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
    if (!this.alive) throw new Error('PikafishEngine đã chết (tiến trình con đã thoát), không thể nhận lượt mới.');
    if (this.pending) throw new Error('PikafishEngine đang bận một lượt tìm khác.');
    // fen được nối thẳng vào lệnh UCI văn bản "position fen <fen>" rồi ghi theo
    // dòng vào stdin của tiến trình con. Nếu fen chứa \n/\r, phần sau ký tự
    // xuống dòng sẽ bị Pikafish hiểu là MỘT LỆNH UCI RIÊNG kế tiếp (vd. tiêm
    // thêm "go"/"setoption"/"quit") — tiêm lệnh UCI qua giá trị fen. Từ chối
    // thẳng ở đây thay vì âm thầm lọc bỏ ký tự: dự án này ưu tiên từ chối input
    // sai định dạng hơn là tự sửa rồi tiếp tục chạy với input đã bị biến đổi.
    if (/[\n\r]/.test(fen)) throw new Error('fen không được chứa ký tự xuống dòng.');
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
