# Sảnh Cờ — Dịch vụ Engine (Pikafish) + Máy đi hộ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng dịch vụ `engine` (Pikafish thật qua UCI, build từ mã nguồn) và nối nó vào Cờ Tướng PvP đang chạy để bật được "máy đi hộ" — hai việc còn thiếu (#5, #6) trong bảng thứ tự dựng của spec Kernel/Engine đã duyệt trước đó.

**Architecture:** Container `engine` mới (Node HTTP server bọc N tiến trình con Pikafish qua UCI, hàng đợi khi cả pool bận) — `api` gọi qua `POST http://engine:8898/bestmove {fen, movetime, multipv}`. `api/src/modules/games/rules.js` có thêm `boardToFen`/`uciMoveToCells` để đổi qua lại giữa bàn cờ nội bộ (`board[r][c]`, r=0 Đen/r=9 Đỏ) và FEN/toạ độ UCI mà Pikafish dùng. `service.js` thêm `setAiLevel()` (bật/tắt máy đi hộ cho đúng bên gọi) và `maybeAutoMove()` (chạy nền sau mỗi nước/khi ván vào trận/khi vừa bật máy — gọi engine, chọn nước theo cấp, rồi áp nước qua **đúng hàm `move()` đang có**, không viết lại luồng áp nước).

**Tech Stack:** Node 20, Express (dịch vụ engine dùng Express y hệt `api` cho nhất quán), Pikafish (GPLv3, build từ mã nguồn), Docker multi-stage build, Vitest + Supertest (phần `api`).

