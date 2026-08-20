import { AppError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Cổng theo QUYỀN, không theo vai.
//
// Vì sao thêm một cơ chế thứ hai bên cạnh `requireRole` thay vì dùng lại nó:
// bảng `permissions` / `role_permissions` ra đời từ migration 022 và tới
// Task 16 vẫn RỖNG. Gieo dữ liệu vào một bảng mà không ai đọc là dựng một
// **tài liệu mô tả** — hai bản đồ giống nhau đặt ở hai chỗ là hai bản đồ sẽ
// khác nhau, đúng câu mà chính migration 022 đã viết cho `fn_pending_action_role`.
//
// Nên bảng ấy phải LÀ ma trận, không phải nói về ma trận: đổi một hàng
// `role_permissions` là đổi quyền truy cập thật ở lần đăng nhập kế tiếp.
// `requireAuth` nạp `req.actor.permissions` từ chính hai bảng đó.
//
// PHẠM VI, nói thẳng: chỉ các route `/ops` đi qua đây. `/join-requests` và
// `/members` vẫn dùng `requireRole` — chuyển chúng sang là một thay đổi hành
// vi ở những luồng đã có bài test dày, và làm việc đó trong cùng lượt với
// việc mở luồng gán vai là trộn hai rủi ro. `t27` khẳng định hai chiều để
// bảng không trôi dạt: mọi khoá trong `permissions` phải có ít nhất một route
// dùng, và mọi khoá truyền cho hàm dưới đây trong `api/src` phải có hàng trong
// `permissions`. (Không viết một lời gọi ví dụ ở đây — bài test quét chính
// thư mục này, nên một ví dụ trong chú thích sẽ bị đếm là một lời gọi thật.)
// ---------------------------------------------------------------------------
export function requirePermission(...keys) {
  return (req, _res, next) => {
    if (!req.actor) return next(new AppError('UNAUTHENTICATED', 'Cần đăng nhập.', { status: 401 }));
    if (!req.actor.permissions?.some((p) => keys.includes(p))) {
      return next(new AppError('FORBIDDEN', 'Bạn không có quyền thực hiện việc này.', { status: 403 }));
    }
    next();
  };
}
