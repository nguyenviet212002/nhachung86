import express from 'express';
import pinoHttp from 'pino-http';
import { knex } from './db/knex.js';
import { config } from './config/index.js';
import { errorHandler } from './middleware/errorHandler.js';

export function buildApp() {
  const app = express();

  // Phát hiện soát xét (Important, vòng sửa 1): trước đây không middleware nào
  // gắn `req.log`, nên mọi lời gọi req.log?.fatal/error trong errorHandler là
  // no-op im lặng — kể cả cảnh báo 42501 (permission denied), đúng sự kiện mà
  // toàn bộ kiến trúc này dựng ra để phát hiện. Gắn pino-http thật ở đây.
  // - level đọc từ config.LOG_LEVEL; .env.test đặt LOG_LEVEL=silent nên không
  //   làm nhiễu output test.
  // - redact chặn header authorization/cookie và thân request lọt vào log —
  //   dữ liệu cá nhân không được ghi nhật ký (luật cứng của dự án).
  app.use(pinoHttp({
    level: config.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body', 'res.headers["set-cookie"]'],
      remove: true,
    },
  }));

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (req, res) => {
    let db = false;
    try { await knex.raw('select 1'); db = true; } catch { db = false; }

    // Ruling T1-a: KHÔNG được đoán hay mặc định lạc quan cho trạng thái migration.
    // Đọc thật từ bảng knex_migrations; nếu không đọc được (bảng chưa tồn tại,
    // thiếu quyền, DB chết, ...) thì trả null — im lặng còn hơn nói dối.
    let migration = null;
    if (db) {
      try {
        const { rows: countRows } = await knex.raw(
          'SELECT count(*)::int AS applied FROM knex_migrations'
        );
        const { rows: latestRows } = await knex.raw(
          'SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1'
        );
        migration = {
          applied: countRows[0].applied,
          latest: latestRows[0]?.name ?? null,
        };
      } catch {
        migration = null;
      }
    }

    res.status(db ? 200 : 503).json({ ok: db, db, migration });
  });

  app.use(errorHandler);

  return app;
}