**Spec:** `docs/superpowers/specs/2026-09-07-sanh-co-kernel-engine-design.md` (mục 6 "Engine & máy đi hộ", mục 8 việc #5-#6, mục 9 các quyết định vừa chốt), `BAN_CHUAN_CO_TUONG.md` (mục 4 "Ba cấp máy — cùng 8 giây").

## Global Constraints

- **Toạ độ FEN/UCI đã xác nhận trực tiếp từ mã nguồn Pikafish** (không đoán): chữ quân `RACPNBK`/`racpnbk` (Rook=xe/chariot, Advisor=sĩ, Cannon=pháo, Pawn=tốt/soldier, kNight=mã/horse, Bishop=tượng/elephant, King=tướng/general), hoa=Đỏ, thường=Đen; lượt đi `w`=Đỏ, `b`=Đen; FEN liệt kê hàng trên cùng (Đen, `board[0]`) TRƯỚC, hàng dưới cùng (Đỏ, `board[9]`) SAU; toạ độ ô trong nước đi UCI = chữ cột `'a'+c` (a-i) + số hàng `9-r` (một chữ số, 0-9, KHÔNG phải 1-10 như cờ vua). Mọi hàm đổi toạ độ trong plan này bám đúng quy ước này — sai một trong hai chiều thì nước đi vẫn "hợp lệ trông như đúng" (cùng nằm trong 0-9/a-i) mà thực ra là một ô hoàn toàn khác, rất khó phát hiện bằng mắt.
- **`move()` là đường DUY NHẤT áp một nước đi**, dù người thật hay máy đi hộ gọi — đúng yêu cầu tường minh của spec mục 6 ("áp nước qua đúng hàm `service.move()` đang có — không viết lại luồng áp nước"). `maybeAutoMove()` không tự UPDATE bảng `games`/`game_moves`.
- **Không bao giờ `await` lệnh gọi engine trong một request HTTP của người chơi thật.** `movetime` mặc định 8000ms — chờ nó trong response của `POST /moves` hay `POST /ai-level` sẽ treo màn hình người vừa bấm 8 giây oan. Mọi lời gọi `maybeAutoMove()` từ `service.js` đều `.catch()` và KHÔNG `await`.
- **Dịch vụ `engine` build từ mã nguồn** (không tải binary dựng sẵn) — quyết định đã chốt 2026-09-07 trong spec mục 9, để chắc khớp cờ CPU máy build ra thì chạy đúng trên chính máy đó.
- **Base image của dịch vụ `engine` là Debian (`node:20-bookworm-slim`), không phải Alpine** — dù phần còn lại của dự án dùng Alpine (`api/Dockerfile`). Lý do: Pikafish build bằng glibc (Debian); một binary build glibc đem chạy trên Alpine (musl libc) không tương thích ("illegal instruction"/segfault khi load) — cùng loại bẫy trộn lẫn giả định đã ghi trong `api/Dockerfile` (đoạn chú thích về `wget` trên Alpine). Build VÀ chạy phải cùng một stage/base để tránh lệch libc.
- `ENGINE_POOL_SIZE`/`ENGINE_THREADS`/`ENGINE_HASH_MB` để mặc định nhỏ (1/2/64) cho máy dev — chưa biết cấu hình VPS thật (spec mục 9, còn để ngỏ), chỉnh lại sau.
- Ba cấp máy đi hộ dùng đúng ba mã đã có sẵn trong CHECK constraint của cột `red_ai_level`/`black_ai_level` (migration 057): `'sieu'`, `'thong-minh'`, `'xuat-sac'` — **không cần migration mới cho plan này**, cột đã tồn tại.

---

### Task 1: `boardToFen` + `uciMoveToCells` trong `rules.js`

**Files:**
- Modify: `api/src/modules/games/rules.js`
- Test: `api/tests/t40-chess-rules.test.js`

**Interfaces:**
- Produces: `boardToFen(board, turn) -> string` (FEN đầy đủ, gồm cả lượt/hai gạch ngang/`0 1`), `uciMoveToCells(uciMove: string) -> {from:{r,c}, to:{r,c}}`. Hai hàm này là interface DUY NHẤT các Task sau dùng để nói chuyện với Pikafish — Task 5 gọi cả hai, không tự đổi toạ độ theo cách khác.
- Consumes: không có (thuần hàm, chỉ dùng `board`/`turn` đã có sẵn trong service.js).

- [ ] **Step 1: Viết test cho `boardToFen`**

Thêm vào cuối `api/tests/t40-chess-rules.test.js` (giữ nguyên mọi test hiện có):

```js
describe('T40 boardToFen — chuyển bàn cờ nội bộ sang FEN cho engine', () => {
  it('thế khai cuộc ra đúng FEN chuẩn, lượt Đỏ = "w"', () => {
    const b = rules.initBoard();
    expect(rules.boardToFen(b, 'r')).toBe(
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
    );
  });

  it('lượt Đen ra "b"', () => {
    const b = rules.initBoard();
    expect(rules.boardToFen(b, 'b').split(' ')[1]).toBe('b');
  });

  it('bàn trống chỉ còn hai tướng lẻ loi, đúng ô trống đếm dồn', () => {
    const b = emptyBoard();
    b[9][4] = { side: 'r', type: 'general' };
    b[0][4] = { side: 'b', type: 'general' };
    expect(rules.boardToFen(b, 'r')).toBe('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
  });
});

describe('T40 uciMoveToCells — đổi toạ độ UCI (kiểu "h2e2") sang {from,to}', () => {
  it('khớp đúng chiều: cột "a".."i" = c 0..8, hàng "0".."9" = r 9..0 (ngược)', () => {
    // e0 = tướng Đỏ lúc khởi cuộc (board[9][4]); e1 = một ô lùi về phía Đen một hàng
    expect(rules.uciMoveToCells('e0e1')).toEqual({ from: { r: 9, c: 4 }, to: { r: 8, c: 4 } });
    // a9 = góc trái-trên (xe Đen, board[0][0]); a8 = tiến xuống một hàng
    expect(rules.uciMoveToCells('a9a8')).toEqual({ from: { r: 0, c: 0 }, to: { r: 1, c: 0 } });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ vì thiếu hàm**

Chạy: `cd api && npx vitest run t40-chess-rules -t "boardToFen"`
Kỳ vọng: FAIL — `rules.boardToFen is not a function`.

- [ ] **Step 3: Viết `boardToFen`/`uciMoveToCells` trong `rules.js`**

Thêm vào cuối `api/src/modules/games/rules.js` (sau `detectNoCaptureDraw`):

```js
// Đổi bàn cờ nội bộ + lượt đi sang FEN cho dịch vụ engine (Pikafish qua UCI,
// mục 6 spec Kernel/Engine). Quy ước ĐÃ XÁC NHẬN trực tiếp từ mã nguồn
// Pikafish (uci.cpp UCIEngine::square, position.cpp Position::set): chữ quân
// hoa=Đỏ/thường=Đen theo bảng " RACPNBK racpnbk"; FEN liệt kê hàng TRÊN CÙNG
// (Đen, board[0]) trước, hàng DƯỚI CÙNG (Đỏ, board[9]) sau; lượt 'w'=Đỏ,
// 'b'=Đen. KHÔNG suy diễn quy ước này từ cờ vua hay từ FEN cờ tướng "phổ biến"
// khác — Pikafish tự định nghĩa quy ước riêng, đọc mã của chính nó, đừng đoán.
const PIECE_TO_FEN = {
  general: 'k', advisor: 'a', elephant: 'b', horse: 'n',
  chariot: 'r', cannon: 'c', soldier: 'p',
};
export function boardToFen(board, turn) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let row = '', empty = 0;
    for (let c = 0; c < 9; c++) {
      const p = board[r][c];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      const ch = PIECE_TO_FEN[p.type];
      row += p.side === 'r' ? ch.toUpperCase() : ch;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${turn === 'r' ? 'w' : 'b'} - - 0 1`;
}

// Ngược lại: một nước UCI dạng "h2e2" (ô đi + ô đến, mỗi ô = chữ cột 'a'-'i'
// + MỘT chữ số hàng '0'-'9', KHÔNG phải 2 chữ số) sang {from:{r,c},to:{r,c}}.
// square(s) = 'a'+file, '0'+rank; rank chạy 9 (hàng trên, Đen) xuống 0 (hàng
// dưới, Đỏ) — nghịch đảo trực tiếp của boardToFen ở trên: r = 9 - rank.
function squareToCell(sq) {
  const c = sq.charCodeAt(0) - 97; // 'a' -> 0
  const r = 9 - Number(sq[1]);
  return { r, c };
}
export function uciMoveToCells(uciMove) {
  return { from: squareToCell(uciMove.slice(0, 2)), to: squareToCell(uciMove.slice(2, 4)) };
}
```

- [ ] **Step 4: Chạy lại test, xác nhận xanh**

Chạy: `cd api && npx vitest run t40-chess-rules`
Kỳ vọng: PASS — toàn bộ file (test cũ lẫn mới).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/games/rules.js api/tests/t40-chess-rules.test.js
git commit -m "feat(cotuong): boardToFen/uciMoveToCells — cầu nối toạ độ với Pikafish"
```

---

### Task 2: Dịch vụ `engine` — Pikafish qua UCI, Docker, docker-compose

**Files:**
- Create: `engine/Dockerfile`
- Create: `engine/package.json`
- Create: `engine/uci.js`
- Create: `engine/pool.js`
- Create: `engine/server.js`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: `POST /bestmove {fen, movetime, multipv}` → `{bestmove, score_cp, mate, depth, pv, lines}` (`lines` = mảng `{move, score_cp, mate, depth, pv}` theo đúng thứ hạng multipv 1..N; ba trường đầu ở gốc đối tượng lặp lại `lines[0]` — tiện cho phía gọi chỉ cần multipv=1). `GET /health` → `{ok, engine:"pikafish"}`. Đây là hợp đồng Task 3 (`engineClient.js`) gọi vào.
- Consumes: không có (Task này độc lập, không cần Task 1 xong trước — làm song song được, đúng mục 8 spec).

Không có test tự động cho Task này (build Docker thật + chạy một tiến trình con C++) — xác nhận bằng chạy thật, giống cách Task xác minh Docker trước đây trong dự án (build --no-cache, curl kiểm response).

- [ ] **Step 1: `engine/package.json`**

```json
{
  "name": "nhachung-engine",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.19.2" }
}
```

- [ ] **Step 2: `engine/uci.js` — bọc một tiến trình Pikafish qua UCI**

```js
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
```

- [ ] **Step 3: `engine/pool.js` — hàng đợi N tiến trình**

```js
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
```

- [ ] **Step 4: `engine/server.js` — HTTP layer**

```js
import express from 'express';
import { PikafishPool } from './pool.js';

const PORT = Number(process.env.PORT || 8898);
const POOL_SIZE = Number(process.env.ENGINE_POOL_SIZE || 1);
const THREADS = Number(process.env.ENGINE_THREADS || 2);
const HASH_MB = Number(process.env.ENGINE_HASH_MB || 64);
const BIN_PATH = process.env.PIKAFISH_BIN || './engine-bin/pikafish';
const NNUE_PATH = process.env.PIKAFISH_NNUE || './engine-bin/pikafish.nnue';

const pool = new PikafishPool({ size: POOL_SIZE, binPath: BIN_PATH, nnuePath: NNUE_PATH, threads: THREADS, hashMb: HASH_MB });
let started = false;

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: started, engine: 'pikafish' }));

