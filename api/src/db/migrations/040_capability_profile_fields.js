// Các thông tin vận hành của một năng lực cần được lưu cùng hồ sơ để
// Trung tâm năng lực và trang chi tiết luôn hiển thị cùng một dữ liệu.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE capabilities
      ADD COLUMN service_area text,
      ADD COLUMN scope text,
      ADD COLUMN availability text,
      ADD COLUMN conditions text;
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE capabilities
      DROP COLUMN IF EXISTS service_area,
      DROP COLUMN IF EXISTS scope,
      DROP COLUMN IF EXISTS availability,
      DROP COLUMN IF EXISTS conditions;
  `);
}
