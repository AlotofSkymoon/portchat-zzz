/**
 * TOTP（RFC 6238）两步验证。
 *
 * 为什么自己实现而不装 otplib：
 *   1) 项目要跑在 Cloudflare Workers 上，只能用 Web Crypto；
 *      otplib 依赖 Node 的 crypto 模块，Workers 上没有。
 *   2) 这里只需要「生成密钥 + 校验 6 位码」两个能力。
 *
 * 与标准验证器 App（Google Authenticator / 1Password / Authy）互通：
 * 密钥用 base32、30 秒步长、6 位、SHA-1 —— 这是所有 App 都支持的最小公约数。
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** TOTP 参数（改了会导致已绑定的验证器全部失效，别乱动） */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** 校验时允许前后各漂移多少个步长（补偿手机时钟不准） */
export const TOTP_WINDOW = 1;

/* ------------------------------ base32 ------------------------------ */

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  // 规范化：去空格、转大写 —— 用户手抄密钥时最容易带空格
  const cleaned = input.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("密钥含非法字符：" + ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* ------------------------------ 密钥 ------------------------------ */

/** 生成一个新的 base32 密钥（默认 160 bit，与主流 App 一致） */
export function generateTotpSecret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** 供验证器 App 扫描的 otpauth:// 链接 */
export function otpauthUri(params: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? "Portchat";
  const label = encodeURIComponent(`${issuer}:${params.account}`);
  const q = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/* ------------------------------ 算法 ------------------------------ */

function counterBytes(counter: number): Uint8Array {
  // 高 32 位固定 0，低 32 位大端 —— counter 不会超过 2^32
  const buf = new Uint8Array(8);
  let c = Math.floor(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = c & 0xff;
    // 用除法而非 >>>，避免超过 32 位时出错
    c = Math.floor(c / 256);
  }
  return buf;
}

async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msg);
  return new Uint8Array(sig);
}

/** HOTP（RFC 4226）：动态截断取 digits 位 */
async function hotp(secret: string, counter: number, digits: number): Promise<string> {
  const key = base32Decode(secret);
  const hmac = await hmacSha1(key, counterBytes(counter));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = Math.pow(10, digits);
  return String(bin % mod).padStart(digits, "0");
}

/** 当前时间步的验证码 */
export function totpNow(secret: string, at: number = Date.now()): Promise<string> {
  return hotp(secret, Math.floor(at / 1000 / TOTP_STEP_SECONDS), TOTP_DIGITS);
}

/**
 * 校验用户输入的验证码。
 *
 * 容差 ±1 个步长（约 ±30 秒）：手机时钟不准、用户输入慢都会导致
 * 刚好跨步。不放宽会让人莫名其妙被拒；放宽太多则安全性下降，±1 是通行做法。
 *
 * 输入允许带空格 / 连字符（"123 456"），先清洗再比对。
 */
export async function verifyTotp(
  secret: string,
  code: string,
  at: number = Date.now(),
  window = TOTP_WINDOW,
): Promise<boolean> {
  const cleaned = String(code ?? "").replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;

  const step = Math.floor(at / 1000 / TOTP_STEP_SECONDS);
  for (let d = -window; d <= window; d++) {
    // 恒定时间比较：避免通过响应耗时逐位猜码
    if (timingSafeEqual(cleaned, await hotp(secret, step + d, TOTP_DIGITS))) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------ 备份码 ------------------------------ */

const BACKUP_CODE_LENGTH = 10;
const BACKUP_COUNT = 8;

/**
 * 生成一次性备份码。
 *
 * 存在的意义很实际：手机丢了 / 验证器删了，人就彻底进不去。
 * 备份码是唯一的自救通道，所以强制要求用户保存。
 *
 * 格式 XXXX-XXXXXX，便于抄写。
 */
export function generateBackupCodes(count = BACKUP_COUNT): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(BACKUP_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    // 只取前 4 位 + 后 6 位的十六进制，避免抄错
    const hex = Array.from(bytes)
      .map((b) => (b % 16).toString(16))
      .join("");
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4)}`);
  }
  return codes;
}

export function normalizeBackupCode(input: string): string {
  return String(input ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

/** 备份码只存哈希 —— 库被拖走也拿不到能直接用的码 */
export async function hashBackupCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeBackupCode(code));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
