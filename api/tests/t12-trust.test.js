import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';
import { tierOf, TIERS } from '../src/core/trust.js';
import * as membersService from '../src/modules/members/service.js';

// ---------------------------------------------------------------------------
// T12 — bậc uy tín. Hai tuyên bố cần canh, và chúng độc lập với nhau:
//
//   A. MỘT NGUỒN SỰ THẬT, CHIA HAI TẦNG. CSDL giữ con số thô, JS giữ ngưỡng
//      bậc. Nếu ngưỡng lọt vào SQL (hoặc số thô được tính lại trong JS) thì có
//      hai nơi cùng quyết định một điều — và chúng sẽ lệch.
//   B. KHÔNG XẾP HẠNG (mục 8.3 và mục 9). Bậc uy tín trả lời "người này đã làm
//      bao nhiêu việc được xác nhận", không phải "ai hơn ai". Danh bạ xếp theo
//      TÊN, và không truy vấn nào được ORDER BY theo con số uy tín.
// ---------------------------------------------------------------------------

let db, cid, otherCid, approver;
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
  for (let i = 0; i < n; i++) ids.push(await mkMember(communityId, `Nguoi uy tin ${++people}`));
  return ids;
}

// parts: [[memberId, role], ...] — vai tường minh vì bài "ai đã NHỜ ai" phụ
// thuộc đúng vào cột đó.
async function newWork({ sourceType = 'signal', createdBy, parts, communityId = cid }) {
  seq += 1;
  const { rows: [w] } = await db.raw(
    `INSERT INTO work_records (community_id, source_type, title, done_on, created_by)
     VALUES (?,?,?,'2026-08-01',?) RETURNING id`,
    [communityId, sourceType, `Viec uy tin ${seq}`, createdBy ?? parts[0][0]]
  );
  for (const [m, role] of parts) {
    await db.raw(
      `INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,?)`,
      [communityId, w.id, m, role]
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

async function statsOf(memberId) {
  const { rows } = await db.raw(`SELECT * FROM member_trust_stats WHERE member_id = ?`, [memberId]);
  return rows[0] ?? null;
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t12t','Hoi dong nien 1986') RETURNING id`
  ));
  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t12t-khac','Cong dong khac') RETURNING id`
  ));
  approver = await mkMember(cid, 'Ban duyet uy tin');
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = 'approver'`,
    [approver, cid]
  );
});

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
describe('T12 core/trust.js — ngưỡng bậc nằm ở JS và CHỈ ở JS', () => {
  it('mỗi ngưỡng của mục 8.3 và mép ngay dưới nó', () => {
    const cases = [
      [0, 'mam'], [4, 'mam'],
      [5, 'dong'], [19, 'dong'],
      [20, 'bac'], [49, 'bac'],
      [50, 'vang'], [99, 'vang'],
      [100, 'kim_cuong'], [10_000, 'kim_cuong'],
    ];
    for (const [n, key] of cases) expect(tierOf(n).key, `${n} việc`).toBe(key);
  });

  it('đầu vào bẩn rơi về bậc THẤP NHẤT chứ không ném lỗi, không nhảy lên bậc cao', () => {
    for (const bad of [null, undefined, NaN, -1, 'khong-phai-so', {}, []]) {
      expect(tierOf(bad).key, JSON.stringify(bad)).toBe('mam');
    }
  });

  it('TIERS xếp tăng dần và có nhãn tiếng Việt — đúng thứ tự hiển thị của mục 8.3', () => {
    expect(TIERS.map((t) => t.key)).toEqual(['mam', 'dong', 'bac', 'vang', 'kim_cuong']);
    expect(TIERS.map((t) => t.min)).toEqual([0, 5, 20, 50, 100]);
    expect(TIERS.map((t) => t.label)).toEqual(['Mầm', 'Đồng', 'Bạc', 'Vàng', 'Kim Cương']);
  });

  it('không migration nào chép lại tên bậc hay ngưỡng — CSDL chỉ giữ con số thô', () => {
    const dir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
    const guilty = [];
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (/\b(kim_cuong|'mam'|'dong'|'bac'|'vang')\b/.test(src)) guilty.push(f);
    }
    expect(guilty, `ngưỡng bậc bị lặp lại trong CSDL: ${guilty.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('T12 member_trust_stats — nơi DUY NHẤT đếm', () => {
  it('thiếu một chữ ký thì việc KHÔNG được tính', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await newWork({ parts: [[x, 'doer'], [y, 'receiver']] });
    await confirmAs(x, wr);

    const s = await statsOf(x);
    expect(s, 'hàng thống kê phải ra đời ngay lần ký đầu tiên').not.toBeNull();
    expect(s.confirmed_works, 'y chưa ký mà việc đã được tính').toBe(0);
    expect(s.community_id).toBe(cid);
  });

  it('đủ chữ ký thì việc được tính cho MỌI người tham gia', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await newWork({ parts: [[x, 'doer'], [y, 'receiver']] });
    await confirmAs(x, wr);
    await confirmAs(y, wr);

    expect((await statsOf(x)).confirmed_works).toBe(1);
    expect((await statsOf(y)).confirmed_works).toBe(1);
  });

  it('manual CHƯA qua approver: vào manual_works, KHÔNG vào confirmed_works', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await newWork({ sourceType: 'manual', createdBy: x, parts: [[x, 'doer'], [y, 'receiver']] });
    await confirmAs(x, wr);
    await confirmAs(y, wr);

    const s = await statsOf(x);
    expect(s.confirmed_works, 'manual chưa duyệt mà đã đúc được bậc uy tín').toBe(0);
    expect(s.manual_works, 'manual_works đếm riêng và hiện tách bạch — mục 8.3').toBe(1);
  });

  it('approver duyệt xong thì con số đổi NGAY, không phải chờ tác vụ 03:15', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await newWork({ sourceType: 'manual', createdBy: x, parts: [[x, 'doer'], [y, 'receiver']] });
    await confirmAs(x, wr);
    await confirmAs(y, wr);
    expect((await statsOf(x)).confirmed_works).toBe(0);

    // KHÔNG gọi fn_trust_recount() bằng tay ở đây (kế hoạch có gọi). Nếu phải
    // gọi tay thì nghĩa là thiếu một cửa: hồ sơ sẽ hiện bậc cũ cho tới sáng
    // hôm sau trong khi CSDL đã có dữ liệu mới.
    await db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [approver, wr]);

    expect((await statsOf(x)).confirmed_works).toBe(1);
    expect((await statsOf(y)).confirmed_works).toBe(1);
    expect((await statsOf(x)).manual_works).toBe(1);
  });

  it('distinct_requesters / repeat_requesters đếm ĐÚNG CHIỀU: người NHỜ, không phải người GIÚP', async () => {
    const [d, r1, r2] = await mkTeam(3);
    // d làm cho r1 hai lần, cho r2 một lần.
    for (const other of [r1, r1, r2]) {
      const wr = await newWork({ parts: [[d, 'doer'], [other, 'receiver']] });
      await confirmAs(d, wr);
      await confirmAs(other, wr);
    }

    const sd = await statsOf(d);
    expect(sd.confirmed_works).toBe(3);
    expect(sd.distinct_requesters, 'hai người khác nhau đã nhờ d').toBe(2);
    // Ruling C9: bản kế hoạch dùng window function bên trong LATERAL đã lọc
    // còn MỘT work_record, nên con số này vĩnh viễn bằng 0 mà không có gì báo.
    expect(sd.repeat_requesters, 'r1 nhờ hai lần — repeat_requesters không được đứng im ở 0').toBe(1);

    // Và chiều ngược lại: r1 chỉ NHỜ chứ không LÀM, nên không ai "đã nhờ" r1.
    const s1 = await statsOf(r1);
    expect(s1.confirmed_works, 'r1 vẫn có mặt trong 2 việc đã xác nhận').toBe(2);
    expect(s1.distinct_requesters, 'người được giúp không phải người được nhờ').toBe(0);
    expect(s1.repeat_requesters).toBe(0);
  });

  it('manual chưa duyệt cũng không đẻ ra distinct_requesters', async () => {
    const [d, r] = await mkTeam(2);
    const wr = await newWork({ sourceType: 'manual', createdBy: d, parts: [[d, 'doer'], [r, 'receiver']] });
    await confirmAs(d, wr);
    await confirmAs(r, wr);
    expect((await statsOf(d)).distinct_requesters, 'cửa bên cạnh cũng phải khoá').toBe(0);

    await db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [approver, wr]);
    expect((await statsOf(d)).distinct_requesters).toBe(1);
  });

  it('app_role không tự đặt được con số uy tín của mình', async () => {
    const [x] = await mkTeam(1);
    const wr = await newWork({ parts: [[x, 'doer']] });
    await confirmAs(x, wr);
    await expect(
      withActor(x, (trx) => trx.raw(`UPDATE member_trust_stats SET confirmed_works = 999 WHERE member_id = ?`, [x]))
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withActor(x, (trx) =>
        trx.raw(`INSERT INTO member_trust_stats (member_id, community_id, confirmed_works) VALUES (?,?,999)`, [x, cid])
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('không đếm chéo cộng đồng', async () => {
    const [p1, p2] = await mkTeam(2, otherCid);
    const wr = await newWork({ communityId: otherCid, parts: [[p1, 'doer'], [p2, 'receiver']] });
    await confirmAs(p1, wr, otherCid);
    await confirmAs(p2, wr, otherCid);

    const s = await statsOf(p1);
    expect(s.community_id).toBe(otherCid);
    expect(s.confirmed_works).toBe(1);

    // Và tổng của cộng đồng này không nhích lên vì việc của cộng đồng kia.
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM member_trust_stats WHERE community_id = ? AND member_id IN (?,?)`,
      [cid, p1, p2]
    );
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mục 9 đặc tả: bậc uy tín KHÔNG được dùng để sắp thứ tự danh bạ. Hai lưới,
// vì một lưới không đủ:
//
//   * Lưới quét mã nguồn bắt được cả những route CHƯA TỒN TẠI hôm nay — đó là
//     lý do đặc tả đòi nó. Nhưng nó chỉ bắt được đúng hình dạng nó biết.
//   * Lưới chạy thật khẳng định thứ tự THẬT của GET /members không phụ thuộc
//     số việc. Nó hẹp hơn nhưng không đoán mò về hình dạng mã.
// ---------------------------------------------------------------------------
describe('T12 mục 9 — bậc uy tín KHÔNG dùng để xếp thứ tự', () => {
  function jsFilesUnder(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...jsFilesUnder(full));
      else if (entry.endsWith('.js')) out.push(full);
    }
    return out;
  }

  it('không truy vấn nào trong src/ xếp theo con số uy tín', () => {
    const root = fileURLToPath(new URL('../src', import.meta.url));
    // `[^;\n]*` chứ không phải `[^;]*`: lớp phủ định KHỚP CẢ XUỐNG DÒNG, nên
    // vế sau sẽ nuốt trọn nhiều chục dòng và báo dương tính giả ở bất kỳ tệp
    // nào tình cờ có một ORDER BY ở trên và chữ confirmed_works ở dưới.
    const bad = /order\s+by[^;\n]*\b(confirmed_works|manual_works|distinct_requesters|repeat_requesters|tier)\b/i;
    const guilty = jsFilesUnder(root).filter((f) => bad.test(readFileSync(f, 'utf8')));
    expect(guilty, `xếp hạng theo uy tín là vi phạm mục 9: ${guilty.join(', ')}`).toEqual([]);
  });

  it('danh bạ xếp theo TÊN, và số việc không lay chuyển được thứ tự đó', async () => {
    // Cộng đồng riêng để danh sách chỉ có đúng ba người của bài này.
    const { rows: [{ id: rankCid }] } = await db.raw(
      `INSERT INTO communities (code,name) VALUES ('community-t12-rank','Cong dong xep hang') RETURNING id`
    );
    const viewer = await mkMember(rankCid, 'Aa Nguoi Xem');
    const busy = await mkMember(rankCid, 'Zz Nhieu Viec');
    const idle = await mkMember(rankCid, 'Bb It Viec');

    // busy có 3 việc đã xác nhận, idle có 0.
    for (let i = 0; i < 3; i++) {
      const wr = await newWork({ communityId: rankCid, parts: [[busy, 'doer'], [viewer, 'receiver']] });
      await confirmAs(busy, wr, rankCid);
      await confirmAs(viewer, wr, rankCid);
    }
    expect((await statsOf(busy)).confirmed_works).toBe(3);
    expect(await statsOf(idle)).toBeNull();

    const res = await membersService.list({ actor: { id: viewer, communityId: rankCid } });
    expect(res.data.map((m) => m.full_name)).toEqual(['Aa Nguoi Xem', 'Bb It Viec', 'Zz Nhieu Viec']);

    // Và con số uy tín không rò ra vỏ HTTP theo đường nào cả — chưa có màn nào
    // ở giai đoạn 1 hiện nó, mà "vô tình gửi kèm" là cách một dữ liệu bắt đầu
    // được dùng để xếp hạng ở phía trình duyệt.
    const raw = JSON.stringify(res);
    for (const k of ['confirmed_works', 'manual_works', 'tier', 'trust']) {
      expect(raw, `danh bạ không được mang theo ${k}`).not.toContain(k);
    }
  });
});
