/**
 * AWS Signature Version 4（S3）—— 零依赖实现，基于 Web Crypto。
 * 兼容 Cloudflare R2 / AWS S3 / MinIO / COS / OSS 等所有 S3 协议存储。
 * 仅服务端使用（密钥不落前端）。
 */

const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === "string" ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", buf as ArrayBuffer);
  return toHex(digest);
}

async function hmacRaw(key: ArrayBuffer, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(msg));
}

async function hmacHex(key: ArrayBuffer, msg: string): Promise<string> {
  return toHex(await hmacRaw(key, msg));
}

/**
 * S3 要求对 URI 每段单独编码（保留 / 不编码）。
 * 这与 encodeURIComponent 的区别：后者会编码 !'()* 等，S3 不要求但可接受；
 * 关键是 / 必须保留。
 */
function encodeS3Path(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/%2F/g, "/"))
    .join("/");
}

/** 安全解码，失败时原样返回 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 路径归一化：把可能已经被编码过的 pathname 还原成原始字符，再统一编码。
 * 保证幂等 —— 调用方传编码或未编码的路径都能得到同一个 canonical URI，
 * 否则会出现双重编码（%20 → %2520）导致签名不匹配。
 */
export function normalizeS3Path(path: string): string {
  let current = path;
  // 最多解 3 层，防止病态输入
  for (let i = 0; i < 3; i += 1) {
    const decoded = safeDecode(current);
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

/** RFC 3986 编码（比 encodeURIComponent 更严格，额外编码 !'()*） */
function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export interface S3PresignParams {
  endpoint: string;
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 有效期（秒），默认 15 分钟 */
  expiresIn?: number;
  /**
   * 寻址风格：true = path-style（endpoint/bucket/key），
   * false = virtual-host（bucket.endpoint/key）。
   * 不传则按 endpoint 自动推断。
   */
  forcePathStyle?: boolean;
}

/**
 * 推断寻址风格。
 *
 * 这是 S3 兼容性最容易翻车的地方 —— 各家默认不一样：
 *
 * | 服务     | 风格           |
 * |----------|----------------|
 * | R2       | path-style ✅  |
 * | MinIO    | path-style ✅  |
 * | Supabase | path-style ✅  |
 * | 内网/本机 | path-style ✅  |
 * | AWS S3   | virtual-host   |
 * | B2       | virtual-host   |
 *
 * 写死 path-style 的话，B2 / AWS 会 307 重定向或直接 403；
 * 反过来写死 virtual-host，自建 MinIO 又解析不了。
 * 所以按 endpoint 自动判断，同时允许显式覆盖。
 */
export function inferPathStyle(endpoint: string): boolean {
  const host = (() => {
    try {
      return new URL(endpoint.replace(/\/+$/, "")).hostname;
    } catch {
      return endpoint;
    }
  })();

  // R2 / MinIO / 私有部署：明确用 path-style
  if (/r2\.cloudflarestorage\.com$/i.test(host)) return true;
  if (/r2\.dev$/i.test(host)) return true;
  if (/^minio/i.test(host)) return true;

  /**
   * Supabase Storage 的 S3 兼容层**只接受 path-style**。
   *
   * ⚠️ 它的 host 是 <ref>.supabase.co / <ref>.storage.supabase.co，
   * 不匹配上面任何一条规则，会掉到最后的 virtual-host ——
   * 结果签名出来的 URL 是 https://bucket.ref.supabase.co/... 这种形式，
   * Supabase 根本解析不了，上传直接失败。
   *
   * 官方文档和多方实践都要求客户端设 forcePathStyle: true。
   */
  if (/supabase\.co$/i.test(host)) return true;
  if (/supabase\.(in|net|org)$/i.test(host)) return true;

  /**
   * 七牛云 Kodo：官方文档说两种风格都支持，但 virtual-host 需要
   * <bucket>.s3.<region>.qiniucs.com 这种带地域的泛域名解析，
   * 实际部署里经常解析不到；path-style 则稳定可用（官方 s3fs 指南
   * 也明确要求 use_path_request_style）。统一走 path-style 更省心。
   */
  if (/qiniucs\.com$/i.test(host)) return true;

  // IP 地址或 localhost 无法做 virtual-host（证书和 DNS 都不支持）
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return true;
  if (/^(localhost|127\.0\.0\.1)$/i.test(host)) return true;
  if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  // 其余（AWS、B2、大部分云厂商）用 virtual-host
  return false;
}

/**
 * 生成预签名 PUT URL。
 * 浏览器拿到后直接 PUT 到对象存储，文件不经过 Vercel
 * （Vercel Serverless 请求体上限仅 4.5MB，无法代理大文件）。
 */
export async function presignS3Put(params: S3PresignParams): Promise<string> {
  const {
    endpoint,
    bucket,
    key,
    region,
    accessKeyId,
    secretAccessKey,
    expiresIn = 900,
    forcePathStyle,
  } = params;

  const base = endpoint.replace(/\/+$/, "");
  const cleanKey = normalizeS3Path(key).replace(/^\/+/, "");

  /**
   * 两种寻址风格拼出来的 URL 完全不同，host 也随之变化 ——
   * 而 host 要参与签名，所以必须先定风格再算 URL。
   */
  const pathStyle = typeof forcePathStyle === "boolean" ? forcePathStyle : inferPathStyle(base);

  let url: string;
  if (pathStyle) {
    // https://endpoint/bucket/key
    url = base + (encodeS3Path(`/${bucket}/${cleanKey}`) || "/");
  } else {
    // https://bucket.endpoint/key
    const u = new URL(base);
    u.hostname = `${bucket}.${u.hostname}`;
    url = u.origin + (encodeS3Path(`/${cleanKey}`) || "/");
  }

  const parsed = new URL(url);
  const host = parsed.host;

  const amzDateStr = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDateStr.slice(0, 8);
  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": `${accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDateStr,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(queryParams[k])}`)
    .join("&");

  const canonicalHeaders = `host:${host}\n`;
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    parsed.pathname,
    canonicalQueryString,
    canonicalHeaders,
    "host",
    payloadHash,
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDateStr,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(secretAccessKey, dateStamp, region);
  const signature = await hmacHex(signingKey, stringToSign);

  return `${parsed.toString()}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export interface S3SignParams {
  method: "PUT" | "GET" | "DELETE" | "HEAD";
  /** 完整 URL，例如 https://xxx.r2.cloudflarestorage.com/bucket/key.png */
  url: string;
  body: ArrayBuffer;
  contentType: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** 自定义元数据（可选） */
  amzDate?: Date;
}

export interface S3SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** 生成 Signing Key：HMAC 链 */
export async function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = "s3",
): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(encoder.encode(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
}

/** 对一次 S3 请求签名，返回可直接 fetch 的 url + headers */
export async function signS3Request(params: S3SignParams): Promise<S3SignedRequest> {
  const {
    method,
    url,
    body,
    contentType,
    accessKeyId,
    secretAccessKey,
    region,
    amzDate = new Date(),
  } = params;

  const parsed = new URL(url);
  const host = parsed.host;
  // 先归一化（幂等解码），再按 S3 规则编码，避免双重编码。
  // 必须用编码后的路径重建 URL：签名用的 canonical URI 必须与最终发出的
  // 请求行完全一致，否则服务端按原文校验会判签名不匹配。
  const canonicalUri = encodeS3Path(normalizeS3Path(parsed.pathname)) || "/";
  const target = new URL(parsed.origin + canonicalUri + (parsed.search || ""));

  const amzDateStr = amzDate.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDateStr.slice(0, 8);

  const payloadHash = await sha256Hex(body);

  // 参与签名的 header 必须按字母序排列
  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDateStr,
  };
  if (contentType) headers["content-type"] = contentType;
  const outHeaders: Record<string, string> = { ...headers };

  // CanonicalQueryString：按参数名排序后 URI 编码（PUT 通常为空，此处保证通用性）
  const canonicalQueryString = parsed.search
    ? Array.from(parsed.searchParams.entries())
        .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("&")
    : "";

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${String(headers[k]).trim()}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    algorithm,
    amzDateStr,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await deriveSigningKey(secretAccessKey, dateStamp, region);
  const signature = await hmacHex(signingKey, stringToSign);

  const authorization =
    `${algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: target.toString(),
    headers: {
      ...outHeaders,
      ...(contentType ? { "content-type": contentType } : {}),
      authorization,
    },
  };
}
