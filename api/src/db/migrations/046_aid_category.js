// Frontend "Giúp nhau" (WIZ.taoYeuCau) có chip chọn "Loại cần giúp" (Y tế khẩn
// cấp/Vật dụng/Đi lại/Nhà cửa/Thông tin) để dễ duyệt/lọc — 016_aid.js không có
// cột này (chỉ có title/description/urgency). Thêm 1 cột nullable, cùng cách
// đã làm cho capabilities.image_url ở phiên trước — không đụng gì cấu trúc
// slots/offers/events đã có.
export async function up(knex) {
  await knex.raw(`ALTER TABLE aid_requests ADD COLUMN IF NOT EXISTS category text;`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE aid_requests DROP COLUMN IF EXISTS category;`);
}
