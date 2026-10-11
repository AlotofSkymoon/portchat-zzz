import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { getRedis, getValue } from "@/lib/redis";

/**
 * 登录令牌（原二维码登录，现改为一串可输入的字符）。
 *
 * 流程：
 *   1) 已登录设备请求 create → 服务端生成 id + secret
 *   2) 把这串令牌交给另一台设备（复制粘贴，或仍可用 /qr 链接形态）
 *   3) 另一台设备在登录页粘贴令牌 → 用 id+secret 换会话
 *   4) 换成功立刻删除令牌，且**只能换一次**
 *
 * ⚠️ 安全要点：
 * - 服务端只存 secret 的 **hash**，存储被读走也换不出会话
 * - secret 是 32 字节随机数，不可枚举；比较用 timingSafeEqual
 * - 令牌 5 分钟过期，过期自动消失
 * - 一旦被兑换立即删除（需求里的「完成登入后移除 token」）
 * - **同一 IP 在 24 小时内第二次提交同一个令牌 → 令牌立即作废**
 *   （防止把令牌转给别人用；即使第一次已经兑换过，也要确保它彻底失效）
 */

export const QR_TTL_SECONDS = 5 * 60;

/** 同一 IP 复用同一个令牌的统计窗口：24 小时 */
export const QR_IP_WINDOW_SECONDS = 24 * 60 * 60;

const key = (id: string) => `qrlogin:${id}`;

export type QrRecord = {
  secretHash: string;
  userId: string;
  createdAt: number;
};

function hashSecret(id: string, secret: string): string {
  return createHash("sha256").update(`${id}|${secret}`).digest("hex");
}

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newQrId(): string {
  return randomBytes(12).toString("base64url");
}

export async function saveQrToken(
  id: string,
  secret: string,
  userId: string,
): Promise<void> {
  const record: QrRecord = {
    secretHash: hashSecret(id, secret),
    userId,
    createdAt: Date.now(),
  };
  const redis = getRedis();
  await redis.set(key(id), JSON.stringify(record), { ex: QR_TTL_SECONDS });
}

export async function readQrToken(id: string): Promise<QrRecord | null> {
  const raw = await getValue<string>(key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as QrRecord;
  } catch {
    return null;
  }
}

/** 校验 secret 是否匹配。不匹配返回 false，调用方负责限流 */
export async function verifyQrSecret(id: string, secret: string): Promise<string | null> {
  const record = await readQrToken(id);
  if (!record) return null;
  const given = Buffer.from(hashSecret(id, secret), "hex");
  const stored = Buffer.from(record.secretHash, "hex");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;
  return record.userId;
}

/** 兑换完成 / 主动作废：彻底删掉，令牌不可能再用第二次 */
export async function burnQrToken(id: string): Promise<void> {
  await getRedis().del(key(id));
}

/* -------------------------------------------------------------------------- */
/*                          令牌明文：编码 / 解析                              */
/* -------------------------------------------------------------------------- */

/**
 * 令牌明文形态：`{id}.{secret}`
 *
 * base64url 里不含 `.`，拿它当分隔符最省事 —— 用户整段复制时不会
 * 因为粘贴软件自动加空格、换行而解析失败（解析时会先把空白全部去掉）。
 */
export function encodeLoginToken(id: string, secret: string): string {
  return `${id}.${secret}`;
}

/** 展示用：每 12 个字符插一个空格，方便肉眼核对有没有抄漏 */
export function formatLoginToken(token: string): string {
  return token.replace(/(.{12})/g, "$1 ").trim();
}

/**
 * 解析用户粘贴进来的令牌。
 *
 * 三种形态都收：
 *   1. `{id}.{secret}`（现在的主要形态）
 *   2. `/qr?id=...&s=...` 或完整 URL（旧的二维码链接，继续兼容）
 *   3. 带空格 / 换行的上面两种（复制粘贴常见）
 *
 * @returns 解析失败返回 null（调用方负责给出错误提示）
 */
export function parseLoginToken(input: string): { id: string; secret: string } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // 形态 2：URL —— 长度上限先卡一道，避免有人塞个巨大的字符串进来
  if (raw.includes("?") || raw.includes("&") || /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      const id = (u.searchParams.get("id") ?? "").trim();
      const s = (u.searchParams.get("s") ?? "").trim();
      if (id && s) return { id, secret: s };
    } catch {
      /* 解析失败就当普通令牌处理 */
    }
  }

  const flat = raw.replace(/\s+/g, "");
  const dot = flat.indexOf(".");
  if (dot <= 0 || dot === flat.length - 1) return null;
  const id = flat.slice(0, dot);
  const secret = flat.slice(dot + 1);

  // id / secret 都是 base64url，其它字符一律不认（挡掉注入与误粘贴）
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(secret)) return null;
  return { id, secret };
}

/* -------------------------------------------------------------------------- */
/*                        同一 IP 重复使用 → 立即作废                         */
/* -------------------------------------------------------------------------- */

/**
 * IP 不落明文：只存 hash 的前 16 位十六进制。
 * 令牌本身是给「另一个人」用的，日志里留 IP 明文属于不必要的隐私暴露。
 */
function ipTag(ip: string): string {
  return createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 16);
}

const ipUseKey = (id: string, ip: string) => `qrlogin:ip:${id}:${ipTag(ip)}`;

/**
 * 记一次「这个 IP 用过这个令牌」。
 *
 * @returns 该 IP 在窗口期内对这个令牌的累计提交次数（第一次返回 1）
 *
 * ⚠️ 按**提交**计次而不是按「兑换成功」计次：
 * 兑换成功那一次令牌就被删了，之后再提交必然匹配不上，
 * 只有按提交计次才能抓到「同一个网络第二次拿它来登录」这个行为。
 */
export async function noteQrIpUse(id: string, ip: string): Promise<number> {
  const redis = getRedis();
  const k = ipUseKey(id, ip);
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, QR_IP_WINDOW_SECONDS);
  return n;
}
