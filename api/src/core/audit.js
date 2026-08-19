import { z } from 'zod';
import { withActor } from './tx.js';

// Vòng soát xét 1 (Important) — bẫy còn sót: chuỗi token dưới đây vốn là
// DANH SÁCH CHO PHÉP (chỉ chữ/số/., :, _, - và tối đa 64 ký tự) chứ không
// phải danh sách cấm, nhưng một số điện thoại ('0912345678'), CCCD 12 chữ số,
// hay số tài khoản ngân hàng cũng khớp đúng hình dạng "enum/field_key" đó —
// bản thân ký tự dùng không phân biệt được. Vì vậy đây là DANH SÁCH CHO PHÉP
// CÓ LOẠI TRỪ: sau khi khớp hình dạng token, còn phải qua một điều kiện đếm
// chữ số để loại các chuỗi "trông như token nhưng thực ra là định danh cá
// nhân dạng số". Quy tắc: nếu TOÀN BỘ chuỗi chỉ gồm chữ số và dấu phân cách
// thường gặp trong số điện thoại/CCCD/số tài khoản (-, ., _, :, khoảng
// trắng — không lẫn một chữ cái nào), và số chữ số còn lại sau khi bỏ dấu
// phân cách từ 6 trở lên, thì từ chối. Ngưỡng 6 được chọn vì số đếm nghiệp vụ
// thật (số lượt, số tiền quy đổi ra count, mã hai chữ số) hiếm khi cần biểu
// diễn dưới dạng CHUỖI thuần số dài — số đếm thật nên đi qua z.number(); còn
// mọi định danh cá nhân có ý nghĩa ở Việt Nam (số điện thoại 9-11 số, CCCD 12
// số, số tài khoản ngân hàng 6+ số) đều RƠI VÀO đúng khoảng 6 chữ số trở lên.
// ĐỪNG nới ngưỡng này lên "cho dễ gỡ lỗi" — 6 là ranh giới an toàn thấp nhất
// đã kiểm; nới lên nghĩa là mở lại đúng khe hở này. Token có ít nhất một chữ
// cái (vd. '007_audit_log.js', 'page:2', 'v1.2', 'SELF_ONLY') không bao giờ
// bị chặn bởi quy tắc này, bất kể có bao nhiêu chữ số.
function isDigitHeavyToken(s) {
  if (!/^[0-9\-_.: ]+$/.test(s)) return false; // có chữ cái → không phải diện nghi ngờ
  const digitCount = (s.match(/[0-9]/g) ?? []).length;
  return digitCount >= 6;
}

// Luật mục 10: detail chỉ chứa định danh, enum, tên trường, số đếm, và định danh giả (HMAC).
// KHÔNG BAO GIỜ chứa giá trị cá nhân thô. Canh lúc chạy, không chỉ bằng lời hứa.
const scalar = z.union([
  z.string().uuid(),
  // Lệch có chủ đích khỏi brief (regex gốc chỉ nhận chữ thường): mã lỗi
  // AppError.code trong core/errors.js theo quy ước UPPER_SNAKE_CASE (vd.
  // 'GUARANTEE_QUOTA_EXCEEDED', 'INTERNAL') — chính là giá trị errorHandler
  // đưa vào `detail: { code: mapped.code }` khi gọi logDenied. Xác nhận bằng
  // chạy thật: với regex chỉ-chữ-thường, logDenied luôn ném lỗi ngay khi gặp
  // code thật (bị .catch() trong errorHandler nuốt âm thầm) — nghĩa là dòng
  // "từ chối" không bao giờ được ghi, đúng thất bại mà bẫy mục 3 cảnh báo.
  // Cho phép cả hai hoa/thường vẫn giữ đúng tinh thần luật mục 10 (chỉ định
  // danh/enum/tên trường, không phải văn bản tự do).
  z.string()
    .regex(/^[A-Za-z0-9_.:-]{1,64}$/) // enum, field_key, mã lý do
    .refine((s) => !isDigitHeavyToken(s), {
      message: 'chuỗi toàn chữ số (giống số điện thoại/CCCD/số tài khoản) — không phải token nghiệp vụ hợp lệ',
    }),
  z.string().regex(/^[0-9a-f]{64}$/),         // định danh giả: HMAC-SHA256 hex
  z.number(), z.boolean(), z.null(),
]);
const detailSchema = z.record(z.union([scalar, z.array(scalar)]));

