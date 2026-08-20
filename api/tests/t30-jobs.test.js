import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { runSeed } from '../src/db/seeds/run.js';
import { COMMUNITY_ID } from '../src/db/seeds/data/community.js';
import { byCode } from '../src/db/seeds/data/tree.js';
import { JOBS, matches, runJob } from '../src/jobs/index.js';
import * as trustRecount from '../src/jobs/trust-recount.js';
import * as overdue from '../src/jobs/overdue.js';
import * as reminders from '../src/jobs/reminders.js';
import * as auditPartition from '../src/jobs/audit-partition.js';
import * as purgeJoinSecrets from '../src/jobs/purge-join-secrets.js';
import { verifyChain } from '../src/core/audit.js';

// ---------------------------------------------------------------------------
// T30 — khung tác vụ định kỳ (Task 18, bước 3), và ba khoản nợ nó trả.
//
// Mỗi bài dưới đây dựng đúng một hình dạng "đã tới hạn", chạy tác vụ, rồi
// khẳng định hai thứ: việc đã được làm, VÀ nhật ký ghi lại đúng việc ấy. Vế
// thứ hai quan trọng ngang vế thứ nhất — một tác vụ dọn dẹp không để lại dấu
// vết là một tác vụ mà không ai kiểm được nó đã dọn cái gì.
// ---------------------------------------------------------------------------

let db;

beforeAll(async () => {
  process.env.SEED_PASSWORD = 'mat-khau-du-manh-cho-seed';
  db = await resetDb();
  await runSeed(db);
}, 180_000);

afterAll(async () => {
  await db?.destroy();
});

async function auditRows(action) {
  const { rows } = await db.raw(
    `SELECT detail FROM audit_log WHERE community_id = ? AND action = ? ORDER BY seq`,
    [COMMUNITY_ID, action]
  );
  return rows;
}

