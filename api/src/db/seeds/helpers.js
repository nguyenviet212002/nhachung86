/**
 * Ba cách ghi của dữ liệu mẫu, và LÝ DO phải có ba chứ không phải một.
 *
 * Đặc tả mục 12.1 nói "mỗi lệnh ghi là INSERT … ON CONFLICT (id) DO UPDATE".
 * Đúng cho phần lớn bảng. Nhưng dự án này có một họ bảng ĐÓNG BĂNG SAU KHI
 * DÙNG, và với chúng câu trên không chạy được — không phải vì bất tiện mà vì
 * đúng ràng buộc ta muốn giữ:
 *
 *   * `work_participants` có `trg_work_participants_frozen`, một trigger BEFORE
 *     INSERT OR UPDATE OR DELETE. PostgreSQL chạy trigger BEFORE INSERT TRƯỚC
 *     khi phát hiện xung đột, nên `ON CONFLICT` không cứu được: lần chạy thứ
 *     hai ném `WORK_PARTICIPANTS_FROZEN` ngay ở hàng đầu tiên. Đó là ràng buộc
 *     đang làm đúng việc của nó (danh sách người tham gia không đổi sau khi đã
 *     có xác nhận), không phải chướng ngại cần gỡ.
 *   * `fund_entries` đã `locked` thì `trg_fund_entry_locked` chặn MỌI UPDATE.
 *   * `work_confirmations`, `fund_entry_approvals`, `pending_action_signatures`,
 *     `audit_log`, `join_request_secrets` là bảng CHỈ-THÊM (mục 4.8): `app_role`
 *     không có UPDATE, và "sửa lại một chữ ký" là câu không có nghĩa.
 *
 * Nên: `upsert` cho bảng thường, `insertOnce` cho bảng đóng băng/chỉ-thêm, và
 * một danh sách cột `update` tường minh cho những bảng mà chỉ VÀI cột được
 * phép đổi (`join_requests.created_at` là dữ kiện hạn mức bảo lãnh đọc, đổi nó
 * là `JOIN_REQUEST_FROZEN`).
 */

/**
 * INSERT … ON CONFLICT (id) DO UPDATE — đường mặc định của mục 12.1.
 *
 * `update` mặc định là "mọi cột trừ id". Truyền danh sách hẹp hơn cho bảng có
 * cột đóng băng: cột không nằm trong danh sách thì giữ nguyên giá trị cũ.
 */
export async function upsert(trx, table, cols, rows, { update } = {}) {
  if (!rows.length) return 0;
  const setCols = (update ?? cols).filter((c) => c !== 'id');
  const tail = setCols.length
    ? `DO UPDATE SET ${setCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
    : 'DO NOTHING';
  // `xmax = 0` là cách duy nhất PostgreSQL cho biết một hàng của `ON CONFLICT`
  // là THÊM MỚI hay CẬP NHẬT LẠI. Cần phân biệt vì `rowCount` đếm cả hai như
  // nhau, mà "seed có thay đổi gì không" là câu hỏi quyết định seed còn chạy
  // lại được nhiều lần hay không: nếu đếm cả cập nhật thì lần chạy thứ hai vẫn
  // báo "có thay đổi" và vẫn ghi thêm một dòng `audit_log`, tức bảng nhật ký là
  // bảng duy nhất lớn lên sau mỗi lần chạy.
  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
    `ON CONFLICT (id) ${tail} RETURNING (xmax = 0) AS inserted`;
  let n = 0;
  for (const r of rows) {
    const res = await trx.raw(sql, cols.map((c) => r[c] ?? null));
    if (res.rows?.[0]?.inserted) n += 1;
  }
  return n;
}

/**
 * Ghi một lần rồi thôi. KHÔNG dùng `ON CONFLICT DO NOTHING`: với bảng có
 * trigger BEFORE INSERT, `ON CONFLICT` vẫn cho trigger chạy trước khi biết là
 * trùng. Câu `WHERE NOT EXISTS` dưới đây không sinh ra hàng nào để trigger bám
 * vào, nên lần chạy thứ hai thật sự là không-làm-gì.
 *
 * `key` nhận một cột hoặc một mảng cột (vd. `fund_entry_approvals` có khoá
 * chính ghép `(entry_id, approver_id)` và không có cột `id`).
 */
export async function insertOnce(trx, table, cols, rows, key = 'id') {
  if (!rows.length) return 0;
  const keys = Array.isArray(key) ? key : [key];
  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) ` +
    `SELECT ${cols.map(() => '?').join(', ')} ` +
    `WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')})`;
  let n = 0;
  for (const r of rows) {
    const res = await trx.raw(sql, [...cols.map((c) => r[c] ?? null), ...keys.map((k) => r[k])]);
    n += res.rowCount ?? 0;
  }
  return n;
}

/**
 * Đóng dấu người thực hiện cho các lệnh tiếp theo trong CÙNG giao dịch — đúng
 * cơ chế của `core/tx.js`, chỉ khác là seed đổi dấu nhiều lần trong một giao
 * dịch vì nó nói thay cho 52 người chứ không phải một.
 *
 * `null` nghĩa là "chính hệ thống", không phải "ẩn danh": chỉ dùng cho những
 * việc không có con người nào làm được — tạo cộng đồng khi chưa có ai, và gán
 * vai đầu tiên khi chưa có ai mang vai `tech` để gán.
 */
export async function actAs(trx, actorId) {
  await trx.raw(`SELECT set_config('app.actor_id', ?, true)`, [actorId ?? '']);
}
