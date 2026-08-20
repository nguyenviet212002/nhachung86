import { knex } from '../../db/knex.js';
import { withActor } from '../../core/tx.js';
import { log as auditLog, verifyChain } from '../../core/audit.js';

// ===========================================================================
// VẬN HÀNH — nhật ký, bảng điều khiển, vai (đặc tả mục 5.3 bảng "Vận hành",
// mục 4.6, mục 9, mục 7.4).
//
// MỘT LUẬT CHUNG CHO CẢ TỆP: `audit_log` CHỈ ĐỌC. Không hàm nào ở đây viết
// `UPDATE`/`DELETE` lên nó, và không viết được kể cả nếu ai đó thử —
// migration 007 `REVOKE UPDATE, DELETE`, và `fn_audit_new_partition` lặp lại
// đúng hai quyền ấy cho từng phân mảnh. `t27` khẳng định cả hai đầu: không
// route nào sửa được, VÀ `app_role` không sửa được bằng SQL trần.
// ===========================================================================

// Ngưỡng cảnh báo. Đọc từ `communities.config` nếu có, mặc định ở đây nếu
// không — cùng khuôn `fn_fund_threshold` (020) và `fn_guarantee_quota` (009).
// Từ migration 028, `config` chỉ đổi được qua khung hai người ký, nên đây là
// những con số mà cộng đồng chỉnh được mà không phải sửa mã, và không ai
// chỉnh được một mình.
const DEFAULTS = {
  // Mục 4.6: "bảng > 5 GB, hoặc số dòng/ngày vượt 5 lần trung bình 30 ngày".
  audit_log_size_alert_bytes: 5 * 1024 * 1024 * 1024,
  audit_rows_spike_factor: 5,
  // Mục 9 điểm 3: "bảng điều khiển nêu cờ khi `contact.denied` của một người
  // vượt ngưỡng". Đặc tả không cho con số; 20 lượt bị từ chối trong 30 ngày ở
  // một cộng đồng 52 người là một người đang gõ cửa nhà gần như tất cả mọi
  // người và bị từ chối — đúng hình dạng cần một đôi mắt nhìn vào.
  contact_denied_alert_per_30d: 20,
  // Mục 9 (bảng điều khiển tỷ lệ manual) + mục 4.4: `manual` là cửa đúc bậc
  // uy tín. Quá nửa số việc đến từ đường thủ công là dấu hiệu cần xem lại.
  manual_ratio_alert: 0.5,
};