app.post('/bestmove', async (req, res) => {
  if (!started) return res.status(503).json({ error: 'engine chưa sẵn sàng' });
  const { fen, movetime, multipv } = req.body || {};
  if (typeof fen !== 'string' || !fen) return res.status(422).json({ error: 'thiếu fen' });
  const mt = Number.isFinite(movetime) ? movetime : 8000;
  const mpv = Number.isFinite(multipv) ? multipv : 1;
  try {
    res.json(await pool.bestMove({ fen, movetime: mt, multipv: mpv }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

pool.start()
  .then(() => { started = true; console.log(`engine sẵn sàng — pool=${POOL_SIZE} threads=${THREADS}`); })
  .catch((e) => { console.error('engine không khởi động được:', e); process.exit(1); });

app.listen(PORT, () => console.log(`engine lắng nghe cổng ${PORT}`));
```

- [ ] **Step 5: `engine/Dockerfile` — build Pikafish từ mã nguồn**

```dockerfile
# Cả hai stage dùng CHUNG một base (node:20-bookworm-slim, Debian/glibc) —
# KHÔNG đổi sang Alpine ở stage runtime. Pikafish build bằng glibc; đem chạy
# trên Alpine (musl libc) là lệch libc giữa lúc build và lúc chạy, binary sẽ
# không tương thích. Xem Global Constraints của plan này.

FROM node:20-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 https://github.com/official-pikafish/Pikafish.git .
WORKDIR /src/src
# ARCH=native: build tối ưu đúng CPU của MÁY ĐANG BUILD image này — vì
# `docker compose up -d --build` chạy build NGAY TRÊN máy sẽ chạy container
# (dev hoặc VPS thật), đây chính là máy sẽ chạy binary, nên "native" ở đây
# đúng nghĩa "đúng máy đích", không phải giả định sai như build sẵn rồi tải về.
RUN make -j"$(nproc)" build ARCH=native COMP=gcc
RUN make net
# Xác nhận thật tên tệp nhị phân sinh ra (kỳ vọng "pikafish") — đọc log bước
# này khi build lần đầu, đừng tin tên biến EXE trong Makefile mà không soi lại.
RUN ls -la .

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js pool.js uci.js ./
COPY --from=build /src/src/pikafish ./engine-bin/pikafish
COPY --from=build /src/src/pikafish.nnue ./engine-bin/pikafish.nnue
RUN chmod +x ./engine-bin/pikafish
ENV PIKAFISH_BIN=/app/engine-bin/pikafish
ENV PIKAFISH_NNUE=/app/engine-bin/pikafish.nnue
EXPOSE 8898
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD node -e "fetch('http://localhost:8898/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
```

- [ ] **Step 6: Thêm service `engine` vào `docker-compose.yml`**

Chèn khối này vào `docker-compose.yml`, ngay trước service `storage:` (tức là ngay sau service `api:`, đúng thứ tự các service đang có trong file: `db`, `api`, `storage`, `proxy`, ...), và thêm `engine: { condition: service_started }` vào `depends_on:` của service `api:` — **không** khai `ports:` (chỉ `api` gọi qua tên service nội bộ, giống MinIO chỉ lộ qua `proxy`):

```yaml
  engine:
    build: ./engine
    restart: unless-stopped
    environment:
      ENGINE_POOL_SIZE: ${ENGINE_POOL_SIZE:-1}
      ENGINE_THREADS: ${ENGINE_THREADS:-2}
      ENGINE_HASH_MB: ${ENGINE_HASH_MB:-64}
    networks: [nhachung_net]
```

Trong service `api:`, sửa khối `depends_on:` từ:
```yaml
    depends_on:
      db: { condition: service_healthy }
      storage: { condition: service_started }
```
thành:
```yaml
    depends_on:
      db: { condition: service_healthy }
      storage: { condition: service_started }
      engine: { condition: service_started }
```

Và thêm biến `ENGINE_URL` vào khối `environment:` của service `api:` (cạnh `CORS_ORIGIN`):
```yaml
      ENGINE_URL: http://engine:8898
```

- [ ] **Step 7: Thêm dòng mẫu vào `.env.example`**

Thêm cạnh khối `CORS_ORIGIN`/`SITE_DOMAIN`:
```
# Kich thuoc pool va cau hinh Pikafish trong dich vu engine (mac dinh nho cho
# may dev — chua biet cau hinh VPS that, xem spec Kernel/Engine muc 9).
ENGINE_POOL_SIZE=1
ENGINE_THREADS=2
ENGINE_HASH_MB=64
```

- [ ] **Step 8: Build và xác nhận thật bằng Docker**

```bash
docker compose build engine
docker compose up -d engine
docker compose ps engine   # kỳ vọng: healthy, sau tối đa ~15s (health interval)
curl -s http://localhost:8898/health 2>&1 || echo "engine không lộ cổng ra ngoài — đúng thiết kế, kiểm qua exec thay vì curl từ host"
docker compose exec engine node -e "fetch('http://localhost:8898/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"
# Kỳ vọng: {"ok":true,"engine":"pikafish"}

docker compose exec engine node -e "
fetch('http://localhost:8898/bestmove',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({fen:'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',movetime:2000,multipv:3})})
  .then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
# Kỳ vọng: {"bestmove":"...", "score_cp": <số>, "mate":null, "depth":<số>, "pv":[...], "lines":[{...},{...},{...}]}
# — bestmove và lines[0].move phải là MỘT nước hợp lệ của Đỏ ở thế khai cuộc
# (vd. "h2e2", "h2g2", "c3c4", ...). movetime rút xuống 2000ms chỉ để việc
# xác nhận nhanh hơn khi build tay — service.js thật gọi movetime=8000.
```

Nếu bước build lỗi ("illegal instruction" khi Pikafish tự chạy trong lúc `make build`, hoặc lỗi biên dịch musl) — dừng lại, đọc kỹ thông báo lỗi (đừng đổi mù ARCH sang giá trị khác mà không hiểu vì sao), đối chiếu README/Makefile thật của repo Pikafish tại thời điểm dựng (có thể đã đổi so với lúc viết plan này).

- [ ] **Step 9: Commit**

```bash
git add engine/ docker-compose.yml .env.example
git commit -m "feat(cotuong): dịch vụ engine — Pikafish thật qua UCI, build từ mã nguồn"
```

---

### Task 3: `engineClient.js` phía `api` — gọi dịch vụ engine

**Files:**
- Modify: `api/src/config/index.js`
- Create: `api/src/modules/games/engineClient.js`
- Create: `api/tests/t44-engine-client.test.js`

**Interfaces:**
- Consumes: `config.ENGINE_URL` (mới, Task này thêm).
- Produces: `bestMove({fen, movetime, multipv}) -> Promise<{bestmove, score_cp, mate, depth, pv, lines}>` — Task 5 gọi hàm này (qua `import * as engineClient from './engineClient.js'`, KHÔNG gọi `fetch` trực tiếp — giữ một chỗ duy nhất biết địa chỉ/hình dạng lỗi của dịch vụ engine, và để mock được trong test).

- [ ] **Step 1: Thêm `ENGINE_URL` vào schema cấu hình**

Trong `api/src/config/index.js`, thêm dòng sau `CORS_ORIGIN: z.string().default('http://localhost'),`:

```js
  // Dịch vụ engine (Pikafish qua UCI, mục 6 spec Kernel/Engine). Mặc định
  // đúng tên service trong docker-compose.yml — máy dev/production chạy qua
  // compose không cần đặt lại biến này.
  ENGINE_URL: z.string().url().default('http://engine:8898'),
```

- [ ] **Step 2: Viết test cho `engineClient.bestMove`**

`api/tests/t44-engine-client.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as engineClient from '../src/modules/games/engineClient.js';

describe('T44 engineClient.bestMove', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('gửi đúng fen/movetime/multipv tới /bestmove, trả nguyên JSON khi engine trả 200', async () => {
    const fake = { bestmove: 'h2e2', score_cp: 20, mate: null, depth: 12, pv: ['h2e2'], lines: [] };
    const fenIn = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => fake });

    const result = await engineClient.bestMove({ fen: fenIn, movetime: 8000, multipv: 3 });

    expect(result).toEqual(fake);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('/bestmove');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ fen: fenIn, movetime: 8000, multipv: 3 });
  });

  it('engine trả lỗi HTTP thì ném lỗi có kèm mã trạng thái', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'bận' }) });
    await expect(engineClient.bestMove({ fen: 'x', movetime: 1000, multipv: 1 })).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận đỏ**

