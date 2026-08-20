import { z } from 'zod';
import { withActor } from './tx.js';

// Vòng soát xét 1 (Important) — bẫy còn sót: chuỗi token dưới đây vốn là
// DANH SÁCH CHO PHÉP (chỉ chữ/số/., :, _, - và tối đa 64 ký tự) chứ không
// phải danh sách cấm, nhưng một số điện thoại ('0912345678'), CCCD 12 chữ số,
// hay số tài khoản ngân hàng cũng khớp đúng hình dạng "enum/field_key" đó —
// bản thân ký tự dùng không phân biệt được. Vì vậy đây là DANH SÁCH CHO PHÉP
// CÓ LOẠI TRỪ: sau khi khớp hình dạng token, còn phải qua điều kiện đếm chữ
// số bên dưới để loại các chuỗi "trông như token nhưng thực ra là định danh
// cá nhân dạng số".
//
// Vòng soát xét 2 (Important) — bản vá lần trước ("toàn bộ chuỗi chỉ gồm số
// và dấu phân cách") hỏng ngay khi lẫn MỘT chữ cái: 'sdt0912345678',
// '0912345678x', '19012345678901x' đều lọt qua nguyên vẹn vì điều kiện đầu
// tiên ("toàn bộ chuỗi") thất bại — đúng thứ một lập trình viên vô ý sẽ viết
// khi "thêm tiền tố/hậu tố cho dễ đọc rồi tưởng là an toàn". Sửa bằng CẢ HAI
// luật hợp bằng HOẶC — mỗi luật bắt một hình dạng khác nhau, thiếu một là hở
// một:
function isDigitHeavyToken(s) {
  // Luật 1: cụm chữ số LIÊN TIẾP dài nhất trong chuỗi >= 6 → từ chối, bất kể
  // xung quanh có chữ cái hay không (không cần toàn chuỗi là số). Bắt hình
  // dạng "chèn chữ cái làm tiền tố/hậu tố": 'sdt0912345678', '0912345678x',
  // '19012345678901x'.
  const digitRuns = s.match(/[0-9]+/g) ?? [];
  const longestRun = digitRuns.reduce((max, run) => Math.max(max, run.length), 0);
  if (longestRun >= 6) return true;

  // Luật 2: chuỗi CHỈ gồm chữ số và dấu phân cách thường gặp trong số điện
  // thoại/CCCD/số tài khoản (-, ., _, :, khoảng trắng — không lẫn một chữ cái
  // nào), và tổng số chữ số sau khi bỏ dấu phân cách đủ lớn → từ chối. Bắt
  // hình dạng "chèn dấu phân cách": '0912-345-678' có cụm dài nhất chỉ 4 (dưới
  // ngưỡng luật 1) nên LUẬT 1 MỘT MÌNH BỎ LỌT hình dạng này — đã tự kiểm bằng
  // cách gỡ luật 2: '0912-345-678' và '0912 345 678' lọt qua ngay lập tức. Vì
  // vậy PHẢI giữ cả hai luật; bỏ một trong hai là mở lại đúng khe hở tương ứng
  // của luật đó, không phải khe hở của luật kia.
  //
  // Ngưỡng ở đây là 7, KHÔNG PHẢI 6 như phiên bản trước: bảng thử vòng soát
  // xét 2 đòi '2026-08' (6 chữ số, một dấu gạch ngang — hình dạng tháng/kỳ,
  // không phải định danh cá nhân) phải CHO QUA, còn mọi ca phải-từ-chối gắn
  // với luật này ('0912-345-678', '0912 345 678') đều có 10 chữ số trở lên —
  // nâng lên 7 là mức tối thiểu thỏa cả hai mà không mở lại ca nào từng phải
  // từ chối. Đánh đổi đã ghi nhận: một số tài khoản đúng 6 chữ số nếu bị chia
  // bằng dấu phân cách (vd. '123-456') sẽ không còn bị luật 2 bắt — chưa có
  // bảng thử nào yêu cầu ca đó, xem "Vòng sửa 2" trong task-4-report.md.
  if (/^[0-9\-_.: ]+$/.test(s)) {
    const digitCount = (s.match(/[0-9]/g) ?? []).length;
    if (digitCount >= 7) return true;
  }

  return false;
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
/**
 * Task 18: thân của phép kiểm đã DỜI XUỐNG CSDL (`fn_audit_verify_chain`,
 * migration 032), và hàm này chỉ còn là lớp vỏ gọi nó. Không phải vì gọn hơn:
 * tác vụ `verify-chain.sh` chạy trong container sao lưu, nơi KHÔNG có Node —
 * nó phải kiểm chuỗi bằng `psql`. Nếu để câu SQL ở đây rồi chép một bản sang
 * shell thì có hai định nghĩa của cùng một phép kiểm, và hai bản đồ giống nhau
 * đặt ở hai chỗ là hai bản đồ sẽ khác nhau — đúng khuôn `fn_pending_action_role`
 * (migration 022) đã tránh. Chữ ký hàm, tên trường trả về và ngữ nghĩa của
 * `checked` (số dòng lành TRƯỚC chỗ gãy) giữ nguyên.
 */
export async function verifyChain(db, { communityId, from, to }) {
  const { rows: [r] } = await db.raw(
    `SELECT (fn_audit_verify_chain(?, ?::timestamptz, ?::timestamptz)).*`,
    [communityId, from ?? null, to ?? null]
  );
  return { ok: r.ok, checked: Number(r.checked), brokenAt: r.broken_at === null ? null : r.broken_at };
}
