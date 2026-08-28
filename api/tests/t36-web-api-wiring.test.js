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
      '/files', '/guarantee-invites', '/join-requests/', '/projects',
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
    expect(html).toContain("section('Đã cùng làm việc',R.worked_together");
    expect(html).not.toContain('Quan hệ mời có hướng');
    expect(html).not.toContain('người mời là <b>member_a</b>');
    expect(html).not.toContain('Dữ liệu thật từ sợi mời gia nhập');
  });

  it('không dựng vai recruiter/poster tách khỏi thành viên', () => {
    // Bản cũ (trước 2026-08-21) có mảng ROLES mô phỏng với vai 'poster' ("Nhà
    // tuyển dụng") tách khỏi 'member'. Mảng ROLES đó đã bị xoá hẳn khi hệ vai
    // thật (hasActualRole/canModerate/canFund/isOperator, đọc state.me.roles)
    // thay chỗ nó — không còn "hint" mô tả vai để mà đọc lại. Bài test này giờ
    // canh đúng bất biến mà nó luôn muốn canh: KHÔNG có vai account-level nào
    // tên 'recruiter' hay 'poster', và đăng việc là việc của MỌI tài khoản
    // thành viên — JobPostPage không tự gọi roleGate/canModerate/canFund/
    // isOperator, khác hẳn FundLedgerPage hay backup center.
    expect(html).not.toMatch(/key:\s*['"]recruiter['"]/);
    expect(html).not.toMatch(/key:\s*['"]poster['"]/);
    expect(html).toContain("case 'jobPost': return JobPostPage();");
    const fnStart = html.indexOf('function JobPostPage(');
    expect(fnStart, 'không tìm thấy function JobPostPage(...)').toBeGreaterThan(-1);
    const fnBody = html.slice(fnStart, fnStart + 500);
    expect(fnBody).not.toMatch(/roleGate\(|canModerate\(\)|canFund\(\)|isOperator\(\)/);
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

  it('sổ ký ức live đọc lịch sử từ hồ sơ API thay vì dữ liệu demo', () => {
    expect(html).not.toContain('Sổ ký ức của tôi');
    expect(html).not.toContain('Những việc đã làm được cho anh em, ghi lại có tên người và có ngày tháng.');
    expect(html).toContain('const liveItems=profileHistory(CURRENT_USER)');
    expect(html).toContain("data-action=\"profile-refresh\"");
    expect(html).toContain("toast('Đã làm mới lịch sử từ API.')");
  });

  it('năng lực đi từ nhóm thật tới danh sách người rồi hồ sơ chi tiết', () => {
    expect(html).toContain('loadAllCapabilities()');
    expect(html).toContain("data-route=\"skillGroup\"");
    expect(html).toContain('function CapabilityGroupPage()');
    expect(html).toContain('function CapabilityPersonPage()');
    expect(html).toContain("api.get('/capabilities/'+encodeURIComponent(id))");
    expect(html).toContain('function LiveCapabilityDetailPage()');
    expect(html).toContain('years_experience');
    expect(html).toContain("label:'Năng lực mới công bố'");
    expect(html).toContain("label:'Cộng đồng đang thiếu'");
    expect(html).not.toContain("label:'Triển lãm giá trị thật'");
    expect(html).toContain('CAPABILITY_CATEGORIES');
    expect(html).toContain('CAPABILITY_GROUP_DEFS');
    expect(html).toContain('cap-groups');
    expect(html).toContain('skill-category');
    expect(html).toContain('skill-area');
    expect(html).toContain('Cộng đồng đang thiếu');
    expect(html).toContain('service_area');
    expect(html).toContain('wz-sk-scope');
    expect(html).toContain('captureWizardData');
    expect(html).toContain('restoreWizardData');
    expect(html).toContain('.modal>form');
    expect(html).toContain('overflow-x:auto');
  });

  it('việc chung live tạo, chờ admin duyệt, sửa/xóa và tham gia qua API', () => {
    expect(html).toContain("api.get('/projects?limit=100')");
    expect(html).toContain("api.get('/projects?status=planned&limit=100')");
    expect(html).toContain("api.get('/projects?mine=true&limit=100')");
    expect(html).toContain("api.get('/projects/'+encodeURIComponent(id))");
    expect(html).toContain("api.post('/projects'");
    expect(html).toContain("api.patch(`/projects/${encodeURIComponent(id)}`,{status:'open'})");
    expect(html).toContain("api.del(`/projects/${encodeURIComponent(id)}`)");
    expect(html).toContain("api.post(`/projects/${encodeURIComponent(id)}/join`,{})");
    expect(html).toContain('const list=liveMode()?LIVE_PROJECTS:PROJECTS');
    expect(html).toContain("data-action=\"projects-refresh\"");
    expect(html).toContain("data-action=\"project-moderation-refresh\"");
    expect(html).toContain("data-action=\"my-projects-refresh\"");
    expect(html).toContain("case 'projectModeration': return ProjectModerationPage()");
    expect(html).toContain('function ProjectModerationPage(){');
    expect(html).toContain('projectModerationBadgeCount');
    expect(html).toContain('projectApprovalNotice');
    expect(html).toContain("go('projectModeration')");
    expect(html).toContain("name==='editProject'");
    expect(html).toContain('const PROJECT_CATS');
    expect(html).toContain('${PROJECT_CATS.map');
    expect(html).toContain('id="pj-image"');
    expect(html).toContain('id="epj-image"');
    expect(html).toContain('function uploadProjectImage');
    expect(html).toContain('image_url:imageUrl');
    expect(html).toContain('pj-start-date');
    expect(html).toContain('pj-start-time');
    expect(html).toContain('pj-end-date');
    expect(html).toContain('epj-end-date');
    expect(html).toContain('pj-location');
    expect(html).toContain('Thời gian kết thúc phải sau thời gian bắt đầu.');
  });

  it('phát việc, giới thiệu và theo dõi dùng chung một luồng job_needs', () => {
    expect(html).toContain('function JobDistributionPanel(j, owner, mine)');
    expect(html).toContain("api.post(`/jobs/${encodeURIComponent(jid)}/introductions`");
    expect(html).toContain("api.patch(`/jobs/${encodeURIComponent(actionEl.dataset.job)}/introductions/");
    expect(html).toContain('data-action="job-introduce"');
    expect(html).toContain('data-action="job-intro-consent"');
    // JobsPage() được đổi tên thành JobsWorkspacePage() ở lượt dựng lại giao
    // diện (2026-08-2x) — cùng hàm, cùng route 'signals', chỉ đổi tên.
    expect(html).toContain("case 'signals': return JobsWorkspacePage();");
    // "Một luồng duy nhất..." (câu cũ) được viết lại thành tiêu đề+phụ đề của
    // chính JobDistributionPanel — vẫn cùng một khẳng định: một nguồn dữ liệu
    // duy nhất từ lúc phát nhu cầu tới lúc thành kết nối, không tách luồng.
    expect(html).toContain('Một nguồn dữ liệu từ lúc phát nhu cầu đến lúc thành kết nối');
  });
});
