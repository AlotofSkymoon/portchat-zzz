import { NextResponse } from "next/server";

import {
  createSession,
  destroySession,
  hashPassword,
  readSessionIdFromCookie,
  setSessionCookie,
  verifyPassword,
  type UserRecord,
} from "@/lib/auth";
import { getRedis, getValue, hasRedisConfig,
  storageErrorMessage, hgetAll, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/password  body: { currentPassword, newPassword } */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const redis = getRedis();
    const sessionId = await readSessionIdFromCookie();
    if (!sessionId) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

    const userId = await getValue<string>(KEYS.session(sessionId));
    if (!userId) return NextResponse.json({ error: st(request, "err.sessionExpired") }, { status: 401 });

    const user = await hgetAll<UserRecord>(KEYS.user(userId));
    if (!user?.passwordHash) return NextResponse.json({ error: st(request, "err.userNotFound") }, { status: 404 });

    const { currentPassword, newPassword } = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: st(request, "err.fillPasswords") }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: st(request, "err.passwordMin8") }, { status: 400 });
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return NextResponse.json({ error: st(request, "err.wrongCurrentPassword") }, { status: 400 });

    const passwordHash = await hashPassword(newPassword);
    await redis.hset(KEYS.user(userId), { passwordHash });

    // 改密后踢掉旧 session，重新签发，提升安全性
    await destroySession(sessionId);
    const { sessionId: newSessionId, maxAge } = await createSession(userId);
    await setSessionCookie(newSessionId, maxAge);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: st(request, "err.changePasswordFailed") }, { status: 500 });
  }
}