async function thresholds(trx, communityId) {
  const { rows: [c] } = await trx.raw(`SELECT config FROM communities WHERE id = ?`, [communityId]);
  const cfg = c?.config ?? {};
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = Number(cfg[k]);
    if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// GET /ops/audit-log — approver, tech. Lọc + phân trang.
//
// `ip` KHÔNG ra tới client, và đó là một quyết định chứ không phải một chỗ
// quên. Địa chỉ IP là dữ liệu cá nhân theo mục 10, còn đây là một cửa đọc
// HÀNG LOẠT: một trang 100 dòng là 100 địa chỉ của những người không hề biết
// mình đang bị đọc. Người vận hành cần con số tổng hợp (cảnh báo "hai chữ ký
// cùng IP" ở bảng điều khiển) chứ không cần danh sách IP thô, nên bảng điều
// khiển trả CỜ, không trả địa chỉ.
//
// `detail` thì ra được, vì `assertSafeDetail` (mục 10) đã bảo đảm nó chỉ chứa
// định danh, enum, tên trường và số đếm.
// ---------------------------------------------------------------------------
export async function listAuditLog({ actor, actorId = null, action = null, from = null, to = null, page = 1, limit = 20 }) {
  const offset = (page - 1) * limit;

  return withActor(actor.id, async (trx) => {
    const where = `
        WHERE a.community_id = ?
          AND (?::uuid IS NULL      OR a.actor_id = ?::uuid)
          AND (?::text IS NULL      OR a.action   = ?::text)
          AND (?::timestamptz IS NULL OR a.at >= ?::timestamptz)
          AND (?::timestamptz IS NULL OR a.at <= ?::timestamptz)`;
    const args = [actor.communityId, actorId, actorId, action, action, from, from, to, to];

    // ORDER BY seq DESC, không phải `at` DESC: `seq` là thứ tự THẬT của chuỗi
    // băm, còn `at` do `clock_timestamp()` đặt và hai dòng có thể trùng đến
    // micro-giây. Sắp theo thứ tự chuỗi thì trang hiển thị khớp đúng thứ tự
    // mà `verifyChain` duyệt.
    const { rows } = await trx.raw(
      `SELECT a.seq, a.at, a.actor_id, m.full_name AS actor_name,
              a.action, a.target_type, a.target_id, a.detail
         FROM audit_log a
         LEFT JOIN members m ON m.id = a.actor_id AND m.community_id = a.community_id
         ${where}
        ORDER BY a.seq DESC
        LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );
    const { rows: [{ total }] } = await trx.raw(
      `SELECT count(*)::int AS total FROM audit_log a ${where}`, args
    );

    // Bảng mục 5.3 cột Log: `audit.read`. Ghi CHÍNH bộ lọc, vì "ai đã đọc
    // nhật ký của ai" là câu hỏi mà bản thân nhật ký phải trả lời được.
    // `action` không ghi nguyên văn — nó là chuỗi người dùng gõ (cùng lập
    // luận `has_q`/`has_job` của `member.list`, mục 5.3).
    const detail = { count: rows.length, page, has_action_filter: action !== null };
    if (actorId) detail.filter_actor_id = actorId;
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'audit.read', targetType: null, targetId: null, detail,
    });

    return { data: rows, meta: { page, limit, total } };
  });
}

// ---------------------------------------------------------------------------
// GET /ops/audit-log/verify — chạy lại toàn bộ chuỗi băm.
//
// `verifyChain` chạy NGOÀI giao dịch ghi nhật ký, và có lý do: nó đọc mọi
// hàng trong khoảng, còn dòng `audit.verified` mà ta sắp ghi sẽ trở thành một
// hàng mới. Ghi trước rồi kiểm là tự đưa hàng của mình vào phép kiểm; kiểm
// trước rồi ghi cho ra một con số nói về trạng thái TRƯỚC lời gọi này, đúng
// thứ người vận hành hỏi.
// ---------------------------------------------------------------------------
export async function verifyAuditChain({ actor, from = null, to = null }) {
  const result = await verifyChain(knex, { communityId: actor.communityId, from, to });

  await withActor(actor.id, (trx) =>
    auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'audit.verified', targetType: null, targetId: null,
      detail: { ok: result.ok, checked: result.checked },
    })
  );

  return { ok: result.ok, checked: result.checked, broken_at: result.brokenAt };
}

// ---------------------------------------------------------------------------
// GET /ops/dashboard — bốn cảnh báo của mục 4.6 và mục 9, cộng một tín hiệu
// của mục 7.4 lớp 3.
//
// KHÔNG `ORDER BY` theo con số của con người — nguyên tắc 5. Danh sách bị nêu
// cờ sắp theo TÊN, không theo mức độ: nền tảng này không xếp hạng người, kể
// cả xếp hạng "ai đáng ngờ nhất". Ngưỡng quyết định ai vào danh sách; thứ tự
// trong danh sách không mang thông tin nào.
// ---------------------------------------------------------------------------
export async function dashboard({ actor }) {
  // (1) Kích thước bảng nhật ký. Toàn cụm, không theo cộng đồng — đây là con
  //     số vận hành về đĩa, không phải về một cộng đồng. Không đọc được thì
  //     trả `null`, KHÔNG đoán một con số (đúng luật Ruling T1-a của
  //     `/health`: im lặng còn hơn nói dối).
  //
  //     CHẠY NGOÀI GIAO DỊCH, và đây là BẪY 2 của đề bài chứ không phải một
  //     lựa chọn về phong cách: `try/catch` quanh một câu SQL hỏng KHÔNG cứu
  //     được gì bên trong một giao dịch — PostgreSQL nhiễm độc cả giao dịch
  //     (`current transaction is aborted`), nên mọi câu sau đó cùng hỏng và
  //     người dùng nhận HTTP 500 thay vì bảng điều khiển. Muốn bắt lỗi trong
  //     giao dịch thì phải bọc SAVEPOINT; ở đây câu này không cần giao dịch
  //     nào cả, nên đưa hẳn ra ngoài là bản vá rẻ hơn và ít chỗ sai hơn.
  let sizeBytes = null;
  try {
    const { rows: [s] } = await knex.raw(`SELECT pg_total_relation_size('audit_log')::bigint AS n`);
    sizeBytes = Number(s.n);
  } catch { sizeBytes = null; }

  return withActor(actor.id, async (trx) => {
    const th = await thresholds(trx, actor.communityId);

    // (2) Số dòng hôm nay so trung bình 30 ngày trước đó.
    const { rows: [vol] } = await trx.raw(
      `SELECT
         (SELECT count(*)::int FROM audit_log
           WHERE community_id = ? AND at >= date_trunc('day', now())) AS rows_today,
         (SELECT round(count(*)::numeric / 30, 2) FROM audit_log
           WHERE community_id = ? AND at >= date_trunc('day', now()) - interval '30 days'
             AND at < date_trunc('day', now())) AS rows_avg_30d`,
      [actor.communityId, actor.communityId]
    );
    const avg30 = Number(vol.rows_avg_30d ?? 0);

    // (3) `contact.denied` theo người, 30 ngày.
    const { rows: denied } = await trx.raw(
      `SELECT a.actor_id AS member_id, m.full_name, count(*)::int AS denied_count
         FROM audit_log a
         JOIN members m ON m.id = a.actor_id AND m.community_id = a.community_id
        WHERE a.community_id = ? AND a.action = 'contact.denied'
          AND a.at >= now() - interval '30 days'
        GROUP BY a.actor_id, m.full_name
       HAVING count(*) >= ?
        ORDER BY m.full_name`,
      [actor.communityId, th.contact_denied_alert_per_30d]
    );

    // (4) Tỷ lệ manual / confirmed theo người.
    //     `greatest(confirmed_works, 1)` để không chia cho 0; người có 3 việc
    //     manual và 0 việc confirmed cho ra tỷ lệ 3.0, tức nổi bật đúng như
    //     phải thế.
    const { rows: manual } = await trx.raw(
      `SELECT s.member_id, m.full_name, s.manual_works, s.confirmed_works,
              round(s.manual_works::numeric / greatest(s.confirmed_works, 1), 2) AS ratio
         FROM member_trust_stats s
         JOIN members m ON m.id = s.member_id AND m.community_id = s.community_id
        WHERE s.community_id = ? AND s.manual_works > 0
          AND s.manual_works::numeric / greatest(s.confirmed_works, 1) >= ?
        ORDER BY m.full_name`,
      [actor.communityId, th.manual_ratio_alert]
    );

    // (5) Mục 7.4 lớp 3: hai chữ ký của cùng một hành động đến từ cùng một IP.
    //     Trả ID hành động, KHÔNG trả địa chỉ — người trực cần biết "việc nào
    //     đáng nhìn lại", không cần biết địa chỉ. Đặc tả nói rõ đây là TÍN
    //     HIỆU ĐỂ NGƯỜI XEM XÉT, không phải rào chặn tự động: một cặp vợ chồng
    //     cùng nhà cũng chung IP.
    const { rows: sameIp } = await trx.raw(
      `SELECT s.pending_action_id
         FROM pending_action_signatures s
        WHERE s.community_id = ?  AND s.ip IS NOT NULL
        GROUP BY s.pending_action_id, s.ip
       HAVING count(*) >= 2`,
      [actor.communityId]
    );

    const out = {
      audit_log: {
        size_bytes: sizeBytes,
        size_alert: sizeBytes !== null && sizeBytes > th.audit_log_size_alert_bytes,
        rows_today: vol.rows_today,
        rows_avg_30d: avg30,
        spike_alert: avg30 > 0 && vol.rows_today > avg30 * th.audit_rows_spike_factor,
      },
      contact_denied: { threshold: th.contact_denied_alert_per_30d, flagged: denied },
      manual_ratio: { threshold: th.manual_ratio_alert, flagged: manual },
      two_person_same_ip: { action_ids: sameIp.map((r) => r.pending_action_id) },
    };

    // Bảng mục 5.3 ghi `—` cho các cửa đọc thuần (vd. `/ops/pending-actions`),
    // nhưng cửa này KHÁC: nó nêu đích danh những người bị gắn cờ. Đọc một
    // danh sách người đang bị nghi ngờ là một hành vi phải đếm được, nên nó
    // để lại dấu — chỉ số đếm, không tên ai (luật mục 10).
    await auditLog(trx, {
      communityId: actor.communityId, actorId: actor.id,
      action: 'ops.dashboard.read', targetType: null, targetId: null,
      detail: {
        flagged_contact_denied: denied.length,
        flagged_manual_ratio: manual.length,
        flagged_same_ip: sameIp.length,
      },
    });

    return out;
  });
}

// ---------------------------------------------------------------------------
// GET /ops/permissions — "mọi vai" (mục 5.3). Ma trận quyền CỦA CHÍNH NGƯỜI
// GỌI, không phải của cả hệ thống: hỏi "tôi làm được gì" là hợp lệ với mọi
// người; hỏi "ai làm được gì" là một bản đồ tổ chức, và nó thuộc `/ops/roles`.
// ---------------------------------------------------------------------------
export async function myPermissions({ actor }) {
  const { rows } = await knex.raw(
    `SELECT DISTINCT p.key, p.name, p.description
       FROM member_roles mr
       JOIN role_permissions rp ON rp.role_id = mr.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE mr.member_id = ? AND mr.community_id = ?
      ORDER BY p.key`,
    [actor.id, actor.communityId]
  );
  return { roles: [...actor.roles].sort(), permissions: rows };
}

// ---------------------------------------------------------------------------
// Vai — ba cửa, tất cả đòi quyền `ops.role.manage` (chỉ vai `tech`).
//
// Ba hàm dưới KHÔNG phải nơi giữ luật. `fn_role_grant`/`fn_role_revoke`
// (migration 029) tự kiểm đủ, và `trg_member_role_guard` chặn cả một hàm
// SECURITY DEFINER thứ hai viết ở task sau. Ở đây chỉ có một việc: dịch mã
// lỗi CSDL thành câu tiếng Việt — và điều đó do `mapPgError` làm.
// ---------------------------------------------------------------------------
export async function listRoles({ actor }) {
  const { rows } = await knex.raw(
    `SELECT r.key AS role, m.id AS member_id, m.full_name
       FROM roles r
       LEFT JOIN member_roles mr ON mr.role_id = r.id AND mr.community_id = ?
       LEFT JOIN members m ON m.id = mr.member_id AND m.community_id = mr.community_id
      ORDER BY r.key, m.full_name`,
    [actor.communityId]
  );
  const byRole = new Map();
  for (const r of rows) {
    if (!byRole.has(r.role)) byRole.set(r.role, []);
    if (r.member_id) byRole.get(r.role).push({ member_id: r.member_id, full_name: r.full_name });
  }
  return { data: [...byRole.entries()].map(([role, members]) => ({ role, members })) };
}

export async function grantRole({ actor, memberId, role }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [r] } = await trx.raw(`SELECT fn_role_grant(?, ?) AS changed`, [memberId, role]);
    return { member_id: memberId, role, granted: r.changed === true };
  });
}

export async function revokeRole({ actor, memberId, role }) {
  return withActor(actor.id, async (trx) => {
    const { rows: [r] } = await trx.raw(`SELECT fn_role_revoke(?, ?) AS changed`, [memberId, role]);
    return { member_id: memberId, role, revoked: r.changed === true };
  });
}

// Xuất ra để `t27` đọc được ngưỡng mặc định thay vì chép lại con số — bài test
// chép số là bài test sẽ xanh khi số bị đổi.
export { DEFAULTS as DASHBOARD_DEFAULTS };

