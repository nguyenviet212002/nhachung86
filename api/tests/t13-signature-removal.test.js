import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb, appKnex } from './helpers/db.js';

// ---------------------------------------------------------------------------
// T13 — GỠ CHỮ KÝ KHÔNG LÀM BÚT TOÁN LỚN THÀNH MỘT CHỮ KÝ (spec mục 4.8).
//
// Đây là bài quan trọng nhất của nhóm này, vì nó canh một hình dạng lỗi đã cắn
// dự án ba lần: **ràng buộc đặt trên bảng A không chạy khi người ta động vào
// bảng B.**
//
// `trg_fund_two_approvers` là constraint trigger trên `fund_entries`. Giao dịch
// 1 ghi bút toán 2 triệu kèm 2 chữ ký — qua kiểm. Giao dịch 2 chỉ chạm
// `fund_entry_approvals`, nên không trigger nào trên `fund_entries` chạy, và
// ràng buộc bảo vệ tiền của Hội bị gỡ TRONG IM LẶNG. `ALTER DEFAULT PRIVILEGES`
// ở migration 002 lại đã cấp sẵn `DELETE`.
//
// Hai lớp, và bài này canh RIÊNG từng lớp:
//   * REVOKE UPDATE, DELETE — chặn đường app_role;
//   * trg_fund_sig_guard trên CHÍNH bảng chữ ký — chặn cả đường owner/psql.
// Chỉ có lớp một thì bất kỳ script vận hành nào chạy bằng owner cũng gỡ được.
//
// BẪY CÔNG CỤ (Ruling T8-g): dạng giao dịch THỦ CÔNG của knex làm MẤT thông
// điệp lỗi của lệnh COMMIT — mà ràng buộc hoãn là loại lỗi DUY NHẤT chỉ xuất
// hiện ở COMMIT. Mọi bài dưới đây dùng dạng callback `db.transaction(async trx
// => …)`, dạng reject đúng và giữ nguyên tên ràng buộc.
// ---------------------------------------------------------------------------

let db, cid, treasurer, approverA, approverB, nguoiThuong, entry;

const BIG = 2000000;

async function mkMember(name, roleKey = null) {
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
    [cid, name]);
  if (roleKey) {
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id)
       SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`, [m.id, cid, roleKey]);
  }
  return m.id;
}

/** Ghi một bút toán lớn kèm N chữ ký trong CÙNG một giao dịch (dạng callback). */
async function writeEntry(signers, amount = BIG) {
  return db.transaction(async (trx) => {
    const { rows: [e] } = await trx.raw(
      `INSERT INTO fund_entries (community_id, amount, purpose, created_by)
       VALUES (?,?,?,?) RETURNING id`, [cid, -amount, 'Chi ho tro', treasurer]);
    for (const s of signers) {
      await trx.raw(
        `INSERT INTO fund_entry_approvals (entry_id, approver_id, community_id) VALUES (?,?,?)`,
        [e.id, s, cid]);
    }
    return e.id;
  });
}

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t13-fund-sig','Hoi') RETURNING id`));
  treasurer = await mkMember('Thu Quy', 'approver');
  approverA = await mkMember('Nguoi Duyet A', 'approver');
  approverB = await mkMember('Nguoi Duyet B', 'approver');
  nguoiThuong = await mkMember('Thanh Vien Thuong');

  entry = await writeEntry([approverA, approverB]);
});

afterAll(async () => { await db.destroy(); });

describe('T13 lớp 1 — app_role không gỡ được chữ ký', () => {
  it('DELETE bị từ chối ở tầng quyền', async () => {
    const app = appKnex();
    try {
      await expect(app.raw(`DELETE FROM fund_entry_approvals WHERE entry_id = ?`, [entry]))
        .rejects.toThrow(/permission denied/i);
    } finally { await app.destroy(); }
  });

  it('UPDATE cũng bị từ chối — đổi approver_id là gỡ chữ ký bằng cách khác', async () => {
    const app = appKnex();
    try {
      await expect(app.raw(
        `UPDATE fund_entry_approvals SET approver_id = ? WHERE entry_id = ?`, [nguoiThuong, entry]))
        .rejects.toThrow(/permission denied/i);
    } finally { await app.destroy(); }
  });
});

