import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withActor } from '../../core/tx.js';
import { AppError } from '../../core/errors.js';
import { log as auditLog } from '../../core/audit.js';
import { newKey, put, getStream, driver } from '../../core/storage.js';

const MAX_BYTES = 10 * 1024 * 1024; // đặc tả mục 5.3: ≤ 10 MB
const MAX_EDGE = 1600; // đặc tả mục 5.3: cạnh dài nhất 1600px
const JPEG_QUALITY = 80; // đặc tả mục 5.3

// Số điểm ảnh tối đa được phép GIẢI NÉN. Khác hẳn giới hạn 10 MB: một tệp PNG
// 40 KB có thể khai kích thước 30000×30000 và bung ra vài GB trong bộ nhớ khi
// giải nén — "quả bom nén". Giới hạn byte không thấy được chuyện đó vì nó đo
// tệp lúc còn nén. sharp có ngưỡng mặc định riêng nhưng nó rất rộng
// (268 megapixel); ở đây một ảnh điện thoại 108 MP đã là hiếm, nên đặt 50 MP.
const MAX_PIXELS = 50_000_000;

// ---------------------------------------------------------------------------
// DANH SÁCH TRẮNG, và nó đọc từ CHÍNH BYTE chứ không từ lời khai của client.
//
// `Content-Type` trong phần multipart do trình duyệt (hoặc `curl`, hoặc một
// script) đặt — nó là dữ liệu người dùng gửi lên, không phải sự thật. Một tệp
// `.exe` khai `image/jpeg` sẽ đi qua mọi câu kiểm dựa trên header.
//
// Vì sao TRẮNG chứ không ĐEN: danh sách đen là lời hứa rằng ta đã nghĩ ra hết
// mọi thứ nguy hiểm. Không ai nghĩ ra hết. Danh sách trắng đảo ngược gánh nặng
// — thứ gì không nằm trong ba dòng dưới đây thì không vào được, kể cả loại tệp
// chưa ai đặt tên.
//
// Ba dấu hiệu dưới đây là dấu hiệu của ĐỊNH DẠNG CHỨA, không phải bảo đảm rằng
// nội dung lành. Lớp thứ hai mới là chỗ quyết định: mọi ảnh đều bị sharp GIẢI
// NÉN RỒI MÃ HOÁ LẠI thành JPEG mới. Byte đi ra là byte sharp viết, không phải
// byte người ta gửi lên — nên một payload giấu sau phần ảnh hợp lệ không sống
// sót qua bước đó.
// ---------------------------------------------------------------------------
const MAGIC = [
  { mime: 'image/jpeg', test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

export const ALLOWED_SOURCE_MIME = MAGIC.map((m) => m.mime);

/** Loại THẬT của byte, hoặc `null` nếu không thuộc danh sách trắng. */
export function sniffImageType(buffer) {
  for (const m of MAGIC) if (m.test(buffer)) return m.mime;
  return null;
}

// ---------------------------------------------------------------------------
// XOÁ SIÊU DỮ LIỆU — chỗ này là nguyên tắc 4, không phải một bước tối ưu ảnh.
//
// Ảnh chụp bằng điện thoại mang theo EXIF, và trong EXIF có IFD GPS: vĩ độ,
// kinh độ, độ cao, đôi khi cả hướng máy ảnh. Trong một cộng đồng mà `address`
// mặc định `closed` và `members.lat/lng` bị liệt kê tường minh là "KHÔNG được
// ra tới client" (modules/members/service.js), một tấm ảnh sân nhà đăng lên
// hồ sơ sẽ nói ra đúng cái toạ độ mà cả tầng riêng tư đang giữ kín. Đây là rò
// rỉ đi vòng: không route nào trả `lat`, nhưng byte của tấm ảnh thì có.
//
// CÁCH LÀM, và vì sao nó đúng: sharp KHÔNG chép siêu dữ liệu sang ảnh ra trừ
// khi được bảo `.withMetadata()`. Nên luật ở đây là một luật PHỦ ĐỊNH — "đừng
// bao giờ gọi `.withMetadata()` trong hàm này". Một luật phủ định thì không tự
// canh được, vì vậy `t28` không kiểm mã nguồn mà nạp một ảnh CÓ TOẠ ĐỘ GPS
// THẬT rồi khẳng định ảnh ra không còn đoạn APP1 nào, và không còn con số toạ
// độ nào trong byte.
//
// `.rotate()` không tham số phải đứng TRƯỚC `.resize()`: nó đọc thẻ Orientation
// của EXIF và xoay điểm ảnh cho đúng. Bỏ nó đi thì ảnh dọc chụp bằng điện thoại
// sẽ nằm ngang sau khi EXIF bị xoá — thẻ nói "xoay 90°" biến mất mà điểm ảnh
// thì chưa xoay.
// ---------------------------------------------------------------------------
export async function ingest(buffer) {
  try {
    const pipeline = sharp(buffer, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err) {
    // Không đưa thông điệp của sharp ra ngoài: nó có thể chứa đường dẫn và
    // thông tin về nội dung tệp. Người dùng cần biết "ảnh này không mở được".
    throw new AppError('FILE_CORRUPT', 'Không đọc được ảnh này. Hãy thử tấm khác.', { status: 422 });
  }
}

// ---------------------------------------------------------------------------
// AI ĐỌC ĐƯỢC TỆP NÀO — bảng phân giải, mặc định TỪ CHỐI.
//
// Đặc tả mục 5.3 nói quyền đọc `GET /files/:id` là "theo quyền của đối tượng
// gắn kèm". Giai đoạn 1 có đúng hai loại đối tượng gắn kèm (ảnh đại diện, ảnh
// bìa) và cả hai đều công khai với người trong Hội — nhưng cách viết dưới đây
// quan trọng hơn hai dòng dữ liệu của nó:
//
//   * Đây là DANH SÁCH TRẮNG. Một `attached_type` không có tên ở đây thì không
//     ai đọc được trừ chính chủ. Người thêm loại thứ ba (ảnh năng lực, ảnh ký
//     ức — thứ có luật riêng tư RIÊNG, xem `fn_photo_consent_missing` ở
//     migration 019) buộc phải viết luật của nó ra, không có đường nào để
//     "quên rồi mặc định cho qua".
//   * `community` KHÔNG có nghĩa là "mọi người". Câu SQL đã lọc
//     `community_id = <người xem>` trước khi tới đây, nên `community` nghĩa là
//     "người trong CHÍNH Hội này". Lọc ở câu truy vấn chứ không ở bảng này là
//     có chủ đích: quên một dòng ở đây thì fail-closed, quên bộ lọc ở câu SQL
//     thì fail-open — nên bộ lọc phải nằm ở chỗ không viết thì không chạy.
// ---------------------------------------------------------------------------
const ATTACH_READERS = {
  member_avatar: 'community',
  member_cover: 'community',
};

const NOT_FOUND = () => new AppError('NOT_FOUND', 'Không tìm thấy tệp này.', { status: 404 });

/**
 * Tải lên. Bốn nhịp, và THỨ TỰ của hai nhịp giữa là một quyết định:
 *
 *   1. đọc loại thật bằng magic bytes (trước khi có gì được ghi đi đâu),
 *   2. giải nén + xoá siêu dữ liệu + mã hoá lại,
 *   3. **ghi SỔ trước** — hàng `files` ra đời cùng `storage_key`,
 *   4. rồi mới ghi BYTE vào kho.
 *
 * Ngược lại (byte trước, sổ sau) nghe tự nhiên hơn và sai: nếu bước ghi sổ
 * hỏng thì byte đã nằm trong kho mà KHÔNG AI CÒN BIẾT KHOÁ CỦA NÓ — một tấm
 * ảnh của một người thật, nằm vĩnh viễn trong bucket, không ai tìm ra để dọn.
 * Ghi sổ trước thì hỏng ở đâu cũng còn một hàng nói được "khoá này đã từng
 * được cấp", và tác vụ dọn có thứ để đối chiếu. Xem câu hỏi 2 của báo cáo
 * lượt 15.
 */
export async function upload({ actor, file, purpose = null }) {
  if (purpose !== null && !['member_avatar', 'member_cover'].includes(purpose)) {
    throw new AppError('VALIDATION_FAILED', 'Mục đích ảnh không hợp lệ.', { status: 400 });
  }
  if (!file?.buffer?.length) {
    throw new AppError('FILE_MISSING', 'Chưa chọn tệp nào để tải lên.', { status: 400 });
  }
  if (file.buffer.length > MAX_BYTES) {
    throw new AppError('FILE_TOO_LARGE', 'Tệp vượt quá dung lượng cho phép.', { status: 413 });
  }

  const sourceMime = sniffImageType(file.buffer);
  if (!sourceMime) {
    // KHÔNG nói ra ta đoán nó là loại gì: câu trả lời chi tiết biến endpoint
    // này thành một máy nhận dạng định dạng miễn phí cho người đang dò.
    throw new AppError('FILE_TYPE_NOT_ALLOWED', 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.', { status: 415 });
  }

  const out = await ingest(file.buffer);
  const key = newKey(actor.communityId);
  const sha256 = createHash('sha256').update(out.buffer).digest('hex');

  const id = await withActor(actor.id, async (trx) => {
    const {
      rows: [row],
    } = await trx.raw(
      `INSERT INTO files (community_id, owner_id, storage_key, mime, source_mime,
                          byte_size, width, height, sha256, attached_type, attached_id)
       VALUES (?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [actor.communityId, actor.id, key, sourceMime, out.buffer.length, out.width, out.height, sha256,
       purpose, purpose ? actor.id : null]
    );
    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: 'file.uploaded',
      targetType: 'file',
      targetId: row.id,
      // Luật mục 10: chỉ mã định danh, tên trường, số đếm. Tên tệp của người
      // dùng KHÔNG có mặt ở đây — nó là văn bản tự do, và người ta đặt tên tệp
      // bằng đủ thứ ('CCCD-mat-truoc.jpg').
      //
      // `source_format` chứ không phải `source_mime`: `assertSafeDetail` chỉ
      // nhận token khớp /^[A-Za-z0-9_.:-]{1,64}$/, mà 'image/png' có dấu `/`
      // nên bị từ chối thẳng. Phát hiện lúc chạy thật ở lượt 15 — bản đầu ghi
      // nguyên chuỗi MIME và mọi lượt tải lên trả HTTP 500. Ghi lại ở đây vì
      // đây là chỗ người thêm trường mới vào `detail` sẽ nhìn.
      detail: {
        source_format: sourceMime.replace('image/', ''),
        byte_size: out.buffer.length,
        width: out.width,
        height: out.height,
      },
    });
    return row.id;
  });

  try {
    await put(key, out.buffer);
  } catch (err) {
    // Sổ đã ghi, byte thì không. Đánh dấu hàng là đã bỏ để không đường đọc nào
    // trả về một tệp không tồn tại, và để tác vụ dọn nhìn thấy nó.
    await withActor(actor.id, async (trx) => {
      await trx.raw(`UPDATE files SET deleted_at = now() WHERE id = ? AND community_id = ?`, [
        id,
        actor.communityId,
      ]);
      await auditLog(trx, {
        communityId: actor.communityId,
        actorId: actor.id,
        action: 'file.upload_failed',
        targetType: 'file',
        targetId: id,
        detail: { storage_driver: driver },
      });
    });
    throw new AppError('STORAGE_UNAVAILABLE', 'Kho ảnh đang không nhận được tệp. Thử lại sau ít phút.', {
      status: 503,
    });
  }

  return { id };
}

/**
 * Đọc. Trả về `{ allowed, file, stream }` — KHÔNG ném lỗi cho lượt bị từ chối.
 *
 * Lý do là bẫy 1 (mục 3 của đề bài, và `core/audit.js`): ghi `file.denied` rồi
 * `throw` trong CÙNG một giao dịch thì ngoại lệ cuộn giao dịch lại và XOÁ LUÔN
 * dòng nhật ký vừa ghi — lượt bị từ chối không để lại dấu nào, đúng lúc dấu
 * vết là thứ đáng giá nhất. Nên giao dịch ở đây chỉ quyết định và ghi; việc
 * ném lỗi để cho tầng route làm, SAU khi giao dịch đã commit. Cùng khuôn với
 * `members/service.js#readContactField`.
 */
export async function read({ actor, id }) {
  const outcome = await withActor(actor.id, async (trx) => {
    // LỌC `community_id` NGAY Ở CÂU TRUY VẤN. Đây là lỗi đã lặp bảy lần trong
    // dự án. Hệ quả phụ đáng giá: một `files.id` của Hội khác không phân biệt
    // được với một id bịa — cả hai đều là "không có hàng nào" ⇒ 404, nên
    // endpoint này không trả lời được câu "id này có tồn tại ở đâu đó không".
    //
    // `deleted_at IS NULL`: tệp đã bỏ thì không còn đường đọc, kể cả với chính
    // chủ, kể cả khi byte chưa được tác vụ dọn xoá.
    const {
      rows: [row],
    } = await trx.raw(
      `SELECT id, owner_id, storage_key, mime, byte_size, attached_type, attached_id,
              EXISTS (
                SELECT 1 FROM job_need_images ji
                JOIN job_needs j ON j.id = ji.job_need_id AND j.community_id = ji.community_id
                WHERE ji.file_id = files.id AND ji.community_id = ?
                  AND j.status IN ('open', 'closed', 'filled')
              ) AS job_image_visible,
              EXISTS (
                SELECT 1 FROM activities a
                WHERE a.community_id = ?
                  AND a.image_url = '/files/' || files.id::text
                  AND a.status IN ('open', 'running', 'done')
              ) AS activity_image_visible,
              EXISTS (
                SELECT 1 FROM activities a
                WHERE a.community_id = ?
                  AND a.image_url = '/files/' || files.id::text
              ) AS activity_image_attached,
              -- Ảnh minh chứng năng lực: cùng luật hiển thị năng lực chính nó
              -- (capabilities/service.js) — công khai khi đã 'published', còn
              -- 'draft'/'hidden' thì chỉ chính chủ (đã có ở owner_id === actor.id).
              EXISTS (
                SELECT 1 FROM capability_photos cp
                JOIN capabilities c ON c.id = cp.capability_id AND c.community_id = cp.community_id
                WHERE cp.community_id = ? AND cp.url = '/files/' || files.id::text
                  AND c.status = 'published'
              ) AS capability_photo_visible,
              -- Ảnh lời nhờ giúp: aid_requests không lọc theo status khi hiển thị
              -- (GET /aid liệt kê mọi trạng thái cho người trong Hội) — ảnh đi
              -- kèm theo đúng luật đó, không cần lọc status ở đây.
              EXISTS (
                SELECT 1 FROM aid_request_photos ap
                JOIN aid_requests ar ON ar.id = ap.aid_request_id AND ar.community_id = ap.community_id
                WHERE ap.community_id = ? AND ap.url = '/files/' || files.id::text
              ) AS aid_photo_visible
         FROM files
        WHERE id = ? AND community_id = ? AND deleted_at IS NULL`,
      [actor.communityId, actor.communityId, actor.communityId, actor.communityId, actor.communityId, id, actor.communityId]
    );
    if (!row) return { kind: 'not_found' };

    const allowed =
      row.owner_id === actor.id ||
      ATTACH_READERS[row.attached_type ?? ''] === 'community' ||
      row.job_image_visible ||
      row.activity_image_visible ||
      row.capability_photo_visible ||
      row.aid_photo_visible ||
      (row.activity_image_attached && actor.roles?.some((r) => ['approver', 'content_ops'].includes(r)));

    await auditLog(trx, {
      communityId: actor.communityId,
      actorId: actor.id,
      action: allowed ? 'file.read' : 'file.denied',
      targetType: 'file',
      targetId: row.id,
      detail: { attached_type: row.attached_type ?? 'none', owner: row.owner_id === actor.id },
    });

    return allowed ? { kind: 'ok', row } : { kind: 'denied' };
  });

  // ----- Từ đây trở xuống giao dịch ĐÃ COMMIT. Dòng file.denied an toàn. ----
  if (outcome.kind === 'not_found') throw NOT_FOUND();
  if (outcome.kind === 'denied') {
    throw new AppError('FORBIDDEN', 'Bạn không có quyền xem tệp này.', { status: 403 });
  }

  let stream;
  try {
    stream = await getStream(outcome.row.storage_key);
  } catch {
    // Sổ có, byte không: hoặc tác vụ dọn đã xoá byte mà quên hàng, hoặc bước
    // ghi kho ở `upload()` hỏng giữa chừng. Với người dùng thì tệp này không
    // còn — 404. Với người vận hành thì đây là một sai lệch giữa sổ và kho, và
    // errorHandler đã ghi lại qua pino.
    throw NOT_FOUND();
  }

  return { file: { id: outcome.row.id, mime: outcome.row.mime, byte_size: outcome.row.byte_size }, stream };
}
