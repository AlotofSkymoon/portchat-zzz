import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { getRedis, getValue } from "@/lib/redis";

/**
 * 二维码登录的临时令牌。
 *
 * 流程：
 *   1) 已登录设备请求 create → 服务端生成 id + secret
 *   2) 二维码里只放 `origin/qr?id=<id>&s=<secret>`
 *   3) 另一台设备扫码打开该地址 → 用 id+secret 换会话
 *   4) 换成功立刻删除令牌，且**只能换一次**
 *
 * ⚠️ 安全要点：
 * - 服务端只存 secret 的 **hash**，Redis 被读走也换不出会话
 * - secret 是 32 字节随机数，不可枚举；比较用 timingSafeEqual
 * - 令牌 5 分钟过期，过期自动消失
 * - 一旦被兑换立即删除（需求里的「完成登入后移除 token」）
 */

export const QR_TTL_SECONDS = 5 * 60;

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