describe('T13 lớp 2 — owner gỡ chữ ký cũng bị chặn lúc COMMIT', () => {
  it('xoá một trong hai chữ ký ⇒ COMMIT hỏng với FUND_TWO_APPROVERS_REQUIRED', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `DELETE FROM fund_entry_approvals WHERE entry_id = ? AND approver_id = ?`,
        [entry, approverB]);
    })).rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);

    // ...và chữ ký VẪN CÒN sau khi giao dịch cuộn — đây mới là điều cần chứng
    // minh. Bắt được ngoại lệ mà dữ liệu vẫn hỏng thì ngoại lệ đó vô nghĩa.
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM fund_entry_approvals WHERE entry_id = ?`, [entry]);
    expect(n).toBe(2);
  });

  it('xoá CẢ HAI chữ ký cũng hỏng — không có đường vòng bằng cách xoá sạch', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(`DELETE FROM fund_entry_approvals WHERE entry_id = ?`, [entry]);
    })).rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });

  it('đổi approver thành người KHÔNG có vai approver cũng hỏng', async () => {
    await expect(db.transaction(async (trx) => {
      await trx.raw(
        `UPDATE fund_entry_approvals SET approver_id = ? WHERE entry_id = ? AND approver_id = ?`,
        [nguoiThuong, entry, approverB]);
    })).rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });

  it('thay MỘT approver bằng approver khác thì được — bài trên không đỏ vì lý do sai', async () => {
    // Đối chứng bắt buộc: nếu trigger cấm mọi thay đổi thì bốn bài trên xanh
    // mà không chứng minh được là nó đang đếm chữ ký HỢP LỆ.
    const approverC = await mkMember('Nguoi Duyet C', 'approver');
    await db.transaction(async (trx) => {
      await trx.raw(
        `UPDATE fund_entry_approvals SET approver_id = ? WHERE entry_id = ? AND approver_id = ?`,
        [approverC, entry, approverB]);
    });
    const { rows: [{ n }] } = await db.raw(
      `SELECT count(*)::int AS n FROM fund_entry_approvals WHERE entry_id = ? AND approver_id = ?`,
      [entry, approverC]);
    expect(n).toBe(1);
    // trả lại hiện trạng cho các bài sau
    await db.transaction(async (trx) => {
      await trx.raw(
        `UPDATE fund_entry_approvals SET approver_id = ? WHERE entry_id = ? AND approver_id = ?`,
        [approverB, entry, approverC]);
    });
  });
});

describe('T13 chữ ký nào được tính', () => {
  it('bút toán lớn với 1 chữ ký không COMMIT được', async () => {
    await expect(writeEntry([approverA])).rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });

  it('người tạo tự ký không được tính', async () => {
    await expect(writeEntry([treasurer, approverA]))
      .rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });

  it('người không có vai approver không được tính', async () => {
    await expect(writeEntry([approverA, nguoiThuong]))
      .rejects.toThrow(/FUND_TWO_APPROVERS_REQUIRED/);
  });

  it('approver của CỘNG ĐỒNG KHÁC không ký được — mã mẫu đặc tả thiếu vế này', async () => {
    // Mã mẫu ở mục 4.5 và 4.8 join member_roles mà KHÔNG lọc community_id. Hậu
    // quả: người mang vai approver ở cộng đồng B ký hợp lệ cho bút toán của
    // cộng đồng A. Ở đây khoá ngoại ghép chặn từ lúc GHI, chứ không phải lúc đếm.
    const { rows: [{ id: cidKhac }] } = await db.raw(
      `INSERT INTO communities (code,name) VALUES ('t13-fund-khac','Khac') RETURNING id`);
    const { rows: [nguoiLa] } = await db.raw(
      `INSERT INTO members (community_id, full_name, status) VALUES (?,?, 'member') RETURNING id`,
      [cidKhac, 'Approver Cong Dong Khac']);
    await db.raw(
      `INSERT INTO member_roles (member_id, role_id, community_id)
       SELECT ?, r.id, ? FROM roles r WHERE r.key = 'approver'`, [nguoiLa.id, cidKhac]);

    // Chặn bởi khoá ngoại GHÉP, ngay lúc GHI — đã kiểm bằng probe chạy thật:
    // SQLSTATE 23503, constraint fund_entry_approvals_approver_id_community_id_fkey.
    // Khai community_id = cộng đồng B thay vì A cũng không lách được: khoá ngoại
    // (entry_id, community_id) -> fund_entries đóng nốt chiều còn lại.
    await expect(writeEntry([approverA, nguoiLa.id]))
      .rejects.toThrow(/fund_entry_approvals_approver_id_community_id_fkey/);
  });

  it('bút toán NHỎ không cần chữ ký nào — ngưỡng có thật, không phải cấm cửa', async () => {
    const small = await writeEntry([], 500000);
    expect(small).toBeTruthy();
  });
});
