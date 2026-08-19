import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import knexLib from 'knex';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';

const DATABASE_URL = process.env.DATABASE_URL
  ?? 'postgres://app_role:test_app@localhost:55432/nhachung_test';

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

  // Phát hiện soát xét (Important, vòng sửa 1): pool thật của db/knex.js có
  // `min: 2, max: 10` — nếu bài test chỉ mở một kết nối app-level knex mới sau
  // withActor(), câu SELECT tiếp theo có thể trúng MỘT TRONG HAI kết nối khởi
  // tạo sẵn theo `min: 2`, vốn chưa từng chạy set_config() — current_setting
  // sẽ rỗng "một cách hiển nhiên", không phải vì set_config(..., true) tự hủy
  // đúng ngữ nghĩa SET LOCAL. Bài cũ không phân biệt được hai khả năng đó
  // (đã tự thử: hardcode set_config(..., false) trong core/tx.js vẫn làm bài
  // cũ xanh — vì bài cũ không hề gọi withActor() thật cho phần "sau giao
  // dịch", nó tự tay set_config riêng rồi mở một kết nối app-level khác).
  //
  // Sửa: mock `../db/knex.js` (module mà core/tx.js import) để trỏ về một
  // knex riêng với pool { min: 1, max: 1 } — chỉ có đúng một kết nối vật lý,
  // buộc câu SELECT sau đó phải tái sử dụng CHÍNH kết nối withActor() thật đã
  // dùng. Đối chiếu thêm pg_backend_pid() để tự xác nhận giả định đó đúng
  // thay vì tin suông — nếu pid khác nhau, bài test tự thất bại rõ ràng.
  it('dấu không rò ra ngoài giao dịch (buộc dùng lại đúng 1 kết nối vật lý)', async () => {
    const soloKnex = knexLib({
      client: 'pg',
      connection: DATABASE_URL,
      pool: { min: 1, max: 1 },
    });

    vi.resetModules();
    vi.doMock('../src/db/knex.js', () => ({ knex: soloKnex, default: soloKnex }));

    try {
      const { withActor: withActorSolo } = await import('../src/core/tx.js');
      const id = '22222222-2222-2222-2222-222222222222';

      const insidePid = await withActorSolo(id, async (trx) => {
        const { rows } = await trx.raw(`SELECT pg_backend_pid() AS pid`);
        return rows[0].pid;
      });

      const { rows } = await soloKnex.raw(
        `SELECT current_setting('app.actor_id', true) AS a, pg_backend_pid() AS pid`
      );
      const after = rows[0];

      // Tự xác nhận giả định "cùng một kết nối vật lý" trước khi tin vào kết
      // quả rỗng bên dưới — nếu pool { min: 1, max: 1 } không hoạt động như
      // kỳ vọng (pid khác nhau), bài test phải thất bại chứ không lặng lẽ xanh.
      expect(after.pid).toBe(insidePid);
      expect(after.a === null || after.a === '').toBe(true);
    } finally {
      vi.doUnmock('../src/db/knex.js');
      vi.resetModules();
      await soloKnex.destroy();
    }
  });
});
