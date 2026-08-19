import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { resetDb, ownerKnex } from './helpers/db.js';

// Vòng soát xét 1 (Minor, nhưng cắn nhiều task nếu để nguyên): trước đây bài
// dưới đây cứng tên file migration mới nhất ('007_audit_log.js') — mọi task
// sau còn thêm migration đều phải sửa lại dòng đó dù chẳng liên quan gì tới
// nội dung task, và một bài test phải sửa vì lý do không liên quan là bài
// test sẽ bị sửa cho xong chuyện chứ không được xem lại kỹ. Đọc động danh
// sách migration THẬT từ đĩa (cùng thư mục knex đọc khi migrate) thay vì
// đoán/cứng tên — bài test vẫn khẳng định đúng thứ /health báo cáo khớp sự
// thật, mà không ai phải đụng vào file này nữa.
function migrationFilesOnDisk() {
  const dir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
  return readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
}

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
    const files = migrationFilesOnDisk();
    // resetDb() chạy migrate.latest() trước bài test này nên MỌI file trên
    // đĩa phải đã áp dụng — so khớp chính xác, không chỉ >=, để bài test còn
    // bắt được trường hợp một migration bị bỏ sót khi migrate.
    expect(res.body.migration.applied).toBe(files.length);
    expect(res.body.migration.latest).toBe(files[files.length - 1]);
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
