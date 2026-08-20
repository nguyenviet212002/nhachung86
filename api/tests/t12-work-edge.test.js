import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { withActor } from '../src/core/tx.js';

// ---------------------------------------------------------------------------
// T12 — cạnh `worked_together`. Đây là NGUYÊN TẮC 2 ("không có quan hệ suy
// diễn") ở dạng cụ thể nhất: một cạnh quan hệ chỉ tồn tại khi MỌI người tham
// gia đã tự tay xác nhận, và nó phải được ép ở tầng CSDL chứ không phải ở
// service — vì một lời hứa của service là thứ task sau có thể vô tình gỡ.
//
// Bốn nhóm bài, theo thứ tự nguy hiểm giảm dần:
//   1. Cạnh KHÔNG mọc sớm (thiếu một người thì không có cạnh nào).
//   2. Không ai ký thay ai, không ai ký ẩn danh (fn_self_only — nguyên tắc 1).
//   3. Đã có xác nhận thì việc VÀ danh sách người tham gia đóng băng — nếu
//      không, "đủ mọi người xác nhận" chỉ là một trạng thái tạm thời mà người
//      tạo bản ghi nắn lại được sau lưng người đã ký.
//   4. Không rò chéo cộng đồng, và app_role không tự ghi được cạnh nào.
// ---------------------------------------------------------------------------

let db, cid, otherCid;
let alice, bob, carol, dave, outsider;
let seq = 0;

