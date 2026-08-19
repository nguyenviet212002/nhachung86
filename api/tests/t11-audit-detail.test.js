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

  // Vòng soát xét 1 (Important): regex hình dạng token ('/^[A-Za-z0-9_.:-]{1,64}$/')
  // chỉ kiểm TẬP KÝ TỰ dùng, không phân biệt được 'SELF_ONLY' với '0912345678'
  // — cả hai đều là chuỗi chữ/số/dấu gạch dưới hợp lệ về mặt hình dạng. Bài T11
  // gốc chỉ thử số điện thoại CÓ khoảng trắng ('0912 345 678'), vốn đã bị chặn
  // vì khoảng trắng không nằm trong tập ký tự cho phép — không hề chạm tới lỗ
  // hổng thật: số điện thoại/CCCD/số tài khoản KHÔNG có khoảng trắng vẫn lọt
  // qua nguyên vẹn. Khối dưới đây phủ đúng bảng thử của vòng soát xét 1.
  describe('token toàn chữ số (bẫy còn sót sau lần sửa trước — số điện thoại/CCCD/số tài khoản)', () => {
    it.each([
      ['SELF_ONLY', 'mã enum, không chữ số'],
      ['GUARANTEE_QUOTA_EXCEEDED', 'mã enum, không chữ số'],
      ['phone', 'tên trường'],
      ['field_key', 'tên trường'],
      ['007_audit_log.js', 'có chữ cái, dưới 6 chữ số liền ý nghĩa'],
      ['page:2', 'chỉ 1 chữ số'],
      ['v1.2', 'chỉ 2 chữ số'],
    ])('cho qua: %s (%s)', (value) => {
      expect(() => assertSafeDetail({ v: value })).not.toThrow();
    });

    it.each([
      ['0912345678', 'số điện thoại không dấu phân cách'],
      ['0912-345-678', 'số điện thoại có dấu gạch ngang'],
      ['0912 345 678', 'số điện thoại có khoảng trắng'],
      ['001234567890', 'giống số CCCD 12 chữ số'],
      ['19012345678901', 'giống số tài khoản ngân hàng'],
    ])('từ chối: %s (%s)', (value) => {
      expect(() => assertSafeDetail({ v: value })).toThrow(/dữ liệu cá nhân/);
    });

    it('uuid vẫn được chấp nhận dù toàn chữ số + gạch ngang (khớp nhánh uuid trước, không rơi vào nhánh token)', () => {
      expect(() => assertSafeDetail({ v: '11111111-1111-1111-1111-111111111111' })).not.toThrow();
    });

    it('băm HMAC-SHA256 64 hex vẫn được chấp nhận dù có thể toàn chữ số (khớp nhánh hex64 trước)', () => {
      expect(() => assertSafeDetail({ v: '0'.repeat(64) })).not.toThrow();
    });
  });
});
