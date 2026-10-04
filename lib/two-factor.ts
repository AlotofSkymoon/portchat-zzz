import { cookies } from "next/headers";

import { signJwt, verifyJwt } from "@/lib/jwt";

/**
 * 两步验证的「信任此设备」。
 *
 * 需求：登录一次通过 2FA 后，同一台设备一个月内不用再输验证码。
 *
 * 为什么不能用 Redis 存：
 * 未登录状态下没有 userId 之外的稳定标识，而且要额外维护过期清理。
 * 用签名 cookie（JWT）更简单 —— 到期自动失效，改不了内容。
 *
 * 为什么不放进 session：
 * session 有效期是 7 天，而这里要 30 天。两者生命周期不同，
 * 硬塞进 session 会导致「session 过期但信任还在」，逻辑说不通。
 */

export const TRUST_COOKIE = "pc_2fa_trust";
/** 30 天 */
export const TRUST_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function issueTrustCookie(userId: string): Promise<void> {
  try {
    const token = await signJwt({ scope: "2fa-trust", sub: userId }, TRUST_TTL_SECONDS);
    const store = await cookies();
    store.set(TRUST_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: TRUST_TTL_SECONDS,
    });
  } catch {
    /* JWT_SECRET 没配时静默降级：用户每次登录都要输验证码，不会进不去 */
  }
}

export async function isTrustedDevice(userId: string): Promise<boolean> {
  try {
    const store = await cookies();
    const token = store.get(TRUST_COOKIE)?.value;
    if (!token) return false;
    const payload = await verifyJwt(token, "2fa-trust");
    return payload.sub === userId;
  } catch {
    return false;
  }
}

export async function clearTrustCookie(): Promise<void> {
  try {
    const store = await cookies();
    store.set(TRUST_COOKIE, "", { path: "/", maxAge: 0 });
  } catch {
    /* 忽略 */
  }
}
