export async function up(knex) {
  await knex.raw(`
    CREATE TABLE communities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code text NOT NULL UNIQUE,
      name text NOT NULL,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE areas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      name text NOT NULL,
      parent_id uuid REFERENCES areas(id),
      lat double precision,
      lng double precision,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (community_id, name)
    );
    CREATE INDEX idx_areas_parent ON areas (community_id, parent_id);
  `);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS areas; DROP TABLE IF EXISTS communities;`);
}
