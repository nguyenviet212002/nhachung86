import express from 'express';
import { knex } from './db/knex.js';

export function buildApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (req, res) => {
    let db = false;
    try { await knex.raw('select 1'); db = true; } catch { db = false; }
    res.status(db ? 200 : 503).json({ ok: db, db, migration: 'applied' });
  });

  return app;
}
