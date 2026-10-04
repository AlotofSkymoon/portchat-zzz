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
