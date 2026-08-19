import { withActor } from '../../core/tx.js';

/**
 * Cây khu vực của CHÍNH cộng đồng người gọi (đặc tả dòng 867: `GET /areas`,
 * vai member, không ghi nhật ký — xem danh mục khu vực không phải hành vi cần
 * đếm).
 *
 * Cột trả ra được liệt kê tường minh: `lat`/`lng` của areas KHÔNG ra tới client
 * ở giai đoạn 1. Chưa màn nào cần chúng, và toạ độ là thứ chỉ nên mở khi có
 * người quyết định mở — không phải vì `SELECT *` tiện tay.
 */
export async function tree({ actor }) {
  return withActor(actor.id, async (trx) => {
    const { rows } = await trx.raw(
      `SELECT id, name, parent_id FROM areas WHERE community_id = ? ORDER BY name, id`,
      [actor.communityId]
    );

    const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, parent_id: r.parent_id, children: [] }]));
    const roots = [];
    for (const r of rows) {
      const node = byId.get(r.id);
      // parent_id trỏ ra ngoài cộng đồng (hoặc trỏ tới hàng không có trong tập
      // này) thì coi như gốc, KHÔNG đi tìm ở nơi khác: cây phải đóng trong đúng
      // một cộng đồng, và một nút mồ côi hiện ra ở mức gốc còn hơn biến mất.
      const parent = r.parent_id ? byId.get(r.parent_id) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    return { data: roots };
  });
}
