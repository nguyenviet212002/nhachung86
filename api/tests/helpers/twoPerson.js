// Trợ giúp dựng dữ liệu cho các bài test cần một hành động ĐÃ QUA khung hai
// người ký (migration 022 + 028).
//
// Vì sao phải có tệp này: từ migration 028, `communities.config` và
// `guarantee_quota_overrides` không còn sửa được bằng một câu `UPDATE`/`INSERT`
// trần — kể cả bằng kết nối owner. Đó chính là bản vá của chỗ hở #22 và #20
// trong `docs/RANG-BUOC.md`. Bài test nào cần đổi chính sách thì phải đi đúng
// con đường mà người thật sẽ đi, và việc dựng lại con đường ấy ở mỗi tệp test
// là ba lần chép cùng một đoạn — tức ba lần trôi dạt.
//
// Các hàm ở đây dùng kết nối OWNER (không phải `app_role`): chúng là phần DỰNG
// DỮ LIỆU, không phải phần cần chứng minh. Bài nào muốn chứng minh khung ký
// hoạt động thì gọi thẳng `core/twoPerson.js` qua HTTP hoặc service —
// `t25-two-person.test.js` làm đúng việc đó.

let seq = 0;

/** Tạo một thành viên mang một vai, trả về id. */
export async function mkRoleMember(db, cid, key, name) {
  seq += 1;
  const { rows: [m] } = await db.raw(
    `INSERT INTO members (community_id, full_name, status) VALUES (?, ?, 'member') RETURNING id`,
    [cid, name ?? `Nguoi vai ${key} ${seq}`]
  );
  await db.raw(
    `INSERT INTO member_roles (member_id, role_id, community_id)
     SELECT ?, r.id, ? FROM roles r WHERE r.key = ?`,
    [m.id, cid, key]
  );
  return m.id;
}

/**
 * Dựng một `pending_actions` đã đủ hai chữ ký nhưng CHƯA thi hành.
 * Trả về `{ id, creator, second }`.
 *
 * `payloadHash` ở đây là một chuỗi bất kỳ: `fn_pending_action_signatures` chỉ
 * so BẰNG NHAU giữa `payload_hash_at_sign` và `payload_hash`. Việc băm đúng nội
 * dung là luật của tầng ứng dụng (`computePayloadHash`), và nó có bài riêng.
 */
export async function twoSignedAction(db, cid, { actionKey, targetType = null, targetId = null, payload = {}, creator, second }) {
  const role = { 'contacts.export': 'tech', 'backup.restore': 'tech' }[actionKey] ?? 'approver';
  const a = creator ?? (await mkRoleMember(db, cid, role));
  const b = second ?? (await mkRoleMember(db, cid, role));
  const hash = `hash-${seq}-${Math.random().toString(16).slice(2)}`;

  const { rows: [pa] } = await db.raw(
    `INSERT INTO pending_actions (community_id, action_key, target_type, target_id, payload, payload_hash, created_by)
     VALUES (?, ?, ?, ?, ?::jsonb, ?, ?) RETURNING id`,
    [cid, actionKey, targetType, targetId, JSON.stringify(payload), hash, a]
  );
  for (const signer of [a, b]) {
    await db.raw(
      `INSERT INTO pending_action_signatures (pending_action_id, signer_id, community_id, payload_hash_at_sign)
       VALUES (?, ?, ?, ?)`,
      [pa.id, signer, cid, hash]
    );
  }
  return { id: pa.id, creator: a, second: b };
}

/** Đánh dấu một hành động đã thi hành (sau khi phần việc của nó đã chạy xong). */
export async function markExecuted(db, id, result = {}) {
  await db.raw(
    `UPDATE pending_actions SET status = 'executed', executed_at = now(), result = ?::jsonb WHERE id = ?`,
    [JSON.stringify(result), id]
  );
}

/**
 * Đổi `communities.config` đúng con đường hợp lệ duy nhất: một hành động
 * `community.config_change` đủ hai chữ ký, `payload->'config'` là TOÀN BỘ
 * config mới, rồi `fn_community_config_apply`.
 */
export async function applyConfig(db, cid, newConfig) {
  const { id } = await twoSignedAction(db, cid, {
    actionKey: 'community.config_change',
    targetType: 'community',
    targetId: cid,
    payload: { config: newConfig },
  });
  await db.raw(`SELECT fn_community_config_apply(?)`, [id]);
  await markExecuted(db, id, { config: newConfig });
  return id;
}

/** Đọc config hiện thời rồi ghi đè một vài khoá, qua đúng khung hai người ký. */
export async function patchConfig(db, cid, patch) {
  const { rows: [c] } = await db.raw(`SELECT config FROM communities WHERE id = ?`, [cid]);
  const next = { ...c.config };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return applyConfig(db, cid, next);
}

/** Nới hạn mức bảo lãnh qua khung hai người ký (chỗ hở #20). */
export async function grantQuotaOverride(db, cid, { referrerId, extraSlots = 1, reason = 'truong hop dac biet', validUntilSql = `now() + interval '1 day'` }) {
  const { id, creator } = await twoSignedAction(db, cid, {
    actionKey: 'guarantee.quota_override',
    targetType: 'member',
    targetId: referrerId,
    payload: { extra_slots: extraSlots, reason },
  });
  const { rows: [ov] } = await db.transaction(async (trx) => {
    const r = await trx.raw(
      `INSERT INTO guarantee_quota_overrides
         (community_id, referrer_id, extra_slots, reason, granted_by, valid_until, pending_action_id)
       VALUES (?, ?, ?, ?, ?, ${validUntilSql}, ?) RETURNING id`,
      [cid, referrerId, extraSlots, reason, creator, id]
    );
    await trx.raw(
      `UPDATE pending_actions SET status = 'executed', executed_at = now(), result = '{}'::jsonb WHERE id = ?`,
      [id]
    );
    return r;
  });
  return { overrideId: ov.id, actionId: id };
}