describe('T30 — khung tác vụ định kỳ', () => {
  it('lịch khớp đúng phút và đúng giờ', () => {
    const at = (h, m) => new Date(2026, 7, 20, h, m, 0);
    expect(matches({ hour: 3, minute: 15 }, at(3, 15))).toBe(true);
    expect(matches({ hour: 3, minute: 15 }, at(4, 15))).toBe(false);
    expect(matches({ hour: 3, minute: 15 }, at(3, 16))).toBe(false);
    // `hour: null` là "mọi giờ" — nhưng vẫn đúng một lần mỗi giờ.
    expect(matches({ hour: null, minute: 5 }, at(0, 5))).toBe(true);
    expect(matches({ hour: null, minute: 5 }, at(23, 5))).toBe(true);
    expect(matches({ hour: null, minute: 5 }, at(23, 6))).toBe(false);
  });

  it('mọi tác vụ khai đủ key, lịch, và hàm chạy', () => {
    expect(JOBS.length).toBeGreaterThanOrEqual(5);
    for (const j of JOBS) {
      expect(typeof j.key).toBe('string');
      expect(typeof j.run).toBe('function');
      expect(typeof j.schedule.minute).toBe('number');
    }
    // Hai tác vụ trùng khoá sẽ giành nhau CÙNG một khoá tư vấn, tức chỉ một
    // cái chạy được mỗi lượt và cái kia im lặng bỏ lượt mãi mãi.
    expect(new Set(JOBS.map((j) => j.key)).size).toBe(JOBS.length);
  });

  // -- Nợ Task 12 ------------------------------------------------------------

  it('trust.recount tính lại và GHI LỆCH khi con số bị sửa ngoài đường ghi', async () => {
    // Sửa thẳng bảng đếm bằng quyền chủ sở hữu — đúng hình dạng mà tác vụ này
    // sinh ra để phát hiện: một con số uy tín đổi mà không đi qua trigger nào.
    await db.raw(
      `UPDATE member_trust_stats SET confirmed_works = 999 WHERE member_id = ?`,
      [byCode.M01.id]
    );

    const r = await runJob(trustRecount);
    expect(r.members).toBe(52);
    expect(r.drifted).toBeGreaterThanOrEqual(1);

    const { rows: [m01] } = await db.raw(
      `SELECT confirmed_works FROM member_trust_stats WHERE member_id = ?`, [byCode.M01.id]
    );
    expect(m01.confirmed_works).toBe(20);

    const logged = await auditRows('job.trust_recount');
    expect(logged.at(-1).detail.drifted).toBeGreaterThanOrEqual(1);

    // Chạy lần thứ hai ngay sau đó: không còn ai lệch nữa.
    const again = await runJob(trustRecount);
    expect(again.drifted).toBe(0);
  }, 60_000);

  // -- Nợ Task 9 -------------------------------------------------------------

  it('purge_join_secrets dọn bí mật của đơn BỊ TỪ CHỐI, và chỉ của đơn ấy', async () => {
    const before = await db.raw(`SELECT count(*)::int AS n FROM join_request_secrets`);
    expect(before.rows[0].n).toBe(4);   // 2 đơn còn sống + 2 đơn bị từ chối

    // Chưa qua hạn ân: chưa dọn gì. Đây là nửa quan trọng hơn của bài —
    // một tác vụ xoá dữ liệu mà không ai kiểm điều kiện xoá là một tác vụ
    // sẽ xoá nhầm đúng một lần.
    const early = await runJob(purgeJoinSecrets);
    expect(early.purged).toBe(0);

    // Đẩy `updated_at` của hai đơn bị từ chối lùi quá hạn ân.
    await db.raw(
      `UPDATE join_requests SET updated_at = now() - interval '30 days'
        WHERE community_id = ? AND status = 'rejected'`,
      [COMMUNITY_ID]
    );

    const r = await runJob(purgeJoinSecrets);
    expect(r.purged).toBe(2);

    const { rows } = await db.raw(
      `SELECT r.status FROM join_request_secrets s JOIN join_requests r ON r.id = s.join_request_id`
    );
    expect(rows).toHaveLength(2);
    // Hai hàng còn lại thuộc đơn CÒN SỐNG, không phải đơn bị từ chối.
    expect(rows.every((x) => x.status !== 'rejected')).toBe(true);

    const logged = await auditRows('job.purge_join_secrets');
    expect(logged.at(-1).detail.purged).toBe(2);

    // Chạy lại: không còn gì để dọn, và KHÔNG ghi thêm dòng nhật ký nào.
    const n0 = logged.length;
    const empty = await runJob(purgeJoinSecrets);
    expect(empty.purged).toBe(0);
    expect((await auditRows('job.purge_join_secrets')).length).toBe(n0);
  }, 60_000);

  // -- Nợ "phân mảnh audit_log tháng sau" -----------------------------------

  it('audit.partition tạo trước phân mảnh, và chạy lại không tạo trùng', async () => {
    const r = await runJob(auditPartition);

    const { rows } = await db.raw(
      `SELECT relname FROM pg_class WHERE relname LIKE 'audit_log_%' ORDER BY relname`
    );
    const names = rows.map((x) => x.relname);
    const next = new Date();
    next.setMonth(next.getMonth() + 1, 1);
    const want = `audit_log_${next.getFullYear()}_${String(next.getMonth() + 1).padStart(2, '0')}`;
    expect(names).toContain(want);

    // Phân mảnh mới phải THỪA HƯỞNG ĐÚNG ma trận quyền: `app_role` chỉ
    // SELECT/INSERT. Nếu quên, thì mỗi tháng lại mở ra một bảng nhật ký mà ứng
    // dụng UPDATE/DELETE được — và bảng ấy chính là bảng chứa chuỗi băm.
    const { rows: grants } = await db.raw(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE grantee = 'app_role' AND table_name = ? ORDER BY privilege_type`,
      [want]
    );
    expect(grants.map((g) => g.privilege_type)).toEqual(['INSERT', 'SELECT']);

    const again = await runJob(auditPartition);
    expect(again.created).toBe(0);
    expect(r.created + again.created).toBe(r.created);
  }, 60_000);

  // -- Quá hạn ---------------------------------------------------------------

  it('ops.overdue đánh dấu hành động quá hạn và đóng tín hiệu quá hạn trả lời', async () => {
    // Không có gì quá hạn trong dữ liệu mẫu — cố ý, xem chú thích ở data/life.js.
    const quiet = await runJob(overdue);
    expect(quiet).toEqual({ actions_expired: 0, signals_closed: 0 });

    await db.raw(
      `UPDATE signals SET respond_by = now() - interval '2 days'
        WHERE community_id = ? AND status = 'open'`,
      [COMMUNITY_ID]
    );

    const r = await runJob(overdue);
    expect(r.signals_closed).toBeGreaterThanOrEqual(1);

    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM signals
        WHERE community_id = ? AND status = 'open' AND respond_by <= now()`,
      [COMMUNITY_ID]
    );
    expect(n).toBe(0);

    // 'closed' chứ không phải 'cancelled': hết hạn trả lời và người tạo rút
    // lại là hai câu chuyện khác nhau.
    const { rows: [{ c }] } = await db.raw(
      `SELECT count(*)::int AS c FROM signals WHERE community_id = ? AND status = 'cancelled'`,
      [COMMUNITY_ID]
    );
    expect(c).toBe(1);   // đúng cái tín hiệu vốn đã 'cancelled' trong dữ liệu mẫu
  }, 60_000);

  it('ops.reminders đếm đơn xác minh nằm lâu và việc im lặng quá 30 ngày', async () => {
    const quiet = await runJob(reminders);
    expect(quiet).toEqual({ verifications_stale: 0, connections_silent: 0 });

    await db.raw(
      `INSERT INTO verifications (community_id, member_id, kind, status, created_at)
       VALUES (?, ?, 'identity', 'pending', now() - interval '40 days')`,
      [COMMUNITY_ID, byCode.M09.id]
    );

    const r = await runJob(reminders);
    expect(r.verifications_stale).toBe(1);

    const logged = await auditRows('job.reminders');
    expect(logged.at(-1).detail.verifications_stale).toBe(1);
  }, 60_000);

  // -- Tính chất chung -------------------------------------------------------

  it('tác vụ định kỳ KHÔNG mượn tên ai: mọi dòng nhật ký của chúng có actor_id NULL', async () => {
    const { rows } = await db.raw(
      `SELECT action, actor_id FROM audit_log
        WHERE community_id = ? AND action LIKE 'job.%'`, [COMMUNITY_ID]
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.actor_id).toBeNull();
  });

  it('chuỗi băm vẫn liên mạch sau khi mọi tác vụ đã chạy', async () => {
    const r = await verifyChain(db, { communityId: COMMUNITY_ID });
    expect(r.ok).toBe(true);
  });

  it('khoá tư vấn: khi một tiến trình khác đang giữ khoá thì lượt này bỏ qua', async () => {
    // KHÔNG dùng `Promise.all([runJob(), runJob()])`: hai lượt ấy nhanh tới mức
    // cái thứ nhất commit xong trước khi cái thứ hai kịp mở kết nối, nên bài
    // test sẽ xanh hay đỏ tuỳ máy — nó đo tốc độ chứ không đo khoá. Thay vào
    // đó GIỮ khoá thật trong một giao dịch riêng rồi mới gọi tác vụ.
    const held = db.transaction(async (trx) => {
      const { rows: [{ got }] } = await trx.raw(
        `SELECT pg_try_advisory_xact_lock(hashtextextended(?, 77)) AS got`, ['job:' + overdue.key]
      );
      expect(got).toBe(true);
      // Giữ khoá đủ lâu để lời gọi bên dưới chắc chắn gặp nó.
      await trx.raw(`SELECT pg_sleep(1.5)`);
      return 'da nha';
    });

    await new Promise((r) => setTimeout(r, 300));
    const skipped = await runJob(overdue);
    expect(skipped).toBeNull();

    expect(await held).toBe('da nha');

    // Khoá đã nhả theo giao dịch: lượt sau chạy bình thường.
    expect(await runJob(overdue)).not.toBeNull();
  }, 60_000);
});
