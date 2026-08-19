// Adapter môi trường phát triển — chỉ in mã ra log console, không gửi đi đâu
// cả. Cộng đồng chưa có tài khoản Zalo ZNS hay SMS gateway nào; cắm nhà cung
// cấp thật vào adapters{} của index.js khi có tài khoản, không đổi chữ ký
// send({ phone, code, purpose }).
export const consoleAdapter = {
  name: 'console',
  async send({ phone, code, purpose }) {
    console.log(`[OTP:${purpose}] ${phone} -> ${code}`);
  },
};
