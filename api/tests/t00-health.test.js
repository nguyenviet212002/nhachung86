import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { resetDb } from './helpers/db.js';

describe('T00 health', () => {
  let owner;
  beforeAll(async () => { owner = await resetDb(); });
  afterAll(async () => { await owner.destroy(); });

  it('trả 200 và ok=true khi DB sống', async () => {
    const res = await request(buildApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // Ruling T1-a: migration phải phản ánh sự thật đọc từ knex_migrations,
  // không được cứng 'applied' — nếu app_role thiếu quyền SELECT trên
  // knex_migrations hoặc bảng không tồn tại, field này phải là null, không đoán.
  it('migration phản ánh đúng số lượng và tên migration đã áp dụng thật', async () => {
    const res = await request(buildApp()).get('/api/v1/health');
    expect(res.body.migration).not.toBeNull();
    expect(res.body.migration.applied).toBeGreaterThanOrEqual(3);
    expect(res.body.migration.latest).toMatch(/^003_communities_areas\.js$/);
  });
});
