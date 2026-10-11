import { NextResponse } from "next/server";

import {
  checkLoginRateLimit,
  createSession,
  getClientIp,
  setSessionCookie,
  toSafeUser,
} from "@/lib/auth";
import { hasRedisConfig, hgetAll, KEYS, storageErrorMessage } from "@/lib/redis";
import { burnQrToken, noteQrIpUse, parseLoginToken, verifyQrSecret } from "@/lib/qr-login";
import type { UserRecord } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 用登录令牌（另一台已登录设备生成的）兑换登录会话。
 *
 * ⚠️「完成登入后移除 token」就在这里落地：
 * 校验通过、会话建好之后**立刻** burnQrToken，令牌一次有效。
 *
 * ⚠️「同一 IP 一天内用两次就作废」也在这里落地：
 * 每次提交都给「IP × 令牌」记一次数；第二次提交时**先作废再返回**，
 * 不管这一次本身能不能校验通过。这样把令牌转给别人用就没意义了 ——
 * 只要同一个网络（同一出口 IP）第二次拿它登录，令牌当场失效。
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

    const body = (await request.json().catch(() => ({}))) as {
      id?: string;
      s?: string;
      token?: string;
    };

    /*
     * 优先解析整串令牌（现在登录页就是这么传的）；
     * 老的 id + s 两个字段继续支持，/qr 落地页还在用。
     */
    const parsed = parseLoginToken(body.token ?? "") ??
      (body.id && body.s ? { id: body.id.trim(), secret: body.s.trim() } : null);
    if (!parsed) {
      return NextResponse.json({ error: "令牌格式不正确" }, { status: 400 });
    }
    const { id, secret } = parsed;

    // 先记次：同一 IP 24h 内第二次提交这个令牌 → 立即作废
    const uses = await noteQrIpUse(id, ip);
    if (uses >= 2) {
      await burnQrToken(id);
      return NextResponse.json(
        { error: "该令牌已作废：同一网络 24 小时内不能重复使用同一令牌" },
        { status: 401 },
      );
    }

    const userId = await verifyQrSecret(id, secret);
    if (!userId) {
      return NextResponse.json({ error: "令牌无效或已过期" }, { status: 401 });
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
