import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, ownerKnex } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';

// ---------------------------------------------------------------------------
// T12 — `manual` là CỬA ĐÚC BẬC UY TÍN (spec mục 4.4).
//
// Nguyên tắc 5 nói trao đổi thật diễn ra ngoài nền tảng, nên bỏ hẳn `manual` sẽ
// đếm sai theo hướng nghiêm trọng hơn: nó ép người ta dựng tín hiệu giả cho
// việc có thật. Giữ `manual`, siết ba lớp — và cả ba lớp phải nằm ở CSDL:
//
//   Lớp 0 (không có trong đặc tả dạng SQL, xem task-12-report): người TẠO bản
//          ghi manual phải là một trong những người tham gia, và người DUYỆT
//          phải là approver của đúng cộng đồng, không phải người tham gia.
//   Lớp 1: chưa duyệt thì không được tính vào confirmed_works — bài ở t12-trust.
//   Lớp 2: 6 bản ghi manual mỗi CẶP / 12 tháng, khóa tư vấn theo cặp.
// ---------------------------------------------------------------------------

let db, cid, otherCid, approver, outsiderApprover;
let seq = 0;
let people = 0;

async function mkMember(communityId, name) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?,'member') RETURNING id`,
    [communityId, name]
  );
  return m.id;
}

async function mkTeam(n, communityId = cid) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await mkMember(communityId, `Nguoi manual ${++people}`));
  return ids;
}

async function grantApprover(memberId, communityId) {
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = 'approver'`,
    [memberId, communityId]
  );
}

async function newManual({ createdBy, parts, communityId = cid, createdAtSql = 'now()' }) {
  seq += 1;
  const { rows: [w] } = await db.raw(
    `INSERT INTO work_records (community_id, source_type, title, done_on, created_by, created_at)
     VALUES (?, 'manual', ?, '2026-08-01', ?, ${createdAtSql}) RETURNING id`,
    [communityId, `Viec thu cong ${seq}`, createdBy ?? parts[0]]
  );
  for (const [i, m] of parts.entries()) {
    await db.raw(
      `INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,?)`,
      [communityId, w.id, m, i === 0 ? 'doer' : 'receiver']
    );
  }
  return w.id;
}

function confirmAs(actorId, workId, communityId = cid) {
  return withActor(actorId, (trx) =>
    trx.raw(`INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`, [
      communityId,
      workId,
      actorId,
    ])
  );
}

