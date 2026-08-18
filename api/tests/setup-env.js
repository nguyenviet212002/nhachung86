// Ruling C2: nạp api/.env.test vào process.env trước khi bất kỳ test nào chạy,
// vì config/index.js gọi process.exit(1) nếu thiếu biến — mọi test import
// gián tiếp tới nó. Không thêm phụ thuộc mới (không dùng gói dotenv).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.test');

function parseEnvFile(content) {
  const result = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

let parsed = {};
try {
  parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
} catch {
  // Không có file .env.test — để nguyên process.env, config/index.js sẽ tự báo lỗi
  parsed = {};
}

for (const [key, value] of Object.entries(parsed)) {
  // Biến môi trường thật (vd. đặt sẵn trong CI) luôn thắng giá trị giả ở .env.test
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
