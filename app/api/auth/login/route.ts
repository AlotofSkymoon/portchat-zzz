import { NextResponse } from "next/server";

import {
  checkLoginRateLimit,
  createSession,
  getClientIp,
  isValidEmail,
  setSessionCookie,
  toSafeUser,
  verifyPassword,
  type UserRecord,
} from "@/lib/auth";
import { isEmailConfigured } from "@/lib/email";
import { getRedis, getValue, hasRedisConfig,
  storageErrorMessage, hgetAll, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_ERROR = "err.loginFailed";

export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json(
        { error: storageErrorMessage() },
        { status: 500 },
      );
    }

    // 简单限流：同一 IP 1 分钟最多 10 次
    const ip = getClientIp(request.headers);
    const allowed = await checkLoginRateLimit(ip, 10, 60);
    if (!allowed) {
      return NextResponse.json({ error: st(request, "err.loginTooMany") }, { status: 429 });
    }

    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!isValidEmail(email) || !password) {
      // 不区分“邮箱不存在”和“密码错误”，统一模糊提示
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    const redis = getRedis();

    const userId = await getValue<string>(KEYS.userEmail(email));
    if (!userId) {
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    const user = await hgetAll<UserRecord>(KEYS.user(userId));
    if (!user?.passwordHash) {
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    /*
     * 密码对了，但邮箱还没验证 —— 不放行。
     *
     * 只在**确实要求验证**时才拦：老账号没有 emailVerified 字段（undefined），
     * 按已验证处理；只有显式 false 才算未验证，否则一次更新会把老用户全锁在门外。
     */
    if (user.emailVerified === false && isEmailConfigured()) {
      return NextResponse.json(
        { error: st(request, "err.emailNotVerified"), needVerification: true, email },
        { status: 403 },
      );
    }

    const { sessionId, maxAge } = await createSession(user.id);
    await setSessionCookie(sessionId, maxAge);

    return NextResponse.json({ user: toSafeUser(user) });
  } catch (error) {
    console.error("[login] 登录失败");
    return NextResponse.json({ error: st(request, "err.loginGeneric") }, { status: 500 });
  }
}