async function mkMember(communityId, name) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?,'member') RETURNING id`,
    [communityId, name]
  );
  return m.id;
}

// Người MỚI TINH cho mỗi bài đếm cạnh. Lý do không dùng chung alice/bob: cạnh
// worked_together là UNIQUE theo cặp và fn_work_edge ghi ON CONFLICT DO NOTHING,
// nên cặp nào đã có cạnh từ bài trước sẽ không sinh hàng mới — bài sau đếm ra 0
// và trông như trigger hỏng, trong khi nó đang chạy đúng. (Đã tự vấp một vòng.)
let people = 0;
async function mkTeam(n, communityId = cid) {
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(await mkMember(communityId, `Nguoi doi ${++people}`));
  return ids;
}

// Bản ghi việc + danh sách người tham gia, gieo bằng kết nối OWNER. Người đầu
// tiên là 'doer', còn lại là 'receiver'.
async function newWork({ communityId = cid, sourceType = 'signal', createdBy, parts, doneOn = '2026-08-01' }) {
  seq += 1;
  const { rows: [w] } = await db.raw(
    `INSERT INTO work_records (community_id, source_type, title, done_on, created_by)
     VALUES (?,?,?,?,?) RETURNING id`,
    [communityId, sourceType, `Viec so ${seq}`, doneOn, createdBy ?? parts[0]]
  );
  for (const [i, m] of parts.entries()) {
    await db.raw(
      `INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,?)`,
      [communityId, w.id, m, i === 0 ? 'doer' : 'receiver']
    );
  }
  return w.id;
}

// Xác nhận đi qua withActor() — đó là đường DUY NHẤT của ứng dụng, và cũng là
// đường duy nhất đóng được dấu app.actor_id mà fn_self_only đòi.
function confirmAs(actorId, workId, memberId = actorId, communityId = cid) {
  return withActor(actorId, (trx) =>
    trx.raw(`INSERT INTO work_confirmations (community_id, work_record_id, member_id) VALUES (?,?,?)`, [
      communityId,
      workId,
      memberId,
    ])
  );
}

async function edgesOf(workId) {
  const { rows } = await db.raw(
    `SELECT member_a, member_b, first_work_record_id FROM member_relations
      WHERE kind = 'worked_together' AND first_work_record_id = ?
      ORDER BY member_a, member_b`,
    [workId]
  );
  return rows;
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t12','Hoi dong nien 1986') RETURNING id`
  ));
  ({ rows: [{ id: otherCid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('community-t12-khac','Cong dong khac') RETURNING id`
  ));
  alice = await mkMember(cid, 'Alice T12');
  bob = await mkMember(cid, 'Bob T12');
  carol = await mkMember(cid, 'Carol T12');
  dave = await mkMember(cid, 'Dave T12');
  outsider = await mkMember(otherCid, 'Nguoi cong dong khac');
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = 'approver'`,
    [dave, cid]
  );
});

afterAll(async () => {
  await db.destroy();
});

// ---------------------------------------------------------------------------
describe('T12 cạnh worked_together chỉ sinh khi MỌI người tham gia đã xác nhận', () => {
  it('một bên xác nhận thì CHƯA có cạnh nào', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await newWork({ parts: [x, y] });
    await confirmAs(x, wr);
    expect(await edgesOf(wr)).toHaveLength(0);
  });

  it('bên thứ hai xác nhận thì cạnh xuất hiện, theo thứ tự chuẩn tắc a < b', async () => {
    const [x, y] = await mkTeam(2);
    const wr = await newWork({ parts: [x, y] });
    await confirmAs(x, wr);
    expect(await edgesOf(wr)).toHaveLength(0);

    await confirmAs(y, wr);
    const rows = await edgesOf(wr);
    expect(rows).toHaveLength(1);
    expect(rows[0].member_a < rows[0].member_b, 'cạnh vô hướng phải chuẩn tắc hoá a < b').toBe(true);
    expect([rows[0].member_a, rows[0].member_b].sort()).toEqual([x, y].sort());
    expect(rows[0].first_work_record_id).toBe(wr);
  });

  it('ba người: thiếu MỘT người thì KHÔNG có cạnh nào, kể cả cạnh giữa hai người đã ký', async () => {
    const [x, y, z] = await mkTeam(3);
    const wr = await newWork({ parts: [x, y, z] });
    await confirmAs(x, wr);
    await confirmAs(y, wr);
    // x và y đều đã ký. Nếu trigger sinh cạnh "cho những cặp đã đủ" thì ở đây
    // đã có cạnh x–y — và đó là quan hệ SUY DIỄN, vì việc mà hai người ký là
    // việc CÓ z trong đó, chưa được z xác nhận là đã xảy ra.
    expect(await edgesOf(wr), 'chưa đủ ba người mà đã có cạnh').toHaveLength(0);

    await confirmAs(z, wr);
    expect(await edgesOf(wr), 'ba người đủ chữ ký phải sinh đúng 3 cạnh').toHaveLength(3);
  });

  it('một người tham gia duy nhất thì không sinh cạnh nào (không tự nối với chính mình)', async () => {
    const [x] = await mkTeam(1);
    const wr = await newWork({ parts: [x] });
    await confirmAs(x, wr);
    expect(await edgesOf(wr)).toHaveLength(0);
  });

  it('cùng một cặp làm việc lần thứ hai: KHÔNG đẻ thêm cạnh, và cạnh vẫn trỏ về việc ĐẦU TIÊN', async () => {
    const [x, y] = await mkTeam(2);
    const wr1 = await newWork({ parts: [x, y] });
    await confirmAs(x, wr1);
    await confirmAs(y, wr1);

    const wr2 = await newWork({ parts: [x, y] });
    await confirmAs(x, wr2);
    await confirmAs(y, wr2);

    const { rows } = await db.raw(
      `SELECT first_work_record_id FROM member_relations
        WHERE kind='worked_together' AND member_a IN (?,?) AND member_b IN (?,?)`,
      [x, y, x, y]
    );
    expect(rows, 'quan hệ "đã từng làm việc cùng nhau" là MỘT cạnh, không phải một cạnh mỗi lần').toHaveLength(1);
    expect(rows[0].first_work_record_id).toBe(wr1);
  });
});

// ---------------------------------------------------------------------------
describe('T12 fn_self_only — không ai ký thay ai, không ai ký ẩn danh', () => {
  it('A xác nhận thay B ⇒ SELF_ONLY', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await expect(confirmAs(alice, wr, bob)).rejects.toThrow(/SELF_ONLY/);
    expect(await edgesOf(wr)).toHaveLength(0);
  });

  it('xác nhận ngoài giao dịch có đóng dấu người thực hiện ⇒ NO_ACTOR', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    // withActor(null) đặt app.actor_id thành chuỗi RỖNG (Ruling T3-b), đúng
    // hình dạng mà nullif(...) của trigger phải bắt được.
    await expect(confirmAs(null, wr, alice)).rejects.toThrow(/NO_ACTOR/);
  });

  it('xác nhận một việc mình KHÔNG tham gia ⇒ khóa ngoại ghép chặn', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await expect(confirmAs(carol, wr)).rejects.toThrow(
      /work_confirmations_wr_member_fkey|violates foreign key/i
    );
  });

  it('xác nhận HAI LẦN để ăn gian số việc ⇒ trùng khóa', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await confirmAs(alice, wr);
    await expect(confirmAs(alice, wr)).rejects.toThrow(/duplicate key|unique/i);
  });
});

