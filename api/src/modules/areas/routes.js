import { Router } from 'express';
import { rateLimit } from '../../middleware/rateLimit.js';
import { resolveCommunityId } from '../auth/service.js';
import * as areaService from './service.js';

export const router = Router();

const normalLimit = rateLimit({ windowMs: 60_000, max: 60 });

// `GET /areas` KHÔNG đòi đăng nhập, và đây là quyết định có cân nhắc, không phải
// sơ suất nới lỏng.
//
// Soát xét MỐC 2 phát hiện: `POST /auth/register` bắt buộc `area_id`, mà đường
// duy nhất lấy danh mục khu vực lại nằm sau `requireAuth`. Người chưa là thành
// viên — tức đúng người đang điền đơn gia nhập — không có cách nào biết chọn gì.
// Màn đăng ký hoặc phải nhận một uuid dán tay, hoặc phải nhúng cứng danh sách
// khu vực vào frontend rồi trôi dạt khỏi CSDL.
//
// Vì sao mở là an toàn: `areas` là danh mục thôn/xã — tên hành chính công khai,
// không phải dữ liệu cá nhân, không gắn với người nào. Nó KHÁC HẲN việc mở danh
// sách thành viên: một endpoint công khai liệt kê người sẽ vô hiệu hoá toàn bộ
// cơ chế chống dò của `/auth/register` (ba nhánh cùng một lỗi + đệm 700ms), vì
// kẻ tấn công không cần dò nữa mà liệt kê thẳng. Ranh giới nằm ở chỗ đó, và chỉ
// chỗ đó.
//
// `lat`/`lng` vẫn không ra tới client (xem service.js) — mở danh mục không có
// nghĩa là mở mọi cột trong đó.
router.get('/', normalLimit, async (req, res, next) => {
  try {
    const communityId = req.actor?.communityId ?? (await resolveCommunityId());
    res.json(await areaService.tree({ actor: req.actor, communityId }));
  } catch (err) {
    next(err);
  }
});
