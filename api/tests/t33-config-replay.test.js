import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetDb } from './helpers/db.js';
import { twoSignedAction, markExecuted } from './helpers/twoPerson.js';

// ---------------------------------------------------------------------------
// T33 — PHÁT LẠI một quyết định đổi `communities.config` đã thi hành.
//
// Soát xét độc lập Task 16 mục B4.3 tái hiện được kịch bản dưới đây bằng chạy
// thật: hai chữ ký của hành động A là THẬT, nhưng không ai kiểm THỜI ĐIỂM thi
// hành, nên một người trong hai người ấy — một mình, không một chữ ký mới nào —
// quay ngược được cấu hình về A sau khi B đã thay thế nó.
//
// Migration 028 hỏi "hành động này có đủ hai chữ ký không". Nó không hỏi "hành
// động này đã tiêu chưa". Câu hỏi thứ hai được trả lời ở tầng ứng dụng, bằng
// đúng một câu `UPDATE … status='executed'` trong `core/twoPerson.js` — mà cửa
// kia của CHÍNH migration 028 (`guarantee.quota_override`) trả lời bằng một
// ràng buộc dữ liệu (`gqo_one_row_per_action UNIQUE`). Migration 033 đưa cửa
// cấu hình về cùng một mức chặt.
//
// Ba bài đầu là kịch bản tái hiện, dựng lại đúng ba bước. Các bài sau canh
// những đường vòng quanh bản vá, và vế CHO PHÉP — một cánh cổng chặn tất cả
// cũng là một cánh cổng hỏng.
// ---------------------------------------------------------------------------

let db, cid;

const asActor = (actorId, fn) =>
  db.transaction(async (trx) => {
    await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [actorId ?? '']);
    return fn(trx);
  });

const apply = (actorId, actionId) =>
  asActor(actorId, (trx) => trx.raw(`SELECT fn_community_config_apply(?)`, [actionId]));

