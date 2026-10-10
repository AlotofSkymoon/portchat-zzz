import "server-only";

import crypto from "crypto";
import { cookies } from "next/headers";

import {
  getRedis,
  getValue,
  hasRedisConfig,
  hgetAll,
  KEYS,
  SESSION_TTL_SECONDS,
  setMembers,
} from "./redis";

/* -------------------------------------------------------------------------- */
/*                                   类型                                      */
/* -------------------------------------------------------------------------- */

export type Role = "admin" | "user";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  /**
   * 邮箱是否已验证。
   *
   * ⚠️ 老数据没有这个字段（undefined）—— 一律按「已验证」处理，
   * 否则一次改动会把所有老账号锁在门外。
   * 只有 `=== false` 才算未验证。
   */
  emailVerified?: boolean;
  /**
   * 两步验证（TOTP）。
   *
   * ⚠️ 存储形态说明：用户记录在 Redis 里是 **hash**，嵌套对象存不进去，
   * 所以这个字段实际存的是 JSON 字符串。读的时候统一走 `readTwoFactor()`，
   * 不要直接 `user.twoFactor.secret` —— 那样拿到的是字符串。
   *
   * 没有这个字段 / enabledAt 为空都视为未开启，老账号不受影响。
   */
  twoFactor?: {
    /** base32 密钥 */
    secret: string;
    enabledAt: string;
    /** 备份码的 sha256（不存明文，数据库泄露也不能直接用） */
    backupCodes: string[];
  };
  /**
   * 第三方登录绑定。同一邮箱允许同时存在密码登录和 GitHub 登录：
   * 先注册了邮箱账号、后来用 GitHub 登录，应该进的是同一个账号。
   */
  oauth?: {
    github?: {
      /** GitHub 用户 id（数字，永久不变；login 昵称可以改，不能做主键） */
      id: string;
      login: string;
    };
  };
  /**
   * 自定义昵称。用户不想把邮箱露在界面上时用它。
   * 没设置时前端回落显示邮箱，所以老账号不需要回填。
   */
  nickname?: string;
  /**
   * Passkey（WebAuthn）凭据。
   *
   * ⚠️ 存储形态同 twoFactor：用户记录在 Redis 里是 **hash**，
   * 嵌套对象存不进去，所以这个字段实际存的是 JSON 字符串。
   * 读写统一走 `lib/passkey.ts` 的 readPasskeys / writePasskeys，
   * 不要直接 `user.passkeys[0]` —— 那样拿到的是字符串。
   */
  passkeys?: string;
}

/** 可以安全返回给前端的用户信息（永远不含 passwordHash） */
export type SafeUser = Omit<UserRecord, "passwordHash">;

export const SESSION_COOKIE_NAME = "agnes_session";

/* -------------------------------------------------------------------------- */
/*                                   工具                                      */
/* -------------------------------------------------------------------------- */

export function toSafeUser(user: UserRecord): SafeUser {
  const { passwordHash: _ignored, ...safe } = user;
  return safe;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/* -------------------------------------------------------------------------- */
/*                        嵌套字段的读写（JSON 字段）                          */
/* -------------------------------------------------------------------------- */

/*
 * 用户在 Redis 里是 hash，而 twoFactor / oauth 是嵌套对象。
 * 存的时候序列化成 JSON 字符串，读的时候 JSON.parse。
 *
 * 两个函数都同时接受「已经是对象」和「JSON 字符串」两种形态：
 * 老数据、或将来换成 JSON 存储都不会崩。
 */

export interface TwoFactorState {
  secret: string;
  enabledAt: string;
  backupCodes: string[];
}

export interface OAuthBindings {
  github?: { id: string; login: string };
}

export function readTwoFactor(user: UserRecord | null | undefined): TwoFactorState | null {
  const raw: unknown = user?.twoFactor;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as TwoFactorState;
    } catch {
      return null;
    }
  }
  return raw as TwoFactorState;
}

export function readOAuth(user: UserRecord | null | undefined): OAuthBindings | null {
  const raw: unknown = user?.oauth;
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as OAuthBindings;
    } catch {
      return null;
    }
  }
  return raw as OAuthBindings;
}

// 密码哈希实现在 ./password（按平台自动选 bcrypt / PBKDF2）
export { hashPassword, verifyPassword, passwordAlgo } from "./password";