export function assertSafeDetail(detail) {
  const r = detailSchema.safeParse(detail ?? {});
  if (!r.success) {
    throw new Error(
      'audit.detail chứa giá trị không được phép — nhật ký không bao giờ lưu dữ liệu cá nhân thô. ' +
      JSON.stringify(r.error.issues.map(i => i.path.join('.')))
    );
  }
  return r.data;
}

export async function log(trx, entry) {
  if (!trx || typeof trx.raw !== 'function') {
    throw new Error('audit.log phải chạy trong một giao dịch — gọi qua withActor()');
  }
  const detail = assertSafeDetail(entry.detail);
  await trx.raw(
    `INSERT INTO audit_log (community_id, actor_id, action, target_type, target_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?)`,
    [entry.communityId, entry.actorId ?? null, entry.action,
     entry.targetType ?? null, entry.targetId ?? null, JSON.stringify(detail), entry.ip ?? null]
  );
}

/**
 * Từ chối phải để lại dấu. Ngoại lệ hủy giao dịch chính (bẫy mục 3: nếu ghi
 * nhật ký RỒI mới RAISE, ngoại lệ hủy cả giao dịch và xóa luôn dòng nhật ký
 * vừa ghi), nên dòng nhật ký phải nằm trong một giao dịch RIÊNG mở SAU khi
 * giao dịch chính đã rollback xong. errorHandler là nơi DUY NHẤT gọi hàm này.
 */
export async function logDenied(entry) {
  return withActor(entry.actorId, (trx) =>
    log(trx, { ...entry, action: entry.action.endsWith('.denied') ? entry.action : entry.action + '.denied' })
  );
}

/**
 * Lệch có chủ đích khỏi brief (bẫy mục 2): brief gốc đọc `at` (timestamptz,
 * độ chính xác micro-giây) về JS rồi truyền ngược xuống SQL để tính lại băm.
 * Driver `pg` phân giải cột timestamptz thành `Date` của JavaScript — vốn chỉ
 * có độ chính xác mili-giây — nên 3 chữ số cuối của `at` bị cắt mất trước khi
 * quay lại SQL. Băm tính lại khi đó SẼ LUÔN khác băm đã lưu (vì trigger tính
 * trên `at` gốc, đủ micro-giây), verifyChain báo chuỗi gãy dù chuỗi hoàn toàn
 * lành. Vì vậy toàn bộ việc so khớp — kể cả đọc lại `at` để đưa vào digest() —
 * chạy trong ĐÚNG MỘT câu SQL, trên chính giá trị `at` còn nằm trong hàng đã
 * lưu. Chỉ có seq và hai cờ boolean (prev_ok, hash_ok) rời khỏi CSDL để về
 * JS — `at` không bao giờ đi vòng qua JavaScript.
 */
export async function verifyChain(db, { communityId, from, to }) {
  const { rows } = await db.raw(
    `WITH ordered AS (
       SELECT seq, actor_id, action, target_type, target_id, at, prev_hash, hash,
              lag(hash) OVER (ORDER BY seq) AS expected_prev,
              row_number() OVER (ORDER BY seq) AS rn
         FROM audit_log
        WHERE community_id = ?
          AND (?::timestamptz IS NULL OR at >= ?)
          AND (?::timestamptz IS NULL OR at <= ?)
     )
     SELECT seq,
            (rn = 1 OR prev_hash = expected_prev) AS prev_ok,
            (hash = encode(digest(
                prev_hash || '|' || coalesce(actor_id::text, '-') || '|' || action || '|' ||
                coalesce(target_type, '-') || '|' || coalesce(target_id::text, '-') || '|' ||
                to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'sha256'), 'hex')) AS hash_ok
       FROM ordered
      ORDER BY seq`,
    [communityId, from ?? null, from ?? null, to ?? null, to ?? null]
  );

  let checked = 0;
  for (const r of rows) {
    if (!r.prev_ok || !r.hash_ok) return { ok: false, checked, brokenAt: r.seq };
    checked++;
  }
  return { ok: true, checked, brokenAt: null };
}
