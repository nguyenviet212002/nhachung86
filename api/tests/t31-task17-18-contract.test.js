import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(resolve(ROOT, file), 'utf8');

function withoutShellComments(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('Task 17–18 — hợp đồng seed, scheduler và backup', () => {
  it('backup scripts luôn ghi nhận kết quả và không tắt trigger khi restore', () => {
    const backup = read('backup/backup.sh');
    const verify = read('backup/verify.sh');
    const restore = read('backup/restore.sh');

    expect(backup).toMatch(/trap finish EXIT/);
    expect(backup).toMatch(/record_backup 'full'/);
    expect(backup).toMatch(/pg_dump .* -Fc/);

    const active = withoutShellComments(`${verify}\n${restore}`);
    expect(active).not.toMatch(/--disable-triggers/);
    expect(active).not.toMatch(/session_replication_role\s*=\s*replica/);
    expect(restore).toMatch(/pending_action_id khong phai UUID hop le/);
    expect(restore).toMatch(/RESTORE_TARGET_DB chi duoc la ten database PostgreSQL hop le/);
  });

  it('policy backup chỉ đọc kho ảnh, ghi kho đối chiếu và cấm xoá', () => {
    const policy = JSON.parse(read('backup/policy/backup.json'));
    const auditAllow = policy.Statement.find((s) => s.Sid === 'ChiGhiThemVaoKhoNhatKy');
    const deny = policy.Statement.find((s) => s.Sid === 'KhongBaoGioDuocXoa');

    expect(auditAllow.Effect).toBe('Allow');
    expect(auditAllow.Action).toContain('s3:PutObject');
    expect(auditAllow.Action).not.toContain('s3:DeleteObject');
    expect(deny.Effect).toBe('Deny');
    expect(deny.Action).toEqual(expect.arrayContaining([
      's3:DeleteObject',
      's3:DeleteObjectVersion',
      's3:DeleteBucket',
    ]));
  });

  it('wiring backup và timezone dùng đường dẫn container nhất quán', () => {
    const compose = read('docker-compose.yml');
    const env = read('.env.example');
    const dockerfile = read('api/Dockerfile');
    const storageInit = read('backup/storage-init.sh');
    const entrypoint = read('backup/entrypoint.sh');

    expect(compose).toMatch(/TZ:\s*Asia\/Ho_Chi_Minh/);
    expect(compose).toMatch(/S3_BUCKET:\s*\$\{S3_BUCKET:-nhachung\}/);
    expect(compose).toMatch(/BACKUP_S3_BUCKET:\s*\$\{BACKUP_S3_BUCKET:-nhachung-audit\}/);
    expect(compose).toMatch(/\.\/secrets:\/secrets:ro/);
    expect(env).toMatch(/GDRIVE_SERVICE_ACCOUNT_FILE=\/secrets\/google-service-account\.json/);
    expect(dockerfile).toMatch(/ENV TZ=Asia\/Ho_Chi_Minh/);
    expect(storageInit).toMatch(/mc mb --ignore-existing --with-lock root\/nhachung-audit/);
    expect(storageInit).toMatch(/mc admin policy info root nhachung-backup/);
    expect(entrypoint).toMatch(/crond -d -l 8/);
  });

  it('API chỉ mở server sau khi migration thành công và healthcheck phản ánh DB', () => {
    const entrypoint = read('api/docker-entrypoint.sh');
    const dockerfile = read('api/Dockerfile');

    expect(entrypoint.indexOf('npx knex migrate:latest')).toBeGreaterThanOrEqual(0);
    expect(entrypoint.indexOf('npx knex migrate:latest')).toBeLessThan(entrypoint.indexOf('exec node src/server.js'));
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*api\/v1\/health/);
    expect(dockerfile).toMatch(/j\.ok\?0:1/);
  });
});
