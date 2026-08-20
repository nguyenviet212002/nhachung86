export async function up(knex) {
  await knex.raw(`
    ALTER TABLE areas
      ADD COLUMN is_active boolean NOT NULL DEFAULT true;

    UPDATE areas SET is_active = false;
  `);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE areas DROP COLUMN IF EXISTS is_active;`);
}