// ---------------------------------------------------------------------------
describe('T12 đã có xác nhận thì đóng băng', () => {
  it('sửa ngày/tên việc đã có xác nhận ⇒ WORK_RECORD_FROZEN', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await confirmAs(alice, wr);

    await expect(db.raw(`UPDATE work_records SET title = 'Viec khac han' WHERE id = ?`, [wr])).rejects.toThrow(
      /WORK_RECORD_FROZEN/
    );
    await expect(db.raw(`UPDATE work_records SET done_on = '2020-01-01' WHERE id = ?`, [wr])).rejects.toThrow(
      /WORK_RECORD_FROZEN/
    );
    await expect(db.raw(`UPDATE work_records SET created_by = ? WHERE id = ?`, [bob, wr])).rejects.toThrow(
      /WORK_RECORD_FROZEN/
    );
  });

  it('nhưng reviewed_by/reviewed_at thì vẫn đặt được — đó là cửa của approver', async () => {
    const wr = await newWork({ sourceType: 'manual', createdBy: alice, parts: [alice, bob] });
    await confirmAs(alice, wr);
    // dave mang vai approver (gieo ở beforeAll) và không tham gia việc này —
    // hai điều kiện của fn_work_review_gate, xem t12-manual-quota.
    await expect(
      db.raw(`UPDATE work_records SET reviewed_by = ?, reviewed_at = now() WHERE id = ?`, [dave, wr])
    ).resolves.toBeTruthy();
  });

  it('chưa có xác nhận nào thì sửa thoải mái', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await expect(db.raw(`UPDATE work_records SET title = 'Sua truoc khi ai ky' WHERE id = ?`, [wr])).resolves.toBeTruthy();
  });

  it('app_role không XOÁ được bản ghi việc (không nắn số liệu bằng cách xoá lịch sử)', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await expect(
      withActor(alice, (trx) => trx.raw(`DELETE FROM work_records WHERE id = ?`, [wr]))
    ).rejects.toThrow(/permission denied/i);
  });

  // -------------------------------------------------------------------------
  // Hai bài dưới đây canh một lỗ hổng KHÔNG có trong đặc tả. Bảng quyền mục 4.8
  // cấp cho work_participants đủ bốn quyền với lý do "danh sách người tham gia
  // còn sửa được TỚI KHI CÓ XÁC NHẬN ĐẦU TIÊN" — nhưng không có đối tượng SQL
  // nào thực hiện vế "tới khi" đó. Xem task-12-report.
  // -------------------------------------------------------------------------
  it('THÊM người tham gia sau khi mọi người đã ký ⇒ WORK_PARTICIPANTS_FROZEN', async () => {
    const [x, y, z] = await mkTeam(3);
    const wr = await newWork({ parts: [x, y] });
    await confirmAs(x, wr);
    await confirmAs(y, wr);
    expect(await edgesOf(wr)).toHaveLength(1); // cạnh x–y, hợp lệ

    // Không có trigger đóng băng: chèn z rồi để z tự xác nhận là đủ để
    // fn_work_edge thấy "mọi người đã ký" và sinh thêm x–z, y–z. x và y chưa
    // bao giờ xác nhận một việc có z trong đó — cạnh quan hệ mọc ra từ chữ ký
    // của người khác, đúng thứ nguyên tắc 2 cấm.
    await expect(
      db.raw(`INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,'receiver')`, [
        cid,
        wr,
        z,
      ])
    ).rejects.toThrow(/WORK_PARTICIPANTS_FROZEN/);

    const { rows } = await db.raw(
      `SELECT count(*)::int AS n FROM member_relations
        WHERE kind='worked_together' AND (member_a = ? OR member_b = ?)`,
      [z, z]
    );
    expect(rows[0].n, 'người được chèn thêm không được có cạnh nào').toBe(0);
  });

  it('XOÁ người tham gia chưa ký (gỡ người giữ cửa) ⇒ WORK_PARTICIPANTS_FROZEN', async () => {
    const [x, y, z] = await mkTeam(3);
    const wr = await newWork({ parts: [x, y, z] });
    await confirmAs(x, wr);
    await confirmAs(y, wr);
    // z im lặng nên việc chưa đủ chữ ký. Xoá z khỏi danh sách làm điều kiện
    // "đủ mọi người" thành đúng — gỡ người giữ cửa chính là cách mở cửa.
    // (Khóa ngoại của work_confirmations chỉ chặn xoá người ĐÃ ký.)
    await expect(db.raw(`DELETE FROM work_participants WHERE work_record_id = ? AND member_id = ?`, [wr, z]))
      .rejects.toThrow(/WORK_PARTICIPANTS_FROZEN/);

    // Đổi vai cũng không: người ta ký một việc với một danh sách cụ thể.
    await expect(db.raw(`UPDATE work_participants SET role = 'doer' WHERE work_record_id = ? AND member_id = ?`, [wr, z]))
      .rejects.toThrow(/WORK_PARTICIPANTS_FROZEN/);
  });

  it('trước xác nhận đầu tiên thì danh sách người tham gia vẫn sửa được', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await expect(
      db.raw(`INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,'receiver')`, [
        cid,
        wr,
        carol,
      ])
    ).resolves.toBeTruthy();
    await expect(db.raw(`DELETE FROM work_participants WHERE work_record_id = ? AND member_id = ?`, [wr, carol]))
      .resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('T12 cạnh chỉ do trigger sinh, và không bắc qua cộng đồng', () => {
  it('app_role INSERT thẳng vào member_relations ⇒ permission denied', async () => {
    await expect(
      withActor(alice, (trx) =>
        trx.raw(`INSERT INTO member_relations (community_id, kind, member_a, member_b) VALUES (?,'worked_together',?,?)`, [
          cid,
          alice < bob ? alice : bob,
          alice < bob ? bob : alice,
        ])
      )
    ).rejects.toThrow(/permission denied/i);
  });

  it('cạnh (B,A) khi đã có (A,B) ⇒ rel_canonical chặn', async () => {
    const lo = alice < bob ? alice : bob;
    const hi = alice < bob ? bob : alice;
    await expect(
      db.raw(`INSERT INTO member_relations (community_id, kind, member_a, member_b) VALUES (?,'worked_together',?,?)`, [
        cid,
        hi,
        lo,
      ])
    ).rejects.toThrow(/rel_canonical/);
  });

  it('người tham gia của cộng đồng KHÁC không gắn được vào bản ghi việc', async () => {
    const wr = await newWork({ parts: [alice, bob] });
    await expect(
      db.raw(`INSERT INTO work_participants (community_id, work_record_id, member_id, role) VALUES (?,?,?,'receiver')`, [
        cid,
        wr,
        outsider,
      ])
    ).rejects.toThrow(/violates foreign key/i);
  });

  it('một việc của cộng đồng KHÁC sinh cạnh trong ĐÚNG cộng đồng đó, không lẫn sang cộng đồng này', async () => {
    const p1 = await mkMember(otherCid, 'Nguoi khac 1');
    const p2 = await mkMember(otherCid, 'Nguoi khac 2');
    const wr = await newWork({ communityId: otherCid, parts: [p1, p2] });
    await confirmAs(p1, wr, p1, otherCid);
    await confirmAs(p2, wr, p2, otherCid);

    const rows = await edgesOf(wr);
    expect(rows).toHaveLength(1);
    const { rows: [rel] } = await db.raw(
      `SELECT community_id FROM member_relations WHERE first_work_record_id = ?`, [wr]);
    expect(rel.community_id).toBe(otherCid);

    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM member_relations
        WHERE community_id = ? AND (member_a IN (?,?) OR member_b IN (?,?))`,
      [cid, p1, p2, p1, p2]
    );
    expect(n, 'cạnh của cộng đồng kia không được xuất hiện trong cộng đồng này').toBe(0);
  });
});
