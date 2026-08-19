import express from 'express';
import { knex } from './db/knex.js';
import { httpLogger } from './middleware/httpLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { router as authRouter } from './modules/auth/routes.js';

export function buildApp() {
  const app = express();

  // Phát hiện soát xét (Important, vòng sửa 1): trước đây không middleware nào
  // gắn `req.log`, nên mọi lời gọi req.log?.fatal/error trong errorHandler là
  // no-op im lặng — kể cả cảnh báo 42501 (permission denied), đúng sự kiện mà
  // toàn bộ kiến trúc này dựng ra để phát hiện. Gắn pino-http thật ở đây.
  // Cấu hình (level, redact, serializer lỗi an toàn) nằm ở middleware/httpLogger.js
  // — xem comment ở đó về vì sao serializer lỗi phải là DANH SÁCH CHO PHÉP
  // (vòng sửa 2: default serializer của pino-http từng làm lộ err.detail —
  // đúng chỗ PostgreSQL in giá trị cột thật, vd. số điện thoại — ra log).
  app.use(httpLogger());

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

  app.use('/api/v1/auth', authRouter);

  app.use(errorHandler);

  return app;
}
