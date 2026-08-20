import { seedKnex } from './db.js';
import { upsert, actAs } from './helpers.js';
import { COMMUNITY_CODE, AREAS } from './data/community.js';

/**
 * Cập nhật riêng danh mục khu vực cho database đã có cộng đồng từ trước.
 *
 * Bộ seed đầy đủ dùng COMMUNITY_ID UUIDv5 để dựng database mẫu sạch. Database
 * vận hành có thể đã dùng một UUID lịch sử cho cùng COMMUNITY_CODE; lệnh này
 * không đổi community_id, không đụng thành viên và không tạo cộng đồng thứ hai.
 */
export async function seedAreas(db) {
  const own = !db;
  const knex = db ?? seedKnex();
  try {
    let inserted = 0;
    await knex.transaction(async (trx) => {
      const { rows: [community] } = await trx.raw(
        `SELECT id FROM communities WHERE code = ? ORDER BY created_at ASC LIMIT 1`,
        [COMMUNITY_CODE]
      );
      if (!community) {
        throw new Error(`Không tìm thấy cộng đồng có mã ${COMMUNITY_CODE}; hãy migrate trước.`);
      }

      await actAs(trx, null);
      const rows = AREAS.map((area) => ({
        ...area,
        community_id: community.id,
      }));
      inserted = await upsert(
        trx, 'areas', ['id', 'community_id', 'name', 'lat', 'lng', 'is_active'], rows,
        { update: ['name', 'lat', 'lng', 'is_active'] }
      );
    });
    return { areas: inserted };
  } finally {
    if (own) await knex.destroy();
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/db/seeds/areas.js');
if (invokedDirectly) {
  seedAreas()
    .then((stat) => console.log('Đã cập nhật danh mục khu vực:', stat))
    .catch((err) => {
      console.error('Cập nhật danh mục khu vực thất bại:', err.message);
      process.exit(1);
    });
}
