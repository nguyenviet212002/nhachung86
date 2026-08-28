export async function up(knex) {
  const user = process.env.APP_DB_USER ?? 'app_role';
  await knex.raw(`
    ALTER TABLE job_needs
      ADD COLUMN profession text,
      ADD COLUMN people_needed integer CHECK (people_needed IS NULL OR (people_needed > 0 AND people_needed <= 1000)),
      ADD COLUMN start_note text,
      ADD COLUMN start_at timestamptz,
      ADD COLUMN requirements text,
      ADD COLUMN warnings text,
      ADD COLUMN contact_owner text,
      ADD COLUMN contact_policy text NOT NULL DEFAULT 'approval' CHECK (contact_policy IN ('anyone', 'approval', 'admin')),
      ADD COLUMN visibility text NOT NULL DEFAULT 'community' CHECK (visibility IN ('community', 'profession', 'selected')),
      ADD COLUMN show_phone boolean NOT NULL DEFAULT true,
      ADD COLUMN allow_introductions boolean NOT NULL DEFAULT true,
      ADD COLUMN share_to_facebook boolean NOT NULL DEFAULT false;

    CREATE TABLE job_need_images (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id uuid NOT NULL REFERENCES communities(id),
      job_need_id uuid NOT NULL,
      file_id uuid NOT NULL UNIQUE,
      sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0 AND sort_order <= 20),
      caption text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT job_need_images_job_cid FOREIGN KEY (job_need_id, community_id)
        REFERENCES job_needs (id, community_id) ON DELETE CASCADE,
      CONSTRAINT job_need_images_file_cid FOREIGN KEY (file_id, community_id)
        REFERENCES files (id, community_id) ON DELETE CASCADE
    );
    CREATE INDEX idx_job_need_images_job ON job_need_images (job_need_id, sort_order, created_at);
  `);
  await knex.raw(`REVOKE ALL ON job_need_images FROM ??; GRANT SELECT, INSERT, UPDATE, DELETE ON job_need_images TO ??;`, [user, user]);
}

export async function down(knex) {
  await knex.raw(`
    DROP TABLE IF EXISTS job_need_images;
    ALTER TABLE job_needs
      DROP COLUMN IF EXISTS profession,
      DROP COLUMN IF EXISTS people_needed,
      DROP COLUMN IF EXISTS start_note,
      DROP COLUMN IF EXISTS start_at,
      DROP COLUMN IF EXISTS requirements,
      DROP COLUMN IF EXISTS warnings,
      DROP COLUMN IF EXISTS contact_owner,
      DROP COLUMN IF EXISTS contact_policy,
      DROP COLUMN IF EXISTS visibility,
      DROP COLUMN IF EXISTS show_phone,
      DROP COLUMN IF EXISTS allow_introductions,
      DROP COLUMN IF EXISTS share_to_facebook;
  `);
}