/** 32 字节随机 sessionId（URL 安全） */
export function createSessionId(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function createUserId(): string {
  return crypto.randomUUID();
}

/* -------------------------------------------------------------------------- */
/*                              Session 读写                                   */
/* -------------------------------------------------------------------------- */

export async function createSession(userId: string): Promise<{ sessionId: string; maxAge: number }> {
  const redis = getRedis();
  const sessionId = createSessionId();

  await redis
    .pipeline()
    .set(KEYS.session(sessionId), userId, { ex: SESSION_TTL_SECONDS })
    .sadd(KEYS.userSessions(userId), sessionId)
    .exec();

  return { sessionId, maxAge: SESSION_TTL_SECONDS };
}

export async function destroySession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const redis = getRedis();
  const userId = await getValue<string>(KEYS.session(sessionId));
  const pipeline = redis.pipeline().del(KEYS.session(sessionId));
  if (userId) pipeline.srem(KEYS.userSessions(userId), sessionId);
  await pipeline.exec();
}

export async function destroyAllSessionsOf(userId: string): Promise<void> {
  const redis = getRedis();
  const sessionIds = await setMembers(KEYS.userSessions(userId));
  if (sessionIds.length === 0) return;
  const pipeline = redis.pipeline();
  for (const sid of sessionIds) pipeline.del(KEYS.session(sid));
  pipeline.del(KEYS.userSessions(userId));
  await pipeline.exec();
}

/**
 * 写入 session cookie（httpOnly + secure + sameSite=lax）
 *
 * ⚠️ Next.js 15 起 `cookies()` 返回 Promise，必须 await。
 * 这三个 cookie 辅助函数因此全部变成异步，调用方也要改成 await。
 */
export async function setSessionCookie(sessionId: string, maxAge: number): Promise<void> {
  (await cookies()).set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE_NAME);
}

export async function readSessionIdFromCookie(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
}

/* -------------------------------------------------------------------------- */
/*                              当前用户 / 权限                                 */
/* -------------------------------------------------------------------------- */

export async function getUserBySessionId(sessionId: string | null): Promise<UserRecord | null> {
  if (!sessionId || !hasRedisConfig()) return null;
  try {
    const redis = getRedis();
    const userId = await getValue<string>(KEYS.session(sessionId));
    if (!userId) return null;
    const user = await hgetAll<UserRecord>(KEYS.user(userId));
    if (!user || !user.id) return null;
    return user;
  } catch {
    return null;
  }
}

/** 服务端读取当前登录用户（未登录返回 null） */
export async function getCurrentUser(): Promise<UserRecord | null> {
  return getUserBySessionId(await readSessionIdFromCookie());
}

/** 服务端读取当前登录用户的安全信息 */
export async function getCurrentSafeUser(): Promise<SafeUser | null> {
  const user = await getCurrentUser();
  return user ? toSafeUser(user) : null;
}

/** 管理员权限校验：返回 SafeUser，非管理员抛错。所有管理接口必须先过这里。 */
export async function requireAdmin(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) {
    const err = new Error("UNAUTHORIZED") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  if (user.role !== "admin") {
    const err = new Error("FORBIDDEN") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  return toSafeUser(user);
}

/* -------------------------------------------------------------------------- */
/*                                  限流                                       */
/* -------------------------------------------------------------------------- */

/** 1 分钟最多 10 次；返回 false 表示已被限流 */
export async function checkLoginRateLimit(ip: string, limit = 10, windowSeconds = 60): Promise<boolean> {
  if (!hasRedisConfig()) return true;
  try {
    const redis = getRedis();
    const key = KEYS.loginRateLimit(ip || "unknown");
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count <= limit;
  } catch {
    return true;
  }
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/* -------------------------------------------------------------------------- */
/*                                 写用户字段                                   */
/* -------------------------------------------------------------------------- */

/**
 * 改用户字段（nickname / email / emailVerified …）。
 *
 * ⚠️ 只允许传 string 值：用户在 Redis 里是 hash，嵌套对象存进去会变成
 * "[object Object]"，所以嵌套字段（twoFactor / oauth）必须各自序列化，
 * 不要从这里写。
 *
 * @returns 改完的完整记录；用户不存在时返回 null
 */
export async function updateUser(
  id: string,
  patch: Partial<
    Record<
      "email" | "emailVerified" | "nickname" | "role" | "passkeys" | "twoFactor",
      string
    >
  >,
): Promise<UserRecord | null> {
  const redis = getRedis();
  const key = KEYS.user(id);

  // Redis hash 不接受 undefined；空 patch 直接返回当前记录
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "string") clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return hgetAll<UserRecord>(key);

  await redis.hset(key, clean);
  return hgetAll<UserRecord>(key);
}
