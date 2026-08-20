import { z } from 'zod';

// Đường đọc duy nhất là `GET /files/:id`, và `:id` phải là uuid. Chặn ở zod
// TRƯỚC khi chạm CSDL vì hai lý do, không phải một:
//   * một chuỗi không phải uuid làm câu `WHERE id = ?` ném lỗi kiểu 22P02, mà
//     lỗi đó không có trong bảng ánh xạ ⇒ HTTP 500 thay vì 400 (cùng bẫy đã
//     ghi ở modules/members/schema.js);
//   * và nó nhiễm độc giao dịch (bẫy 2).
export const idParamSchema = z.object({ id: z.string().uuid() });
