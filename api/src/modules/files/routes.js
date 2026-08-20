import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { singleFile } from '../../middleware/upload.js';
import * as schema from './schema.js';
import * as fileService from './service.js';

export const router = Router();

const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });
// Tải lên chặt hơn API thường: mỗi lượt là 10 MB đi qua mạng và một lần giải
// nén ảnh trong tiến trình `api`. Sáu lần một phút đủ cho người thật đổi ảnh
// đại diện và không đủ để một người biến máy chủ thành máy nén ảnh.
//
// ĐẾM THEO NGƯỜI, KHÔNG THEO IP — khác với mọi rate limit khác trong dự án, và
// khác có lý do: đây là đường đã xác thực, nên `req.actor.id` là định danh
// đúng của "một người". Đếm theo IP ở một cộng đồng làng xã sẽ gộp cả nhà dùng
// chung một đường mạng vào một hạn mức, mà lại thả người đổi mạng di động.
// `?? req.ip` chỉ là lưới đỡ: `requireAuth` đã chạy trước nên `req.actor`
// luôn có, và nếu một ngày ai đó đảo thứ tự middleware thì hạn mức tụt về
// đếm theo IP chứ không biến mất.
const uploadLimit = rateLimit({ windowMs: 60_000, max: 6, key: (req) => req.actor?.id ?? req.ip });

router.use(normalLimit, requireAuth);

// KHÔNG có `express.json()` ở đây: thân của route này là multipart, và app.js
// đã gắn `express.json({ limit: '1mb' })` toàn cục — nó bỏ qua request không
// phải `application/json`, nên `singleFile` vẫn đọc được luồng nguyên vẹn.
router.post('/', uploadLimit, singleFile({ field: 'file' }), async (req, res, next) => {
  try {
    res.status(201).json(await fileService.upload({
      actor: req.actor,
      file: req.file,
      purpose: req.body?.purpose || null,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', validate(schema.idParamSchema, 'params'), async (req, res, next) => {
  try {
    const { file, stream } = await fileService.read({ actor: req.actor, id: req.params.id });

    // `nosniff`: kho chỉ chứa JPEG do chính sharp viết ra, nhưng nếu một ngày
    // nào đó nó chứa thứ khác thì trình duyệt không được phép tự đoán loại rồi
    // chạy nó như HTML. Một dòng rẻ chặn cả một họ lỗi.
    res.set('Content-Type', file.mime);
    res.set('Content-Length', String(file.byte_size));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
    // `private`: ảnh này đi qua kiểm quyền, nên không proxy nào được giữ một
    // bản dùng chung cho người tiếp theo. `no-store` thì không — trình duyệt
    // của chính người có quyền được phép nhớ ảnh đại diện.
    res.set('Cache-Control', 'private, max-age=300');

    stream.on('error', (err) => {
      // Header đã gửi rồi thì không còn đổi được mã HTTP — cắt kết nối là câu
      // trả lời trung thực duy nhất, và ghi lại để người vận hành thấy.
      req.log?.error?.({ err }, 'luồng byte từ kho đứt giữa chừng');
      res.destroy();
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});