// Một bản ghi manual TRỌN VẸN giữa đúng hai người: tạo, rồi cả hai cùng ký.
async function fullManual(x, y, createdAtSql = 'now()') {
  const wr = await newManual({ createdBy: x, parts: [x, y], createdAtSql });
  await confirmAs(x, wr);
  await confirmAs(y, wr);
  return wr;
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t12m','Hoi dong nien 1986') RETURNING id`
  ));
  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t12m-khac','Cong dong khac') RETURNING id`
  ));
  approver = await mkMember(cid, 'Ban duyet');
  await grantApprover(approver, cid);
  outsiderApprover = await mkMember(otherCid, 'Ban duyet cong dong khac');
  await grantApprover(outsiderApprover, otherCid);
});

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
describe('T12 lớp 2 — hạn mức 6 bản ghi manual mỗi cặp / 12 tháng', () => {
  it('sáu bản ghi qua được, bản thứ BẢY bị chặn ngay ở chữ ký đầu tiên', async () => {
    const [x, y] = await mkTeam(2);
    for (let i = 0; i < 6; i++) await fullManual(x, y);

    const wr7 = await newManual({ createdBy: x, parts: [x, y] });
    await expect(confirmAs(x, wr7)).rejects.toThrow(/MANUAL_PAIR_QUOTA_EXCEEDED/);

    // Và bản ghi thứ bảy KHÔNG được có chữ ký nào — nó chết ở cửa, không phải
    // chết sau khi đã ghi được nửa vời.
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM work_confirmations WHERE work_record_id = ?`, [wr7]);
    expect(n).toBe(0);
  });

  it('cửa sổ là 12 THÁNG TRƯỢT: bản ghi cũ hơn 12 tháng trả lại suất', async () => {
    const [x, y] = await mkTeam(2);
    for (let i = 0; i < 6; i++) await fullManual(x, y, `now() - interval '13 months'`);
    // Sáu bản ghi đều rơi ra ngoài cửa sổ ⇒ bản mới hôm nay là bản thứ NHẤT.
    await expect(fullManual(x, y)).resolves.toBeTruthy();
  });

  it('hạn mức đọc từ communities.config, không phải hằng số trong mã', async () => {
    const [x, y] = await mkTeam(2);
    await db.raw(`UPDATE communities SET config = config || '{"manual_pair_quota":2}'::jsonb WHERE id = ?`, [cid]);
    try {
      await fullManual(x, y);
      await fullManual(x, y);
      const wr3 = await newManual({ createdBy: x, parts: [x, y] });
      await expect(confirmAs(x, wr3)).rejects.toThrow(/MANUAL_PAIR_QUOTA_EXCEEDED/);
    } finally {
      await db.raw(`UPDATE communities SET config = config - 'manual_pair_quota' WHERE id = ?`, [cid]);
    }
  });

  it('hạn mức tính theo CẶP, không theo người: cặp khác vẫn còn nguyên suất', async () => {
    const [x, y, z] = await mkTeam(3);
    for (let i = 0; i < 6; i++) await fullManual(x, y);
    const wr7 = await newManual({ createdBy: x, parts: [x, y] });
    await expect(confirmAs(x, wr7)).rejects.toThrow(/MANUAL_PAIR_QUOTA_EXCEEDED/);
    // Cùng x nhưng cặp (x,z) chưa dùng suất nào.
    await expect(fullManual(x, z)).resolves.toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Bài này canh chỗ mã mẫu đặc tả SAI, xem task-12-report. Mã mẫu lấy
  // min/max của bản ghi rồi chỉ đếm cho ĐÚNG MỘT cặp đó, nên với bản ghi ba
  // người (A<B<C) chỉ cặp (A,C) được canh — cặp (A,B) đã dùng hết 6 suất vẫn
  // lọt qua bản thứ bảy chỉ vì có thêm C đứng tên.
  // -------------------------------------------------------------------------
  it('bản ghi BA NGƯỜI không lách được hạn mức của một cặp bên trong nó', async () => {
    const [x, y] = await mkTeam(2);
    // Ba người, và người thứ ba phải là người có id LỚN NHẤT hoặc NHỎ NHẤT để
    // cặp (min,max) khác cặp (x,y) — chọn theo id thật cho chắc chắn.
    let z;
    for (;;) {
      [z] = await mkTeam(1);
      const lo = [x, y, z].sort()[0];
      const hi = [x, y, z].sort()[2];
      if (!((lo === x && hi === y) || (lo === y && hi === x))) break;
    }

    for (let i = 0; i < 6; i++) await fullManual(x, y); // cặp (x,y) hết suất

    const wr7 = await newManual({ createdBy: x, parts: [x, y, z] });
    await expect(
      confirmAs(x, wr7),
      'cặp (x,y) đã có 6 bản ghi; thêm một người thứ ba không tạo ra suất mới'
    ).rejects.toThrow(/MANUAL_PAIR_QUOTA_EXCEEDED/);
  });

  // -------------------------------------------------------------------------
  // Bài chạy đua có ĐIỂM ĐỒNG BỘ QUAN SÁT ĐƯỢC TỪ PHÍA MÁY CHỦ (Ruling T8-a).
  // Xếp lịch promise trong Node KHÔNG phải điểm đồng bộ: `ins(tb)` chỉ tạo
  // promise, còn câu lệnh tới máy chủ trước hay sau `ta.commit()` là do bộ lập
  // lịch quyết định — bài test sẽ "đúng kết quả vì lý do sai" và không phân
  // biệt được hai lý do. Ở đây đọc pg_locks bằng kết nối thứ BA và chỉ commit
  // khi giao dịch kia THẬT SỰ đang xếp hàng sau một khóa tư vấn.
  // -------------------------------------------------------------------------
  it('hai giao dịch ĐỒNG THỜI cùng tranh suất cuối thì đúng MỘT cái qua', async () => {
    const [x, y] = await mkTeam(2);
    for (let i = 0; i < 5; i++) await fullManual(x, y); // 5/6 đã dùng

    const a = ownerKnex();
    const b = ownerKnex();
    try {
      const ta = await a.transaction();
      const tb = await b.transaction();

      // Mỗi giao dịch tự tạo bản ghi manual thứ 6/7 của mình rồi ký. Không có
      // khóa tư vấn thì cả hai đều đếm ra 6 (không thấy bản ghi chưa commit của
      // nhau) và cả hai đều lọt ⇒ cặp này có 7 bản ghi. Đây đúng là bài toán
      // BÓNG MA: đếm những hàng chưa tồn tại, nên FOR UPDATE không giải được.
      const race = async (t) => {
        const { rows: [w] } = await t.raw(
          `INSERT INTO work_records (community_id, source_type, title, done_on, created_by)
           VALUES (?, 'manual', 'Viec chay dua', '2026-08-01', ?) RETURNING id`,
          [cid, x]
        );
        await t.raw(
          `INSERT INTO work_participants (community_id, work_record_id, member_id, role)
           VALUES (?,?,?,'doer'), (?,?,?,'receiver')`,
          [cid, w.id, x, cid, w.id, y]
        );
        await t.raw(`SELECT set_config('app.actor_id', ?, true)`, [x]);
        await t.raw(`INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`, [
          cid,
          w.id,
          x,
        ]);
      };

      const r1 = await race(ta).then(() => 'ok').catch(() => 'fail');
      const p2 = race(tb).then(() => 'ok').catch(() => 'fail');

      let blocked = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const { rows } = await db.raw(
          `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`
        );
        if (rows[0].n > 0) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked, 'giao dịch thứ hai không hề bị chặn — khóa tư vấn không có tác dụng').toBe(true);

      await ta.commit();
      const r2 = await p2;
      await tb.rollback().catch(() => {});

      expect([r1, r2].filter((s) => s === 'ok')).toHaveLength(1);
    } finally {
      await a.destroy();
      await b.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
describe('T12 lớp 0 — ai được TẠO và ai được DUYỆT một bản ghi manual', () => {
  it('người ngoài cuộc dựng bản ghi manual cho hai người khác ⇒ MANUAL_CREATOR_NOT_PARTICIPANT', async () => {
    const [x, y, stranger] = await mkTeam(3);
    const wr = await newManual({ createdBy: stranger, parts: [x, y] });
    await expect(confirmAs(x, wr)).rejects.toThrow(/MANUAL_CREATOR_NOT_PARTICIPANT/);
  });

  it('luật đó CHỈ áp cho manual — nguồn khác vẫn do hệ thống/người thứ ba tạo', async () => {
    const [x, y, stranger] = await mkTeam(3);
    seq += 1;
    const { rows: [w] } = await db.raw(
      `INSERT INTO work_records (community_id, source_type, title, done_on, created_by)
       VALUES (?, 'signal', ?, '2026-08-01', ?) RETURNING id`,
      [cid, `Viec tu tin hieu ${seq}`, stranger]
    );
    for (const [i, m] of [x, y].entries()) {
      await db.raw(
        `INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,?)`,
        [cid, w.id, m, i === 0 ? 'doer' : 'receiver']
      );
    }
    await expect(confirmAs(x, w.id)).resolves.toBeTruthy();
  });

  it('người duyệt phải mang vai approver ⇒ REVIEWER_NOT_APPROVER', async () => {
    const [x, y, nobody] = await mkTeam(3);
    const wr = await fullManual(x, y);
    await expect(
      db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [nobody, wr])
    ).rejects.toThrow(/REVIEWER_NOT_APPROVER/);
  });

  it('approver của CỘNG ĐỒNG KHÁC không duyệt được ⇒ REVIEWER_NOT_APPROVER', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await fullManual(x, y);
    await expect(
      db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [outsiderApprover, wr])
    ).rejects.toThrow(/REVIEWER_NOT_APPROVER/);
  });

  it('approver KHÔNG tự duyệt việc của chính mình ⇒ REVIEWER_IS_PARTICIPANT', async () => {
    const [y] = await mkTeam(1);
    const wr = await fullManual(approver, y);
    await expect(
      db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [approver, wr])
    ).rejects.toThrow(/REVIEWER_IS_PARTICIPANT/);
  });

  it('bản ghi manual không được SINH RA đã duyệt sẵn ⇒ MANUAL_REVIEW_BEFORE_WORK', async () => {
    await expect(
      db.raw(
        `INSERT INTO work_records (community_id, source_type, title, done_on, created_by, reviewed_by, reviewed_at)
         VALUES (?, 'manual', 'Sinh ra da duyet', '2026-08-01', ?, ?, now())`,
        [cid, approver, approver]
      )
    ).rejects.toThrow(/MANUAL_REVIEW_BEFORE_WORK/);
  });

  it('approver hợp lệ, không tham gia việc ⇒ duyệt được', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await fullManual(x, y);
    await expect(
      db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [approver, wr])
    ).resolves.toBeTruthy();
  });

  it('reviewed_by và reviewed_at phải đi cùng nhau (wr_manual_review)', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await fullManual(x, y);
    await expect(db.raw(`UPDATE work_records SET reviewed_by = ? WHERE id = ?`, [approver, wr])).rejects.toThrow(
      /wr_manual_review/
    );
  });
});
