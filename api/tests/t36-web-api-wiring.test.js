import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
const apiClient = readFileSync(new URL('../../web/js/api.js', import.meta.url), 'utf8');

describe('T36 hợp đồng nối web với API thành viên và việc làm', () => {
  it('các nhóm chức năng E2E đều gọi API thật từ index.html', () => {
    for (const path of [
      '/auth/login', '/auth/register', '/auth/me', '/members/me', '/members/',
      '/members/me/privacy', '/members/me/profile-views', '/members/me/relations', '/capabilities', '/jobs',
      '/jobs/ready/me', '/messages', '/notifications', '/notifications/stream',
      '/files', '/guarantee-invites', '/join-requests/',
    ]) {
      expect(html, `index.html thiếu đường API ${path}`).toContain(path);
    }
    expect(apiClient).toContain('patch:function');
  });

  it('thông báo/tin nhắn realtime có tiếng và mở đúng nội dung', () => {
    expect(html).toContain('new EventSource');
    expect(html).toContain("notificationStream.addEventListener('message'");
    expect(html).toContain('playTing()');
    expect(html).toContain('open-notification');
    expect(html).toContain('liveConversationSummaries');
    expect(html).toContain("state.activeConvo!==currentActorId()");
    expect(html).toContain("identity.actor.id!==profile.id");
    expect(html).toContain("typeof row.area==='object'");
  });

  it('màn quan hệ đọc API thật và phân biệt đúng hai chiều mời', () => {
    expect(html).toContain("api.get('/members/me/relations')");
    expect(html).toContain('R.invited_by');
    expect(html).toContain('R.invited_members');
    expect(html).toContain('R.worked_together');
  });

  it('không dựng vai recruiter tách khỏi thành viên', () => {
    expect(html).not.toMatch(/key:\s*['"]recruiter['"]/);
    expect(html).toContain('Một tài khoản thành viên có thể tìm người, đăng năng lực, đăng nhu cầu tuyển/hợp tác, ứng tuyển');
  });

  it('hồ sơ chỉ hiển thị dữ liệu thật và không còn nhãn vai trò hay ảnh bìa giả', () => {
    expect(html).not.toContain('Vai thật:');
    expect(html).not.toContain('Ảnh bìa nghề nghiệp');
    expect(html).toContain('u.participation_history||[]');
    expect(html).toContain('u.work_summary||');
    expect(html).toContain('referrer?.inviter_note');
    expect(html).toContain("api.post('/guarantee-invites', {inviter_note:inviterNote})");
  });

  it('ảnh đại diện được ghi bằng API và nạp lại từ đường dẫn file đã lưu', () => {
    expect(html).toContain("api.patch('/members/me',{avatar_url:avatarPath})");
    expect(html).toContain('CURRENT_USER.avatar_url=avatarPath');
    expect(html).toContain('CURRENT_USER.avatar=url');
    expect(html).toContain('CURRENT_USER.avatar=LIVE_FILE_URLS[path]');
    expect(html).toContain("const profile=await api.get('/members/me')");
  });
});
