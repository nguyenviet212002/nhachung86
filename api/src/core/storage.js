import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { config } from '../config/index.js';

// ---------------------------------------------------------------------------
// Kho lưu trữ — nơi DUY NHẤT trong `api/` biết byte nằm ở đâu.
//
// NÓI THẲNG ĐIỀU QUAN TRỌNG NHẤT VỀ TỆP NÀY: ở đây KHÔNG CÓ tầng cưỡng chế.
// PostgreSQL có `community_id`, có trigger, có ma trận quyền theo bảng. MinIO
// và thư mục trên đĩa thì không — chúng chỉ biết "khoá này, byte kia". Nghĩa
// là mọi luật về AI ĐỌC ĐƯỢC GÌ nằm hoàn toàn ở `modules/files/service.js` và
// ở bảng `files` (migration 030), và ai đi vòng qua API thì không luật nào
// chạm tới được họ. Ba thứ đứng thay:
//
//   1. `proxy/Caddyfile` không có route nào tới `storage` — từ Internet không
//      có đường nào tới bucket, chỉ `api` và `backup` trong mạng nội bộ tới
//      được (đặc tả mục 1.2 dòng 48).
//   2. Bucket là PRIVATE, không presigned URL, không bucket policy công khai.
//   3. `storage_key` sinh ngẫu nhiên (uuid v4) và KHÔNG BAO GIỜ ra tới client
//      — biết `files.id` không suy ra được khoá kho.
//
// Cả ba đều là hàng rào vận hành, không phải ràng buộc dữ liệu. Xem câu hỏi 1
// trong `task-15-report.md`, chỗ đó nói rõ giới hạn thay vì che nó.
//
// HAI TRÌNH ĐIỀU KHIỂN, chọn theo cấu hình chứ không theo `NODE_ENV`:
//   * có `S3_ENDPOINT` ⇒ S3/MinIO (production, dev qua docker-compose)
//   * không có         ⇒ thư mục trên đĩa (test, và máy lập trình chưa dựng
//     MinIO). Không phải bản giả trong bộ nhớ: nó ghi tệp thật, đọc lại thật,
//     nên bài test đi đúng đường mã mà production đi, chỉ khác cái đích.
// ---------------------------------------------------------------------------

const BUCKET = config.S3_BUCKET;
const REGION = config.S3_REGION;
const FS_ROOT = path.resolve(config.STORAGE_DIR);

export const driver = config.S3_ENDPOINT ? 's3' : 'fs';

/**
 * Khoá lưu trữ. Ngẫu nhiên, không mang thông tin nào đoán được từ bên ngoài.
 * Có tiền tố cộng đồng để người vận hành đọc được bucket, và để một lệnh dọn
 * theo cộng đồng có thứ mà quét — KHÔNG phải để phân quyền: MinIO không biết
 * `community_id` nghĩa là gì, việc lọc cộng đồng nằm ở câu SQL.
 */
export function newKey(communityId, ext = 'jpg') {
  return `c/${communityId}/${randomUUID()}.${ext}`;
}

// --------------------------------------------------------------------- fs ---

function fsPathOf(key) {
  // Khoá do máy chủ sinh nên không có `..`, nhưng đường ghi tệp là chỗ một
  // giả định sai trở thành ghi đè tệp hệ thống. Kiểm chứ không tin.
  const full = path.resolve(FS_ROOT, key);
  if (full !== path.resolve(FS_ROOT) && !full.startsWith(path.resolve(FS_ROOT) + path.sep)) {
    throw new Error('khoá lưu trữ trỏ ra ngoài thư mục kho');
  }
  return full;
}

const fsDriver = {
  async put(key, body) {
    const full = fsPathOf(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  },
  async getStream(key) {
    const full = fsPathOf(key);
    await stat(full); // ném ENOENT trước khi trả luồng, để lỗi bắt được ở service
    return createReadStream(full);
  },
  async remove(key) {
    try {
      await unlink(fsPathOf(key));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  },
  async health() {
    try {
      await mkdir(FS_ROOT, { recursive: true });
      return true;
    } catch {
      return false;
    }
  },
};

// --------------------------------------------------------------------- s3 ---
//
// SigV4 viết tay, đúng hai thao tác (PutObject, GetObject) như kế hoạch Task 15
// bước 1 nói. Không thêm phụ thuộc: `@aws-sdk/client-s3` kéo theo vài chục gói
// cho hai lời gọi HTTP, và một phụ thuộc mới là một bề mặt mới phải theo dõi
// bản vá. Đổi lại, đoạn ký dưới đây phải đúng — nó có bài test riêng đối chiếu
// với vector chuẩn của AWS (`t28`).

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * Chữ ký AWS SigV4 cho một request S3. Tách ra khỏi lời gọi mạng để kiểm thử
 * được mà không cần MinIO — đây là phần dễ sai và khó thấy sai nhất.
 */
export function signV4({ method, endpoint, key, payloadHash, now, accessKey, secretKey, bucket = BUCKET, region = REGION }) {
  const url = new URL(`${endpoint.replace(/\/+$/, '')}/${bucket}/${key}`);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260820T101112Z
  const dateStamp = amzDate.slice(0, 8);

  // Từng đoạn của đường dẫn phải được mã hoá; dấu `/` phân đoạn thì không.
  const canonicalUri = url.pathname
    .split('/')
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join('/');

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join('');

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${secretKey}`, dateStamp);
  for (const part of [region, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    url: url.toString(),
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function s3Request(method, key, body) {
  const payloadHash = sha256Hex(body ?? '');
  const { url, headers } = signV4({
    method,
    endpoint: config.S3_ENDPOINT,
    key,
    payloadHash,
    now: new Date(),
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
  });
  const res = await fetch(url, { method, headers, body });
  if (!res.ok) {
    // KHÔNG đưa thân phản hồi của kho vào thông điệp lỗi: nó chứa khoá đối
    // tượng, tức đường tắt tới byte của một người cụ thể.
    const e = new Error(`kho lưu trữ trả ${res.status} cho ${method}`);
    e.storageStatus = res.status;
    throw e;
  }
  return res;
}

const s3Driver = {
  async put(key, body) {
    await s3Request('PUT', key, body);
  },
  async getStream(key) {
    const res = await s3Request('GET', key);
    return Readable.fromWeb(res.body);
  },
  async remove(key) {
    try {
      await s3Request('DELETE', key);
    } catch (e) {
      if (e.storageStatus !== 404) throw e;
    }
  },
  async health() {
    try {
      // HEAD trên một khoá chắc chắn không tồn tại: 404 nghĩa là kho SỐNG và
      // trả lời được, chỉ là không có tệp đó. Chỉ lỗi mạng mới là kho chết.
      await s3Request('HEAD', '_health_probe_khong_ton_tai');
      return true;
    } catch (e) {
      return e.storageStatus === 404 || e.storageStatus === 403;
    }
  },
};

const impl = driver === 's3' ? s3Driver : fsDriver;

export const put = (key, body) => impl.put(key, body);
export const getStream = (key) => impl.getStream(key);
export const remove = (key) => impl.remove(key);
export const health = () => impl.health();
