import { describe, it, expect } from 'vitest';
import { assertSafeDetail } from '../src/core/audit.js';

describe('T11 detail không chứa dữ liệu cá nhân', () => {
  it('chấp nhận tên trường, uuid, số đếm, HMAC', () => {
    expect(() => assertSafeDetail({
      field: 'phone', count: 20, ok: true,
      target: '11111111-1111-1111-1111-111111111111',
      phone_hash: 'a'.repeat(64),
    })).not.toThrow();
  });

  it('từ chối số điện thoại thô', () => {
    expect(() => assertSafeDetail({ phone: '0912 345 678' })).toThrow(/dữ liệu cá nhân/);
  });

  it('từ chối câu văn tự do', () => {
    expect(() => assertSafeDetail({ note: 'Anh Hùng ở Khoái Châu, gọi số 09...' }))
      .toThrow(/dữ liệu cá nhân/);
  });
});
