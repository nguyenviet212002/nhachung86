import { config } from '../../config/index.js';
import { consoleAdapter } from './console.js';

const adapters = { console: consoleAdapter };

export function otpAdapter() {
  const a = adapters[config.OTP_ADAPTER];
  if (!a) throw new Error(`Chưa cài adapter OTP "${config.OTP_ADAPTER}"`);
  return a;
}
