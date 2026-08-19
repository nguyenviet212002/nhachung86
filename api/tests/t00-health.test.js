import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { resetDb, ownerKnex } from './helpers/db.js';

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

  // Phát hiện soát xét (Important): các test trước chỉ phủ nhánh "đọc được".
  // Ruling T1-a đòi nhánh quan trọng hơn — "không đọc được thì null, không
  // đoán, không lạc quan". Bài này tự tay REVOKE quyền SELECT của app_role
  // trên knex_migrations để ép nhánh catch() trong app.js thật sự chạy, rồi
  // cấp lại quyền ở finally để không làm hỏng các bài chạy sau.
  it('migration = null khi app_role không đọc được knex_migrations (không đoán)', async () => {
    const owner = ownerKnex();
    try {
      await owner.raw('REVOKE SELECT ON knex_migrations FROM app_role');

      const res = await request(buildApp()).get('/api/v1/health');

      // Kết nối DB vẫn sống bình thường — chỉ riêng việc đọc knex_migrations thất bại.
      expect(res.body.ok).toBe(true);
      expect(res.body.migration).toBeNull();
    } finally {
      await owner.raw('GRANT SELECT ON knex_migrations TO app_role');
      await owner.destroy();
    }
  });
});
