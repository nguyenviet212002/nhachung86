import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { v5 as uuidv5 } from 'uuid';
import { resetDb } from './helpers/db.js';
import { runSeed } from '../src/db/seeds/run.js';
import { id } from '../src/db/seeds/ids.js';
import { COMMUNITY_ID, HUNG_YEN_2025_AREA_NAMES, PROVINCES_VN_2025 } from '../src/db/seeds/data/community.js';
import { byCode, MEMBERS } from '../src/db/seeds/data/tree.js';
import { verifyChain } from '../src/core/audit.js';
import { buildApp } from '../src/app.js';

// ---------------------------------------------------------------------------
// T22 (đánh số tệp t29 vì t22/t28 đã có chủ) — dữ liệu mẫu.
//
// Bài này canh BỐN tính chất, và mỗi tính chất tương ứng một cách hỏng đã thấy
// thật trong dự án này:
//
//  1. CHẠY LẠI ĐƯỢC NHIỀU LẦN. Hỏng kiểu này im lặng: lần chạy thứ hai vẫn
//     "thành công", chỉ là cộng đồng có 104 người. Cách duy nhất bắt được là
//     đếm trước và đếm sau.
//  2. CÓ SẴN MỘT NGƯỜI CHẠM HẠN MỨC. Không có dữ liệu này thì bài kiểm hạn
//     mức bảo lãnh phải tự dựng lấy lịch sử 12 tháng, và mọi bài như vậy đều
//     dựng một lịch sử hơi khác nhau.
//  3. CHUỖI BĂM LIÊN MẠCH. Kiểm bằng chính `verifyChain()`, không phải bằng
//     một phép so sánh riêng viết trong bài test — nếu bài test tự tính băm
//     theo cách của nó thì nó đang kiểm chính nó.
//  4. DỰNG TỪ SỐ KHÔNG THÌ ĐĂNG NHẬP ĐƯỢC. Đây là món nợ Task 9: cho tới
//     trước lượt này, KHÔNG lệnh nào dựng được một hệ thống đăng nhập được từ
//     cơ sở dữ liệu trống, nên mọi kiểm chứng đầu-cuối đều phải gieo tay bằng
//     `psql`.
// ---------------------------------------------------------------------------

const SEED_PASSWORD = 'mat-khau-du-manh-cho-seed';

// Bảng nào cũng đếm, kể cả bảng do TRIGGER sinh (`member_contacts`,
// `privacy_settings`, `member_relations`, `audit_log`): nếu seed chạy hai lần
// mà một trigger nào đó đẻ thêm hàng thì phải thấy ở đây chứ không phải ở
// những bảng seed tự ghi.
const TABLES = [
  'communities', 'areas', 'members', 'member_roles', 'member_contacts',
  'privacy_settings', 'member_relations', 'join_requests', 'join_request_secrets',
  'capabilities', 'work_records', 'work_participants', 'work_confirmations',
  'member_trust_stats', 'signals', 'signal_recipients', 'job_needs',
  'aid_requests', 'aid_slots', 'aid_slot_takers', 'activities',
  'activity_summaries', 'fund_entries', 'fund_entry_approvals', 'loans',
  'loan_guarantors', 'pending_actions', 'audit_log',
];

let db, app, api;

async function counts() {
  const out = {};
  for (const t of TABLES) {
    const { rows: [r] } = await db.raw(`SELECT count(*)::int AS n FROM ${t}`);
    out[t] = r.n;
  }
  return out;
}

beforeAll(async () => {
  process.env.SEED_PASSWORD = SEED_PASSWORD;
  db = await resetDb();
  app = buildApp();
  api = supertest(app);
}, 180_000);

afterAll(async () => {
  await db?.destroy();
});

