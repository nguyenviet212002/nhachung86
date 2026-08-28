import { communities, logJob } from './lib.js';

/**
 * Hằng ngày — dọn `idempotency_keys` quá 24 giờ.
 *
 * Hàng chỉ có ích trong biên độ một người bấm lại nút sau khi mất mạng —
 * vài phút tới vài giờ là cùng. Giữ 24 giờ là dư khoảng đó; giữ mãi thì bảng
 * này phình vô hạn theo số lần POST của toàn hệ thống, không phục vụ mục
 * đích nào sau khi đã qua biên độ đó.
 */
export const key = 'idempotency.purge_keys';
export const schedule = { hour: 4, minute: 10 };

const RETENTION_HOURS = 24;

export async function run(trx) {
  const out = { purged: 0 };

  for (const cid of await communities(trx)) {
    const res = await trx.raw(
      `DELETE FROM idempotency_keys WHERE community_id = ? AND created_at <= now() - (? || ' hours')::interval`,
      [cid, RETENTION_HOURS]
    );
    const n = res.rowCount ?? 0;
    out.purged += n;
    if (n) {
      await logJob(trx, {
        communityId: cid,
        action: 'job.purge_idempotency_keys',
        detail: { purged: n, retention_hours: RETENTION_HOURS },
      });
    }
  }
  return out;
}
