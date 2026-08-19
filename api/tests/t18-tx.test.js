import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';

let db;
beforeAll(async () => { db = await resetDb(); });
afterAll(async () => { await db.destroy(); });

describe('T18 withActor đóng dấu người thực hiện', () => {
  it('đặt app.actor_id trong giao dịch', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const got = await withActor(id, async (trx) => {
      const { rows } = await trx.raw(`SELECT current_setting('app.actor_id', true) AS a`);
      return rows[0].a;
    });
    expect(got).toBe(id);
  });

  it('dấu không rò ra ngoài giao dịch', async () => {
    const { knex } = await import('../src/db/knex.js');
    const { rows } = await knex.raw(`SELECT current_setting('app.actor_id', true) AS a`);
    expect(rows[0].a === null || rows[0].a === '').toBe(true);
  });
});
