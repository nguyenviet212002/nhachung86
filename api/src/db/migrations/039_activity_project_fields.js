export async function up(knex) {
  await knex.raw(`
    ALTER TABLE activities
      ADD COLUMN location text,
      ADD COLUMN image_url text,
      ADD COLUMN capacity int NOT NULL DEFAULT 1 CHECK (capacity > 0)
  `);
}

export async function down(knex) {
  await knex.raw(`
    ALTER TABLE activities
      DROP COLUMN IF EXISTS capacity,
      DROP COLUMN IF EXISTS image_url,
      DROP COLUMN IF EXISTS location
  `);
}
