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
  // Giá trị không dương gửi thẳng xuống UCI ("go movetime 0"/"setoption ... value -1")
  // là hành vi không xác định phía Pikafish — chặn sớm trước khi tới subprocess.
  if (mt <= 0) return res.status(422).json({ error: 'movetime phải > 0' });
  if (mpv <= 0) return res.status(422).json({ error: 'multipv phải > 0' });
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
