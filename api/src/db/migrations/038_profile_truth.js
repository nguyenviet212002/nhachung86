// Profile data that must survive reload and come from the person who created
// the invite. Existing invites stay valid; new HTTP invites require the note.
export async function up(knex) {
  await knex.raw(`
    ALTER TABLE guarantee_invites
      ADD COLUMN inviter_note text,
      ADD CONSTRAINT gi_inviter_note_length CHECK (
        inviter_note IS NULL OR length(btrim(inviter_note)) BETWEEN 10 AND 1000
      );

    CREATE OR REPLACE FUNCTION fn_guarantee_invite_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.community_id, NEW.referrer_id, NEW.token_hash, NEW.created_by,
          NEW.created_at, NEW.expires_at, NEW.on_behalf_reason_code,
          NEW.on_behalf_reason, NEW.inviter_note)
         IS DISTINCT FROM
         (OLD.community_id, OLD.referrer_id, OLD.token_hash, OLD.created_by,
          OLD.created_at, OLD.expires_at, OLD.on_behalf_reason_code,
          OLD.on_behalf_reason, OLD.inviter_note) THEN
        RAISE EXCEPTION 'INVITE_FROZEN'
          USING DETAIL = 'thong tin goc va ghi chu cua link moi khong sua duoc';
      END IF;

      IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED'
          USING DETAIL = 'link moi chi dung duoc mot lan';
      END IF;
      IF OLD.used_by_join_request IS NOT NULL
         AND NEW.used_by_join_request IS DISTINCT FROM OLD.used_by_join_request THEN
        RAISE EXCEPTION 'INVITE_FROZEN'
          USING DETAIL = 'link moi da noi voi mot don, khong doi sang don khac duoc';
      END IF;
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'INVITE_FROZEN'
          USING DETAIL = 'link da thu hoi thi khong hoi sinh duoc';
      END IF;
      IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND OLD.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED'
          USING DETAIL = 'link da co nguoi dung nen khong thu hoi duoc nua';
      END IF;
      IF NEW.used_at IS NOT NULL AND OLD.used_at IS NULL THEN
        IF OLD.revoked_at IS NOT NULL THEN
          RAISE EXCEPTION 'INVITE_REVOKED' USING DETAIL = 'link moi da bi thu hoi';
        END IF;
        IF OLD.expires_at <= now() THEN
          RAISE EXCEPTION 'INVITE_EXPIRED' USING DETAIL = 'link moi da het han';
        END IF;
      END IF;

      RETURN NEW;
    END $fn$;
  `);
}

export async function down(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION fn_guarantee_invite_frozen() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF (NEW.community_id, NEW.referrer_id, NEW.token_hash, NEW.created_by,
          NEW.created_at, NEW.expires_at, NEW.on_behalf_reason_code, NEW.on_behalf_reason)
         IS DISTINCT FROM
         (OLD.community_id, OLD.referrer_id, OLD.token_hash, OLD.created_by,
          OLD.created_at, OLD.expires_at, OLD.on_behalf_reason_code, OLD.on_behalf_reason) THEN
        RAISE EXCEPTION 'INVITE_FROZEN';
      END IF;
      IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED';
      END IF;
      IF OLD.used_by_join_request IS NOT NULL
         AND NEW.used_by_join_request IS DISTINCT FROM OLD.used_by_join_request THEN
        RAISE EXCEPTION 'INVITE_FROZEN';
      END IF;
      IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
        RAISE EXCEPTION 'INVITE_FROZEN';
      END IF;
      IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL AND OLD.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_ALREADY_USED';
      END IF;
      IF NEW.used_at IS NOT NULL AND OLD.used_at IS NULL THEN
        IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'INVITE_REVOKED'; END IF;
        IF OLD.expires_at <= now() THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;
      END IF;
      RETURN NEW;
    END $fn$;

    ALTER TABLE guarantee_invites DROP CONSTRAINT gi_inviter_note_length;
    ALTER TABLE guarantee_invites DROP COLUMN inviter_note;
  `);
}