Chạy: `cd api && npx vitest run t44-engine-client`
Kỳ vọng: FAIL — không tìm thấy module `engineClient.js`.

- [ ] **Step 4: Viết `api/src/modules/games/engineClient.js`**

```js
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
```

- [ ] **Step 5: Chạy lại test, xác nhận xanh**

Chạy: `cd api && npx vitest run t44-engine-client`
Kỳ vọng: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/config/index.js api/src/modules/games/engineClient.js api/tests/t44-engine-client.test.js
git commit -m "feat(cotuong): engineClient — cầu nối api sang dịch vụ engine"
```

---

### Task 4: `selectAiMove` — chọn nước theo cấp máy đi hộ

**Files:**
- Create: `api/src/modules/games/aiSelect.js`
- Create: `api/tests/t45-ai-select.test.js`

**Interfaces:**
- Consumes: mảng `lines` đúng hình dạng `engineClient.bestMove()`/dịch vụ engine trả về (`{move, score_cp, mate, depth, pv}[]`).
- Produces: `selectAiMove(lines, level, rng = Math.random) -> string | null` (một nước UCI như `"h2e2"`, hoặc `null` nếu `lines` rỗng). Task 5 gọi hàm này rồi đưa kết quả qua `rules.uciMoveToCells()` (Task 1).

- [ ] **Step 1: Viết test cho `selectAiMove`**

`api/tests/t45-ai-select.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { selectAiMove } from '../src/modules/games/aiSelect.js';

