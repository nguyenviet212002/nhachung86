import crypto from 'node:crypto';
import argon2 from 'argon2';
import { seedKnex } from '../src/db/seeds/db.js';

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const requestedId = (process.env.ADMIN_MEMBER_ID || '').trim();
const generatePassword = process.env.ADMIN_GENERATE_PASSWORD === 'true';
const password = process.env.ADMIN_PASSWORD || (generatePassword
  ? `NC86!${crypto.randomBytes(12).toString('base64url')}`
  : '');

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  throw new Error('ADMIN_EMAIL phải là một địa chỉ email hợp lệ.');
}
if (password.length < 12) {
  throw new Error('Cần ADMIN_PASSWORD tối thiểu 12 ký tự hoặc ADMIN_GENERATE_PASSWORD=true.');
}

const roles = ['member', 'content_ops', 'approver', 'tech'];
const db = seedKnex();

try {
  const result = await db.transaction(async (trx) => {
    // Đây là đường khởi tạo của người vận hành khi cộng đồng chưa có vai tech.
    // Để actor rỗng để trigger member_roles chỉ mở đúng nhánh hệ thống.
    await trx.raw(`SELECT set_config('app.actor_id', '', true)`);

    let member = null;
    if (requestedId) {
      ({ rows: [member] } = await trx.raw(
        `SELECT id, community_id, full_name FROM members
          WHERE id = ? AND status = 'member' FOR UPDATE`,
        [requestedId]
      ));
    } else {
      ({ rows: [member] } = await trx.raw(
        `SELECT m.id, m.community_id, m.full_name
           FROM members m
          WHERE m.status = 'member'
            AND (
              lower(m.email) = lower(?)
              OR EXISTS (
                SELECT 1 FROM member_roles mr
                JOIN roles r ON r.id = mr.role_id
                WHERE mr.member_id = m.id
                  AND mr.community_id = m.community_id
                  AND r.key = 'approver'
              )
            )
          ORDER BY (lower(m.email) = lower(?)) DESC, m.created_at, m.id
          LIMIT 1 FOR UPDATE`,
        [email, email]
      ));
    }

    if (!member) {
      throw new Error('Không có thành viên chính thức để nâng thành tài khoản quản trị.');
    }

    const passwordHash = await argon2.hash(password);
    await trx.raw(
      `UPDATE members
          SET email = ?, password_hash = ?, updated_at = now()
        WHERE id = ? AND community_id = ?`,
      [email, passwordHash, member.id, member.community_id]
    );

    for (const role of roles) {
      await trx.raw(
        `INSERT INTO member_roles (member_id, role_id, community_id)
         SELECT ?, r.id, ? FROM roles r
          WHERE r.key = ?
            AND NOT EXISTS (
              SELECT 1 FROM member_roles mr
               WHERE mr.member_id = ? AND mr.role_id = r.id AND mr.community_id = ?
            )`,
        [member.id, member.community_id, role, member.id, member.community_id]
      );
    }

    await trx.raw(
      `INSERT INTO audit_log
        (community_id, actor_id, action, target_type, target_id, detail)
       VALUES (?, NULL, 'admin.bootstrap', 'member', ?, ?::jsonb)`,
      [member.community_id, member.id, JSON.stringify({ roles, password_rotated: true })]
    );

    return { ...member, email, roles };
  });

  console.log(JSON.stringify({
    ok: true,
    member_id: result.id,
    full_name: result.full_name,
    email: result.email,
    roles: result.roles,
    ...(generatePassword ? { generated_password: password } : {}),
  }));
} finally {
  await db.destroy();
}
