const baseUrl = (process.env.E2E_BASE_URL ?? 'https://localhost/api/v1').replace(/\/$/, '');

for (const key of [
  'E2E_MEMBER_A_PHONE', 'E2E_MEMBER_A_PASSWORD',
  'E2E_MEMBER_B_PHONE', 'E2E_MEMBER_B_PASSWORD',
]) {
  if (!process.env[key]) throw new Error(`Thiếu biến môi trường ${key}`);
}

async function request(method, path, { token, body, expected = 200 } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  if (response.status !== expected) {
    throw new Error(`${method} ${path}: cần HTTP ${expected}, nhận ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

const login = (phone, password) => request('POST', '/auth/login', {
  body: { identifier: phone, password },
});

// Giữ tuần tự ở smoke script. Runtime phải chịu được nhiều người dùng đồng
// thời, nhưng chính bài smoke không nên cố ý tạo tải cạnh tranh lên audit chain.
const loginA = await login(process.env.E2E_MEMBER_A_PHONE, process.env.E2E_MEMBER_A_PASSWORD);
const loginB = await login(process.env.E2E_MEMBER_B_PHONE, process.env.E2E_MEMBER_B_PASSWORD);
const identityA = await request('GET', '/auth/me', { token: loginA.access });
const profileA = await request('GET', '/members/me', { token: loginA.access });
const identityB = await request('GET', '/auth/me', { token: loginB.access });
const profileB = await request('GET', '/members/me', { token: loginB.access });

if (identityA.actor.id !== profileA.id || identityB.actor.id !== profileB.id) {
  throw new Error('UUID từ /auth/me không khớp /members/me');
}
if (profileA.id === profileB.id) throw new Error('Hai tài khoản E2E đang trỏ tới cùng một thành viên');

const runId = new Date().toISOString();
const sentA = await request('POST', '/messages', {
  token: loginA.access,
  expected: 201,
  body: { recipient_id: profileB.id, body: `E2E A -> B ${runId}` },
});
const sentB = await request('POST', '/messages', {
  token: loginB.access,
  expected: 201,
  body: { recipient_id: profileA.id, body: `E2E B -> A ${runId}` },
});
const threadA = await request('GET', `/messages?with_member_id=${profileB.id}&limit=100`, { token: loginA.access });
const threadB = await request('GET', `/messages?with_member_id=${profileA.id}&limit=100`, { token: loginB.access });
const relationsA = await request('GET', '/members/me/relations', { token: loginA.access });
await request('POST', '/messages', {
  token: loginA.access,
  expected: 422,
  body: { recipient_id: profileA.id, body: 'self message must fail' },
});

const result = {
  identity_a_matches_profile: identityA.actor.id === profileA.id,
  identity_b_matches_profile: identityB.actor.id === profileB.id,
  a_sent: `${sentA.sender_name} -> ${sentA.recipient_name}`,
  b_sent: `${sentB.sender_name} -> ${sentB.recipient_name}`,
  a_sees_reply: threadA.data.some((message) => message.id === sentB.id),
  b_sees_message: threadB.data.some((message) => message.id === sentA.id),
  self_send_status: 422,
  relations_contract: ['invited_by', 'invited_members', 'worked_together']
    .every((key) => Array.isArray(relationsA[key])),
};

if (!Object.values(result).every((value) => value !== false)) {
  throw new Error(`Smoke test không đạt: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify(result, null, 2));