describe('T22/t29 — dữ liệu mẫu', () => {
  it('chạy seed hai lần không nhân đôi dữ liệu', async () => {
    const first = await runSeed(db);
    const a = await counts();

    const second = await runSeed(db);
    const b = await counts();

    expect(b).toEqual(a);

    // Mạnh hơn "số đếm bằng nhau": lần chạy thứ hai không ghi MỘT hàng nào.
    // Số đếm bằng nhau vẫn có thể đúng khi seed xoá đi rồi ghi lại — và một
    // seed như thế sẽ thay id của mọi hàng, tức mọi khoá ngoại trỏ tới dữ liệu
    // mẫu đều gãy sau mỗi lần chạy.
    expect(Object.values(second).reduce((x, y) => x + y, 0)).toBe(0);
    expect(first.members).toBe(52);
  }, 180_000);

  it('không id ngẫu nhiên: id của dữ liệu mẫu suy được từ khoá', async () => {
    const NS = '6f2a1c3e-8b4d-5f6a-9c1e-2d3b4a5c6d7e';
    expect(id('member:M07')).toBe(uuidv5('member:M07', NS));

    const { rows } = await db.raw(
      `SELECT id FROM members WHERE community_id = ? AND email = 'm07@nhachung.invalid'`,
      [COMMUNITY_ID]
    );
    expect(rows[0].id).toBe(id('member:M07'));
    expect(rows[0].id).toBe(byCode.M07.id);
  });

  it('cây bảo lãnh đủ 52 người, một gốc, không ai vượt 3 lượt trong 12 tháng', async () => {
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM members WHERE community_id = ?`, [COMMUNITY_ID]
    );
    expect(n).toBe(52);

    const { rows: roots } = await db.raw(
      `SELECT id FROM members WHERE community_id = ? AND referrer_id IS NULL`, [COMMUNITY_ID]
    );
    expect(roots).toHaveLength(1);

    // Cạnh bảo lãnh là dữ liệu DẪN XUẤT do trg_member_bootstrap sinh — seed
    // không hề ghi vào member_relations. 51 cạnh cho 51 người có người bảo lãnh.
    const { rows: [{ e }] } = await db.raw(
      `SELECT count(*)::int AS e FROM member_relations WHERE community_id = ? AND kind = 'guarantee'`,
      [COMMUNITY_ID]
    );
    expect(e).toBe(MEMBERS.length - 1);

    const { rows: over } = await db.raw(
      `SELECT referrer_id, count(*)::int AS n FROM join_requests
        WHERE community_id = ?
          AND created_at > now() - interval '12 months'
          AND (status IN ('pending','met_confirmed','approved')
            OR (status = 'rejected' AND reject_reason_code = 'referrer_misrepresented'))
        GROUP BY referrer_id HAVING count(*) > 3`,
      [COMMUNITY_ID]
    );
    expect(over).toHaveLength(0);
  });

  it('có sẵn một người chạm hạn mức để thử lỗi', async () => {
    await expect(
      db.raw(
        `INSERT INTO join_requests (community_id, applicant_data, referrer_id, status)
         VALUES (?, '{}'::jsonb, ?, 'pending')`,
        [COMMUNITY_ID, byCode.M07.id]
      )
    ).rejects.toThrow(/GUARANTEE_QUOTA_EXCEEDED/);
  });

  it('có sẵn hai nhánh từ chối ngược nhau', async () => {
    const { rows } = await db.raw(
      `SELECT reject_reason_code, count(*)::int AS n FROM join_requests
        WHERE community_id = ? AND status = 'rejected' GROUP BY 1 ORDER BY 1`,
      [COMMUNITY_ID]
    );
    expect(rows).toEqual([
      { reject_reason_code: 'not_ready', n: 1 },
      { reject_reason_code: 'referrer_misrepresented', n: 1 },
    ]);
  });

  it('đủ bộ dữ liệu mẫu theo Task 17', async () => {
    const expected = {
      capabilities: 148,
      signals: 7,
      job_needs: 5,
      aid_requests: 5,
      activities: 4,
      activity_summaries: 2,
      fund_entries: 12,
      loans: 2,
    };
    for (const [table, want] of Object.entries(expected)) {
      const { rows: [{ n }] } = await db.raw(
        `SELECT count(*)::int AS n FROM ${table} WHERE community_id = ?`,
        [COMMUNITY_ID]
      );
      expect(n, table).toBe(want);
    }

    // Cây khu vực giờ có hai cấp: 34 tỉnh/thành (gốc, parent_id NULL — đặc tả
    // "khu vực không chỉ Hưng Yên mà toàn bộ Việt Nam") + 104 xã/phường của
    // Hưng Yên (lá, parent_id trỏ về tỉnh Hưng Yên). Xem data/community.js.
    const { rows: [{ n: activeAreas }] } = await db.raw(
      `SELECT count(*)::int AS n FROM areas WHERE community_id = ? AND is_active = true`,
      [COMMUNITY_ID]
    );
    expect(activeAreas).toBe(138);
    expect(HUNG_YEN_2025_AREA_NAMES).toHaveLength(104);
    expect(PROVINCES_VN_2025).toHaveLength(34);

    const { rows: activeAreaRows } = await db.raw(
      `SELECT name FROM areas WHERE community_id = ? AND is_active = true ORDER BY name`,
      [COMMUNITY_ID]
    );
    expect(activeAreaRows.map((r) => r.name)).toEqual(
      [...HUNG_YEN_2025_AREA_NAMES.map(([name]) => name), ...PROVINCES_VN_2025.map(([name]) => name)].sort()
    );

    const { rows: [{ n: provinceRoots }] } = await db.raw(
      `SELECT count(*)::int AS n FROM areas
        WHERE community_id = ? AND is_active = true AND parent_id IS NULL`,
      [COMMUNITY_ID]
    );
    expect(provinceRoots).toBe(34);

    const { rows: [{ n: hungYenWards }] } = await db.raw(
      `SELECT count(*)::int AS n FROM areas a
        JOIN areas p ON p.id = a.parent_id
        WHERE a.community_id = ? AND a.is_active = true AND p.name = 'Tỉnh Hưng Yên'`,
      [COMMUNITY_ID]
    );
    expect(hungYenWards).toBe(104);

    const { rows: [{ n: activeWards }] } = await db.raw(
      `SELECT count(*)::int AS n FROM areas
        WHERE community_id = ? AND is_active = true AND name LIKE 'Phường %'`,
      [COMMUNITY_ID]
    );
    expect(activeWards).toBe(11);

    const { rows: [{ n: largeFunds }] } = await db.raw(
      `SELECT count(*)::int AS n FROM fund_entries
        WHERE community_id = ? AND abs(amount) >= 1000000`,
      [COMMUNITY_ID]
    );
    expect(largeFunds).toBe(2);

    const { rows: [{ n: confirmedWorks }] } = await db.raw(
      `SELECT count(*)::int AS n FROM work_records w
        WHERE w.community_id = ?
          AND (w.source_type <> 'manual' OR w.reviewed_at IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM work_participants p
             WHERE p.community_id = w.community_id
               AND p.work_record_id = w.id
               AND NOT EXISTS (
                 SELECT 1 FROM work_confirmations c
                  WHERE c.community_id = w.community_id
                    AND c.work_record_id = w.id
                    AND c.member_id = p.member_id))`,
      [COMMUNITY_ID]
    );
    expect(confirmedWorks).toBe(60);
  });

  it('có 3 bản ghi mới một bên xác nhận, và chúng CHƯA sinh cạnh', async () => {
    const { rows } = await db.raw(
      `SELECT w.id FROM work_records w
        WHERE w.community_id = ?
          AND EXISTS (SELECT 1 FROM work_participants p
                       WHERE p.work_record_id = w.id
                         AND NOT EXISTS (SELECT 1 FROM work_confirmations c
                                          WHERE c.work_record_id = p.work_record_id
                                            AND c.member_id = p.member_id))`,
      [COMMUNITY_ID]
    );
    expect(rows).toHaveLength(3);

    for (const r of rows) {
      const { rows: [{ n }] } = await db.raw(
        `SELECT count(*)::int AS n FROM member_relations
          WHERE community_id = ? AND kind = 'worked_together' AND first_work_record_id = ?`,
        [COMMUNITY_ID, r.id]
      );
      expect(n).toBe(0);
    }
  });

  it('có 1 bản ghi manual chưa duyệt, và nó KHÔNG được cộng vào bậc uy tín', async () => {
    const { rows } = await db.raw(
      `SELECT id FROM work_records
        WHERE community_id = ? AND source_type = 'manual' AND reviewed_at IS NULL`,
      [COMMUNITY_ID]
    );
    expect(rows).toHaveLength(1);

    // M12 tham gia đúng bản ghi manual chưa duyệt đó.
    const { rows: [s] } = await db.raw(
      `SELECT confirmed_works, manual_works FROM member_trust_stats
        WHERE member_id = ? AND community_id = ?`,
      [byCode.M12.id, COMMUNITY_ID]
    );
    expect(s.manual_works).toBe(1);
    // Bậc uy tín đếm việc ĐÃ ĐỦ XÁC NHẬN; bản ghi manual chưa qua approver
    // không nằm trong đó.
    expect(s.confirmed_works).toBe(2);
  });

  it('bậc uy tín có đủ ba mức Mầm / Đồng / Bạc', async () => {
    const { rows: [m01] } = await db.raw(
      `SELECT confirmed_works FROM member_trust_stats WHERE member_id = ?`, [byCode.M01.id]
    );
    expect(m01.confirmed_works).toBeGreaterThanOrEqual(20);   // Bạc

    const { rows: [m02] } = await db.raw(
      `SELECT confirmed_works FROM member_trust_stats WHERE member_id = ?`, [byCode.M02.id]
    );
    expect(m02.confirmed_works).toBeGreaterThanOrEqual(5);    // Đồng
    expect(m02.confirmed_works).toBeLessThan(20);

    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM member_trust_stats
        WHERE community_id = ? AND confirmed_works < 5`, [COMMUNITY_ID]
    );
    expect(n).toBeGreaterThan(0);                             // Mầm
  });

  it('chuỗi băm của dữ liệu mẫu liên mạch', async () => {
    const r = await verifyChain(db, { communityId: COMMUNITY_ID });
    expect(r.ok).toBe(true);
    // Không phải chuỗi rỗng: một chuỗi 0 dòng cũng "liên mạch".
    expect(r.checked).toBeGreaterThan(50);
  });

  it('seed KHÔNG chép tay một giá trị băm nào — chuỗi do trigger dựng', async () => {
    // Đột biến ngược: sửa một dòng nhật ký giữa chuỗi (chỉ chủ sở hữu làm được)
    // thì verifyChain phải thấy. Nếu seed từng gieo hash cứng, chuỗi vẫn "khớp"
    // với chính nó và bài trên xanh vô nghĩa.
    const { rows: [row] } = await db.raw(
      `SELECT seq FROM audit_log WHERE community_id = ? ORDER BY seq LIMIT 1 OFFSET 5`,
      [COMMUNITY_ID]
    );
    // Lọc theo `seq` chứ KHÔNG theo `at`: cột `at` là timestamptz độ chính xác
    // micro-giây, còn driver `pg` phân giải nó thành `Date` của JavaScript vốn
    // chỉ có mili-giây. Đưa giá trị đã cắt ấy ngược xuống SQL thì câu WHERE
    // không khớp hàng nào — và bài test sẽ "xanh" vì không sửa được gì cả, đúng
    // cái bẫy mà `core/audit.js` đã ghi chú dài ở `verifyChain`.
    const upd = await db.raw(`UPDATE audit_log SET action = 'da.bi.sua' WHERE seq = ?`, [row.seq]);
    expect(upd.rowCount).toBe(1);
    const broken = await verifyChain(db, { communityId: COMMUNITY_ID });
    expect(broken.ok).toBe(false);
    expect(Number(broken.brokenAt)).toBe(Number(row.seq));
  });

  it('dựng từ số không: đăng nhập được bằng một tài khoản trong dữ liệu mẫu', async () => {
    // Không dựng thêm gì cả — chỉ dùng đúng những gì `resetDb()` (migration) và
    // `runSeed()` đã để lại. Đây chính là câu trả lời cho món nợ Task 9.
    const res = await api
      .post('/api/v1/auth/login')
      .send({ identifier: 'm01@nhachung.invalid', password: SEED_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.access).toBeTruthy();
    expect(res.body.member.status).toBe('member');
  }, 30_000);

  it('đăng nhập được bằng SỐ ĐIỆN THOẠI của dữ liệu mẫu', async () => {
    // Số điện thoại nằm ở member_contacts — bảng mà app_role bị REVOKE ALL.
    // Bài này chứng minh seed đã đi đúng cửa `contact_upsert` chứ không ghi
    // thẳng vào bảng ấy: nếu ô liên hệ trống thì auth_lookup không tìm ra ai.
    const res = await api
      .post('/api/v1/auth/login')
      .send({ identifier: byCode.M02.phone, password: SEED_PASSWORD });

    expect(res.status).toBe(200);
  }, 30_000);
});