const line = (move, score_cp, mate = null) => ({ move, score_cp, mate, depth: 20, pv: [move] });

describe('T45 selectAiMove — ba cấp máy đi hộ (BAN_CHUAN_CO_TUONG.md mục 4)', () => {
  it('Siêu thông minh luôn chọn nước tốt nhất, chênh 0', () => {
    const lines = [line('a', 100), line('b', 90), line('c', 50)];
    expect(selectAiMove(lines, 'sieu', () => 0.99)).toBe('a');
    expect(selectAiMove(lines, 'sieu', () => 0)).toBe('a');
  });

  it('Thông minh chỉ chọn trong 2 nước đầu, chênh tối đa 40 điểm', () => {
    // b trong top-2 và chênh 35 (<=40) -> hợp lệ. c chênh 90 VÀ đứng ngoài
    // top-2 -> loại kép, không được chọn dù rng luôn ra giá trị lớn nhất.
    const lines = [line('a', 100), line('b', 65), line('c', 10)];
    expect(selectAiMove(lines, 'thong-minh', () => 0)).toBe('a');
    expect(selectAiMove(lines, 'thong-minh', () => 0.999)).toBe('b');
  });

  it('Xuất sắc chọn trong 3 nước đầu, chênh tối đa 120 điểm — nước thứ 4 luôn bị loại', () => {
    const lines = [line('a', 100), line('b', 20), line('c', -10), line('d', -1000)];
    for (const rngVal of [0, 0.33, 0.66, 0.99]) {
      expect(selectAiMove(lines, 'xuat-sac', () => rngVal)).not.toBe('d');
    }
  });

  it('chiếu bí quy về thang so được với score_cp — càng ít nước chiếu bí càng tốt hơn mọi cp', () => {
    const lines = [line('cp-cao', 900, null), line('mate-1', null, 1)];
    expect(selectAiMove(lines, 'sieu', () => 0)).toBe('mate-1');
  });

  it('sắp bị chiếu bí luôn xếp cuối, dù nước khác chỉ cp âm nhẹ', () => {
    const lines = [line('cp-am-nhe', -50, null), line('sap-thua', null, -1)];
    expect(selectAiMove(lines, 'sieu', () => 0)).toBe('cp-am-nhe');
  });

  it('danh sách rỗng trả về null', () => {
    expect(selectAiMove([], 'sieu')).toBeNull();
  });

  it('cấp không hợp lệ ném lỗi', () => {
    expect(() => selectAiMove([line('a', 0)], 'khong-ton-tai')).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Chạy: `cd api && npx vitest run t45-ai-select`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Step 3: Viết `api/src/modules/games/aiSelect.js`**

```js
// Chọn 1 nước trong danh sách multipv theo cấp máy đi hộ (BAN_CHUAN_CO_TUONG.md
// mục 4: "Engine tìm ba nước hay nhất... Cấp độ khác nhau ở chọn nước nào,
// không ở thời gian"). Thuần hàm — không gọi engine/CSDL — kiểm bằng dữ liệu
// bịa được ngay, không cần Pikafish thật.
const LEVELS = {
  sieu: { topN: 1, threshold: 0 },
  'thong-minh': { topN: 2, threshold: 40 },
  'xuat-sac': { topN: 3, threshold: 120 },
};

// Quy điểm chiếu bí về một thang so được với score_cp: càng ít nước tới chiếu
// bí (mate dương) càng TỐT hơn bất kỳ score_cp nào; càng ít nước tới bị chiếu
// bí (mate âm) càng TỆ hơn bất kỳ score_cp nào. 100_000 đủ lớn để không đụng
// score_cp thật (Pikafish score_cp hiếm khi vượt vài nghìn).
function effectiveScore(line) {
  if (line.mate == null) return line.score_cp;
  return line.mate > 0 ? 100_000 - line.mate : -100_000 - line.mate;
}

export function selectAiMove(lines, level, rng = Math.random) {
  if (!lines.length) return null;
  const cfg = LEVELS[level];
  if (!cfg) throw new Error(`Cấp máy đi hộ không hợp lệ: ${level}`);
  const sorted = [...lines].sort((a, b) => effectiveScore(b) - effectiveScore(a));
  const bestScore = effectiveScore(sorted[0]);
  const pool = sorted.slice(0, cfg.topN).filter((l) => bestScore - effectiveScore(l) <= cfg.threshold);
  return pool[Math.floor(rng() * pool.length)].move;
}
```

- [ ] **Step 4: Chạy lại test, xác nhận xanh**

Chạy: `cd api && npx vitest run t45-ai-select`
Kỳ vọng: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/games/aiSelect.js api/tests/t45-ai-select.test.js
git commit -m "feat(cotuong): selectAiMove — ba cấp máy đi hộ theo BAN_CHUAN_CO_TUONG.md"
```

---

### Task 5: Nối vào `service.js` — bật/tắt máy đi hộ, tự động đi

**Files:**
- Modify: `api/src/modules/games/schema.js`
- Modify: `api/src/modules/games/routes.js`
- Modify: `api/src/modules/games/service.js`
- Create: `api/tests/t46-ai-auto-move.test.js`

**Interfaces:**
- Consumes: `rules.boardToFen`/`rules.uciMoveToCells` (Task 1), `engineClient.bestMove` (Task 3), `selectAiMove` (Task 4), hàm `move()` đã có sẵn trong chính `service.js`.
- Produces: `POST /games/:id/ai-level {level}` (route mới), `setAiLevel({actor,id,level})`, `maybeAutoMove({communityId,gameId})` (export để test gọi trực tiếp khi cần, nhưng mọi nơi trong `service.js` gọi nó đều KHÔNG `await`).

- [ ] **Step 1: Thêm schema cho route mới**

Trong `api/src/modules/games/schema.js`, thêm sau `joinRoomSchema`:

```js
export const aiLevelSchema = z.object({ level: z.enum(['sieu', 'thong-minh', 'xuat-sac']).nullable() });
```

- [ ] **Step 2: Thêm route**

Trong `api/src/modules/games/routes.js`, thêm sau route `/:id/disconnect-timeout` (cuối file, trước dòng trống cuối):

```js
router.post('/:id/ai-level', validate(schema.idParamSchema, 'params'), requireAuthOrGuestToken, validate(schema.aiLevelSchema), async (req, res, next) => {
  try { res.json(await service.setAiLevel({ actor: req.actor, id: req.params.id, level: req.body.level })); }
  catch (e) { next(e); }
});
```

- [ ] **Step 3: Viết test tích hợp (mock `engineClient`)**

`api/tests/t46-ai-auto-move.test.js`:

```js
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import supertest from 'supertest';
import { resetDb } from './helpers/db.js';
import { buildApp } from '../src/app.js';
import { config } from '../src/config/index.js';

vi.mock('../src/modules/games/engineClient.js', () => ({ bestMove: vi.fn() }));
import * as engineClient from '../src/modules/games/engineClient.js';

let db, app, cid, alice, aliceToken, bob, bobToken;
const auth = (token) => ({ authorization: `Bearer ${token}` });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = await resetDb();
  app = buildApp();
  const { rows: [community] } = await db.raw(`INSERT INTO communities (code, name) VALUES ('t46-ai', 'T46 AI') RETURNING id`);
  cid = community.id;
  const { rows: [a] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Alice T46', 'member') RETURNING id`, [cid]);
  alice = a.id;
  aliceToken = jwt.sign({ sub: alice, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
  const { rows: [b] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Bob T46', 'member') RETURNING id`, [cid]);
  bob = b.id;
  bobToken = jwt.sign({ sub: bob, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
});
afterAll(async () => { await db.destroy(); });

describe('T46 máy đi hộ — tự động đi khi tới lượt bên đã bật', () => {
  it('bật AI cho Đỏ đúng lúc đang là lượt Đỏ: gọi engine multipv=3, tự áp đúng 1 nước', async () => {
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'h2e2', score_cp: 20, mate: null, depth: 10, pv: ['h2e2'],
      lines: [{ move: 'h2e2', score_cp: 20, mate: null, depth: 10, pv: ['h2e2'] }],
    });
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);

    await supertest(app).post(`/api/v1/games/${challenge.body.id}/ai-level`).set(auth(aliceToken))
      .send({ level: 'sieu' }).expect(200);
    await wait(150);

    expect(engineClient.bestMove).toHaveBeenCalledWith(expect.objectContaining({ movetime: 8000, multipv: 3 }));
    const detail = await supertest(app).get(`/api/v1/games/${challenge.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.turn).toBe('b');
    expect(detail.body.moves).toHaveLength(1);
    // h2e2 -> pháo Đỏ (7,7) sang (7,4), đúng nước khai cuộc kinh điển "pháo 2 bình 5"
    expect(detail.body.moves[0]).toMatchObject({ from_r: 7, from_c: 7, to_r: 7, to_c: 4, side: 'r' });
  });

  it('tắt máy (level=null) thì không tự đi nữa', async () => {
    engineClient.bestMove.mockClear();
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/ai-level`).set(auth(aliceToken))
      .send({ level: null }).expect(200);
    await wait(150);
    expect(engineClient.bestMove).not.toHaveBeenCalled();
  });

  it('người ngoài ván không bật được máy đi hộ (403)', async () => {
    const { rows: [c] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?, 'Carol T46', 'member') RETURNING id`, [cid]);
    const carolToken = jwt.sign({ sub: c.id, cid, typ: 'access' }, config.JWT_SECRET, { expiresIn: '15m' });
    const challenge = await supertest(app).post('/api/v1/games/challenges').set(auth(aliceToken))
      .send({ opponent_member_id: bob }).expect(201);
    await supertest(app).post(`/api/v1/games/challenges/${challenge.body.id}/accept`).set(auth(bobToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${challenge.body.id}/ai-level`).set(auth(carolToken))
      .send({ level: 'sieu' }).expect(403);
  });

  it('bật AI cho Đen (khách qua link mời) rồi Đỏ đi 1 nước — máy tự đáp lễ đúng phe Đen', async () => {
    engineClient.bestMove.mockClear();
    engineClient.bestMove.mockResolvedValue({
      bestmove: 'h9g7', score_cp: -10, mate: null, depth: 10, pv: ['h9g7'],
      lines: [{ move: 'h9g7', score_cp: -10, mate: null, depth: 10, pv: ['h9g7'] }],
    });
    const room = await supertest(app).post('/api/v1/games/rooms').set(auth(aliceToken)).expect(201);
    const joined = await supertest(app).post(`/api/v1/games/rooms/${room.body.invite_token}/join`)
      .send({ guest_name: 'Khách T46' }).expect(201);
    await supertest(app).post(`/api/v1/games/${room.body.id}/ai-level`).set(auth(joined.body.guest_token))
      .send({ level: 'sieu' }).expect(200);
    await supertest(app).post(`/api/v1/games/${room.body.id}/ready`).set(auth(aliceToken)).expect(200);
    await supertest(app).post(`/api/v1/games/${room.body.id}/ready`).set(auth(joined.body.guest_token)).expect(200);

    await supertest(app).post(`/api/v1/games/${room.body.id}/moves`).set(auth(aliceToken))
      .send({ from: { r: 6, c: 0 }, to: { r: 5, c: 0 } }).expect(200);
    await wait(150);

    const detail = await supertest(app).get(`/api/v1/games/${room.body.id}`).set(auth(aliceToken)).expect(200);
    expect(detail.body.moves).toHaveLength(2);
    expect(detail.body.moves[1]).toMatchObject({ side: 'b' });
    expect(detail.body.turn).toBe('r');
  });
});
```

- [ ] **Step 4: Chạy test, xác nhận đỏ**

Chạy: `cd api && npx vitest run t46-ai-auto-move`
Kỳ vọng: FAIL — `service.setAiLevel is not a function` / route `/ai-level` trả 404.

- [ ] **Step 5: Viết `setAiLevel` + `maybeAutoMove`, nối vào các điểm kích hoạt**

Trong `api/src/modules/games/service.js`:

Thêm import ở đầu file (sau `import * as rules from './rules.js';`):

```js
import * as engineClient from './engineClient.js';
import { selectAiMove } from './aiSelect.js';
```

Thêm hai hàm mới vào cuối file:

```js
export async function setAiLevel({ actor, id, level }) {
  await withActor(actor.id, async (trx) => {
    const game = await loadGame(trx, actor.communityId, id);
    const mySide = resolveSide(actor, game);
    if (!mySide) throw FORBIDDEN('Bạn không phải người chơi trong ván này.');
    if (game.status === 'finished') throw INVALID_STATE('Ván cờ này đã kết thúc.');
    const col = mySide === 'r' ? 'red_ai_level' : 'black_ai_level';
    await trx.raw(`UPDATE games SET ?? = ? WHERE id = ?`, [col, level, id]);
    await auditLog(trx, { communityId: actor.communityId, actorId: actor.id,
      action: 'chess_game.ai_level_set', targetType: 'game', targetId: id, detail: { side: mySide, level } });
  });
  // Vừa bật máy đúng lúc đang là lượt của chính bên đó (vd. giữa ván, tự bật
  // máy đi hộ thay mình) — không có nước đi nào sắp xảy ra để làm điểm kích
  // hoạt, nên phải tự kích hoạt ở đây. Không await — xem Global Constraints.
  maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
  return { ok: true, level };
}

// Tự động đi hộ khi tới lượt bên đang bật "máy đi hộ" (mục 6 spec Kernel/
// Engine). Gọi ở CUỐI move()/ready()/acceptChallenge() — bất cứ chỗ nào có
// thể trao lượt cho một bên đã bật máy — và bên trong chính setAiLevel() cho
// trường hợp bật đúng lúc đã là lượt mình. An toàn gọi thừa: nếu game không
// 'active' hoặc bên đang cầm lượt chưa bật máy thì no-op ngay, không gọi engine.
//
// KHÔNG await ở nơi gọi (movetime mặc định 8000ms — xem Global Constraints).
// Áp nước qua ĐÚNG service.move() đang có, không viết lại luồng áp nước —
// nghĩa là mọi kiểm tra/luật/thông báo/SSE của move() cũng chạy y hệt một
// nước người thật đi, kể cả việc move() tự gọi lại maybeAutoMove() ở cuối cho
// LƯỢT KẾ TIẾP — đây là cách hai bên cùng bật máy tự đấu với nhau (không cấm,
// xem Global Constraints/ghi chú thiết kế).
export async function maybeAutoMove({ communityId, gameId }) {
  const game = await withActor(null, (trx) => loadGame(trx, communityId, gameId));
  if (game.status !== 'active') return;
  const side = game.turn;
  const level = side === 'r' ? game.red_ai_level : game.black_ai_level;
  if (!level) return;

  const fen = rules.boardToFen(game.board, game.turn);
  const { lines } = await engineClient.bestMove({ fen, movetime: 8000, multipv: 3 });
  if (!lines || !lines.length) return;
  const chosenUci = selectAiMove(lines, level);
  if (!chosenUci) return;
  const { from, to } = rules.uciMoveToCells(chosenUci);

  const actor = side === 'r'
    ? { id: game.red_member_id, communityId, guestToken: null }
    : { id: game.black_member_id ?? null, communityId, guestToken: game.black_member_id ? null : game.black_guest_token };

  await move({ actor, id: gameId, from, to });
}
```

Sửa `move()` — cuối hàm, thêm 1 dòng trước `return`:

```js
  publishToGame(id, 'move', { board: result.board, turn: result.turn, last_move: { from, to },
    captured: result.captured ? result.captured.type : null });
  if (result.gameOver) publishToGame(id, 'game_end', { winner: result.winner, reason: result.reason });
  if (result.notification) publishToMember(result.opponentId, 'notification', result.notification);
  if (!result.gameOver) maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
  return { board: result.board, turn: result.turn, status: result.gameOver ? 'finished' : 'active' };
```

Sửa `ready()` — thay dòng `if (result.becameActive) publishToGame(id, 'game_start', { turn: 'r' });`:

```js
  if (result.becameActive) {
    publishToGame(id, 'game_start', { turn: 'r' });
    maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
  }
```

Sửa `acceptChallenge()` — cuối hàm, thêm 1 dòng trước `return`:

```js
  publishToGame(id, 'game_start', { board: result.board, turn: 'r' });
  publishToMember(result.redMemberId, 'notification', result.notification);
  maybeAutoMove({ communityId: actor.communityId, gameId: id }).catch((e) => console.error('maybeAutoMove lỗi:', e));
  return { id, status: 'active' };
```

- [ ] **Step 6: Chạy lại test, xác nhận xanh**

Chạy: `cd api && npx vitest run t46-ai-auto-move`
Kỳ vọng: PASS — cả 4 test.

- [ ] **Step 7: Chạy toàn bộ suite `games`, xác nhận không hồi quy**

Chạy: `cd api && npx vitest run t40-chess-rules t41-games-api t42-games-rooms t44-engine-client t45-ai-select t46-ai-auto-move`
Kỳ vọng: PASS toàn bộ.

- [ ] **Step 8: Commit**

```bash
git add api/src/modules/games/schema.js api/src/modules/games/routes.js api/src/modules/games/service.js api/tests/t46-ai-auto-move.test.js
git commit -m "feat(cotuong): setAiLevel + maybeAutoMove — nối máy đi hộ vào ván thật"
```

---

## Sau khi cả 5 Task xong

Chạy toàn bộ suite (`cd api && npx vitest run`) để xác nhận không hồi quy phần còn lại của dự án, so với baseline đã biết (550 pass / 40 fail có từ trước, không liên quan tới nhánh này).

Việc này khép lại mục #5-#6 của bảng "Thứ tự dựng" trong spec Kernel/Engine. Còn lại của mục 8: "nhịp theo đối thủ" (tinh chỉnh thời gian hiện nước) đã được chính spec đó ghi rõ là để dành sub-project sau — **không** thuộc phạm vi plan này.