const doc = async () => {
  const { rows: [c] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
  return c.config;
};

/** Một hành động đổi cấu hình đủ hai chữ ký, CHƯA thi hành. */
const soanQuyetDinh = async (config) =>
  twoSignedAction(db, cid, {
    actionKey: 'community.config_change',
    targetType: 'community',
    targetId: cid,
    payload: { config },
  });

beforeAll(async () => {
  db = await resetDb();
  ({ rows: [{ id: cid }] } = await db.raw(
    `INSERT INTO communities (code,name) VALUES ('t33','Hoi T33') RETURNING id`
  ));
});

afterAll(async () => { await db.destroy(); });

// ===========================================================================
describe('T33 kịch bản tái hiện — ba bước, đúng như bản soát xét đo được', () => {
  let A, B, cauHinhA;

  it('bước 1: A đủ hai chữ ký, thi hành được, và KHÔNG ai đánh dấu nó', async () => {
    const truoc = await doc();
    cauHinhA = { ...truoc, fund_two_approver_threshold: 99000000 };
    A = await soanQuyetDinh(cauHinhA);

    await apply(A.creator, A.id);
    expect((await doc()).fund_two_approver_threshold).toBe(99000000);

    // Đúng chỗ hở: tầng ứng dụng KHÔNG chạy câu `UPDATE … status='executed'`.
    const { rows: [pa] } = await db.raw(`SELECT status FROM pending_actions WHERE id = ?`, [A.id]);
    expect(pa.status, 'A vẫn nằm chờ — đây là tiền đề của kịch bản, không phải lỗi của bài test').toBe('pending');
  });

  it('bước 2: B đi ĐÚNG quy trình và thay thế A', async () => {
    const truoc = await doc();
    B = await soanQuyetDinh({ ...truoc, fund_two_approver_threshold: 1000000 });

    await apply(B.creator, B.id);
    await markExecuted(db, B.id, {});
    expect((await doc()).fund_two_approver_threshold).toBe(1000000);
  });

  it('bước 3: phát lại A — MỘT người, không chữ ký mới — nay HỎNG', async () => {
    await expect(apply(A.creator, A.id)).rejects.toThrow(/CONFIG_CHANGE_ALREADY_APPLIED/);
    expect(
      (await doc()).fund_two_approver_threshold,
      'cấu hình phải đứng nguyên ở quyết định B'
    ).toBe(1000000);
  });

  it('bước 3b: đi vòng qua hàm — `UPDATE communities` trần bằng owner cũng hỏng', async () => {
    // Vì sao bài này tồn tại: Ruling T10-a nói `REVOKE` không đỡ được một hàm
    // `SECURITY DEFINER` THỨ HAI. Nếu luật "một lần" chỉ nằm trong
    // `fn_community_config_apply` thì hàm thứ hai ấy đi vòng qua được. Đây là
    // đường của hàm thứ hai, và luật phải chặn ở trigger.
    await expect(
      db.raw(`UPDATE communities SET config = ?::jsonb WHERE id = ?`, [JSON.stringify(cauHinhA), cid])
    ).rejects.toThrow(/CONFIG_CHANGE_ALREADY_APPLIED/);
    expect((await doc()).fund_two_approver_threshold).toBe(1000000);
  });

  it('bước 3c: gỡ dấu "đã tiêu" để phát lại — cũng hỏng', async () => {
    // `app_role` có sẵn quyền `UPDATE` trên `pending_actions`, nên nếu dấu ấy
    // gỡ được thì bản vá chỉ tốn của người khai thác thêm một câu lệnh.
    await expect(
      db.raw(`UPDATE pending_actions SET consumed_at = NULL WHERE id = ?`, [A.id])
    ).rejects.toThrow(/CONFIG_CHANGE_ALREADY_APPLIED/);
    await expect(
      db.raw(`UPDATE pending_actions SET consumed_at = now() - interval '1 day' WHERE id = ?`, [A.id])
    ).rejects.toThrow(/CONFIG_CHANGE_ALREADY_APPLIED/);
  });
});

// ===========================================================================
describe('T33 gọi apply hai lần liên tiếp cùng một hành động', () => {
  it('lần thứ hai hỏng, dù không có gì xen giữa và cấu hình ghi ra y hệt', async () => {
    // Ca này trigger KHÔNG tự thấy: lần gọi thứ hai ghi đúng giá trị đang có,
    // nên `NEW.config IS NOT DISTINCT FROM OLD.config` và trigger trả về ngay.
    // Nếu hàm không tự hỏi thì lần gọi thứ hai trả về "chạy rồi" — một lời nói
    // dối nhỏ dạy người viết tầng trên rằng phát lại là chuyện bình thường.
    const truoc = await doc();
    const C = await soanQuyetDinh({ ...truoc, manual_pair_quota: 7 });

    await apply(C.creator, C.id);
    expect((await doc()).manual_pair_quota).toBe(7);

    await expect(apply(C.creator, C.id)).rejects.toThrow(/CONFIG_CHANGE_ALREADY_APPLIED/);
    expect((await doc()).manual_pair_quota).toBe(7);
  });

  it('cả người ký thứ hai cũng không phát lại được', async () => {
    const truoc = await doc();
    const D = await soanQuyetDinh({ ...truoc, manual_pair_quota: 8 });
    await apply(D.creator, D.id);
    await expect(apply(D.second, D.id)).rejects.toThrow(/CONFIG_CHANGE_ALREADY_APPLIED/);
  });
});

// ===========================================================================
describe('T33 cánh cổng vẫn mở cho việc hợp lệ', () => {
  it('một quyết định MỚI đủ hai chữ ký vẫn đổi được cấu hình', async () => {
    const truoc = await doc();
    const E = await soanQuyetDinh({ ...truoc, fund_two_approver_threshold: 2500000 });
    await apply(E.creator, E.id);
    await markExecuted(db, E.id, {});
    expect((await doc()).fund_two_approver_threshold).toBe(2500000);
  });

  it('quay lại một giá trị CŨ vẫn được — nếu có hai chữ ký mới cho nó', async () => {
    // Bản vá chặn phát lại một QUYẾT ĐỊNH, không chặn một GIÁ TRỊ. Nhầm hai
    // thứ này sẽ khoá vĩnh viễn mọi con số đã từng dùng.
    const truoc = await doc();
    const F = await soanQuyetDinh({ ...truoc, fund_two_approver_threshold: 1000000 });
    await apply(F.creator, F.id);
    await markExecuted(db, F.id, {});
    expect((await doc()).fund_two_approver_threshold).toBe(1000000);
  });

  it('mã cũ không bị mã mới nuốt: chưa đủ chữ ký vẫn là CONFIG_CHANGE_UNSIGNED', async () => {
    const truoc = await doc();
    const { rows: [pa] } = await db.raw(
      `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
       SELECT ?, 'community.config_change', 'community', ?, ?::jsonb, 'hash-t33-mot-chu-ky', mr.member_id
         FROM member_roles mr JOIN roles r ON r.id = mr.role_id
        WHERE mr.community_id = ? AND r.key = 'approver' LIMIT 1
       RETURNING id, created_by`,
      [cid, cid, JSON.stringify({ ...truoc, manual_pair_quota: 99 }), cid]
    );
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, 'hash-t33-mot-chu-ky')`,
      [pa.id, pa.created_by, cid]
    );
    await expect(apply(pa.created_by, pa.id)).rejects.toThrow(/CONFIG_CHANGE_UNSIGNED/);
  });
});
