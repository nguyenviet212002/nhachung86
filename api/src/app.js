import express from 'express';
import { knex } from './db/knex.js';

export function buildApp() {
  const app = express();
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

  return app;
}
