import { createHash, randomInt, timingSafeEqual } from "crypto";

import { KEYS, getRedis, getValue } from "@/lib/redis";

/**
 * 邮箱验证码。
 *
 * ⚠️ 两个安全要点：
 * 1. **只存 hash，不存明文**。Redis 万一被读走也拿不到可用验证码。
 * 2. **用 timingSafeEqual 比较**，避免逐字符比较泄漏前缀匹配长度。
 *
 * ⚠️ 为什么有「尝试次数」上限：
 * 6 位数字只有 100 万种，不限制次数就能被暴力枚举。
 */

/** 验证码有效期：30 分钟 */
export const VERIFY_TTL_SECONDS = 30 * 60;
/** 最多可尝试多少次 */
const MAX_ATTEMPTS = 5;
/** 重发间隔（秒）：防止被用来轰炸别人邮箱 */
const RESEND_COOLDOWN_SECONDS = 60;

interface VerifyRecord {
  codeHash: string;
  userId: string;
  attempts: number;
}

function hashCode(code: string, email: string): string {
  // 把 email 混进哈希当盐，避免两个用户的相同验证码产生相同哈希
  return createHash("sha256").update(`${email.toLowerCase()}|${code}`).digest("hex");
}

/** 6 位数字，前导零保留（randomInt 不含上界，用 1000000 取到 6 位） */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function saveCode(email: string, userId: string): Promise<string> {
  const code = generateCode();
  const record: VerifyRecord = {
    codeHash: hashCode(code, email),
    userId,
    attempts: 0,
  };
  const redis = getRedis();
  await redis.set(KEYS.emailVerify(email), JSON.stringify(record), { ex: VERIFY_TTL_SECONDS });
  return code;
}

/*
 * ⚠️ 这里刻意不用可辨识联合（discriminated union）。
 * 本项目 tsconfig 关闭了 strictNullChecks，而布尔字面量判别式的收窄
 * 依赖它 —— 关掉之后 `if (!r.ok)` 不会把类型收窄到失败分支，
 * 访问 r.reason 直接报 TS2339（Vercel 构建会因为这个失败）。
 * 改成单对象 + 可选字段，行为不变，但不会再踩这个坑。
 */
export type VerifyResult = {
  ok: boolean;
  /** 仅成功时有值 */
  userId?: string;
  /** 仅失败时有值 */
  reason?: "expired" | "wrong" | "too_many";
};

export async function checkCode(email: string, code: string): Promise<VerifyResult> {
  const raw = await getValue<string>(KEYS.emailVerify(email));
  if (!raw) return { ok: false, reason: "expired" };

  let record: VerifyRecord;
  try {
    record = JSON.parse(raw) as VerifyRecord;
  } catch {
    return { ok: false, reason: "expired" };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many" };
  }

  const given = Buffer.from(hashCode(code.trim(), email), "hex");
  const stored = Buffer.from(record.codeHash, "hex");
  const match =
    given.length === stored.length && timingSafeEqual(given, stored);

  if (!match) {
    /*
     * 失败要累加次数，否则 6 位数字能被暴力枚举。
     *
     * ⚠️ 这里整体写回并重新带上 ex，副作用是每次失败都会把有效期续满。
     * 看起来像漏洞，其实不然：attempts 达到上限后就再也无法续期，
     * 记录会在最后一次续期后的 30 分钟自然过期。
     * 想只改 attempts 而不动 TTL，需要 Store 接口提供 ttl() 才能算出剩余时间，
     * 现在的封装读不到，所以维持这个写法。
     */
    const redis = getRedis();
    const key = KEYS.emailVerify(email);
    await redis.set(key, JSON.stringify({ ...record, attempts: record.attempts + 1 }), {
      ex: VERIFY_TTL_SECONDS,
    });
    return { ok: false, reason: "wrong" };
  }

  return { ok: true, userId: record.userId };
}

export async function consumeCode(email: string): Promise<void> {
  const redis = getRedis();
  await redis.del(KEYS.emailVerify(email));
}

/** 是否还在重发冷却中 */
export async function inResendCooldown(email: string, ip: string): Promise<boolean> {
  const redis = getRedis();
  const [byEmail, byIp] = await Promise.all([
    getValue<string>(KEYS.ratelimitVerifyEmail(email)),
    getValue<string>(KEYS.ratelimitVerifyIp(ip)),
  ]);
  return Boolean(byEmail || byIp);
}

export async function markResent(email: string, ip: string): Promise<void> {
  const redis = getRedis();
  const pipeline = redis.pipeline();
  pipeline.set(KEYS.ratelimitVerifyEmail(email), "1", { ex: RESEND_COOLDOWN_SECONDS });
  pipeline.set(KEYS.ratelimitVerifyIp(ip), "1", { ex: RESEND_COOLDOWN_SECONDS });
  await pipeline.exec();
}

export const RESEND_COOLDOWN = RESEND_COOLDOWN_SECONDS;
