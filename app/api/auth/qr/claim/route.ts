import { NextResponse } from "next/server";

import {
  checkLoginRateLimit,
  createSession,
  getClientIp,
  setSessionCookie,
  toSafeUser,
} from "@/lib/auth";
import { hasRedisConfig, hgetAll, KEYS, storageErrorMessage } from "@/lib/redis";
import { burnQrToken, verifyQrSecret } from "@/lib/qr-login";
import type { UserRecord } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 扫码设备用 id + secret 兑换登录会话。
 *
 * ⚠️「完成登入后移除 token」就在这里落地：
 * 校验通过、会话建好之后**立刻** burnQrToken，令牌一次有效。
 * 所以二维码截图被人拿到也没用 —— 要么已被兑换，要么 5 分钟过期。
 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const ip = getClientIp(request.headers);
    if (!(await checkLoginRateLimit(ip, 10, 60))) {
      return NextResponse.json({ error: "尝试太频繁，请稍后再试" }, { status: 429 });
    }

    const body = (await request.json().catch(() => ({}))) as { id?: string; s?: string };
    const id = (body.id ?? "").trim();
    const secret = (body.s ?? "").trim();
    if (!id || !secret) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const userId = await verifyQrSecret(id, secret);
    if (!userId) {
      return NextResponse.json({ error: "二维码无效或已过期" }, { status: 401 });
    }

    const user = await hgetAll<UserRecord>(KEYS.user(userId));
    if (!user?.id) {
      await burnQrToken(id);
      return NextResponse.json({ error: "账号不存在" }, { status: 401 });
    }

    const s = await createSession(user.id);
    await setSessionCookie(s.sessionId, s.maxAge);
    // 兑换完成即销毁，确保一次性
    await burnQrToken(id);

    return NextResponse.json({ ok: true, user: toSafeUser(user) });
  } catch {
    return NextResponse.json({ error: "登录失败" }, { status: 500 });
  }
}
