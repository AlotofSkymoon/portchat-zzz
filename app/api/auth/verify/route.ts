import { NextResponse } from "next/server";

import {
  createSession,
  getClientIp,
  isValidEmail,
  setSessionCookie,
  toSafeUser,
  type UserRecord,
} from "@/lib/auth";
import { isEmailConfigured, sendVerificationCode } from "@/lib/email";
import {
  RESEND_COOLDOWN,
  checkCode,
  consumeCode,
  inResendCooldown,
  markResent,
  saveCode,
} from "@/lib/email-verify";
import { getRedis, getValue, hasRedisConfig,
  storageErrorMessage, hgetAll, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** action=verify：核对验证码并登录；action=resend：重发一封 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const body = (await request.json()) as {
      email?: string;
      code?: string;
      action?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const action = body.action === "resend" ? "resend" : "verify";

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: st(request, "err.invalidEmail") }, { status: 400 });
    }

    const redis = getRedis();
    const userId = await getValue<string>(KEYS.userEmail(email));
    if (!userId) {
      // 不透露该邮箱是否存在，统一说找不到待验证记录
      return NextResponse.json({ error: st(request, "err.noPendingEmail") }, { status: 404 });
    }

    const user = await hgetAll<UserRecord>(KEYS.user(userId));
    if (!user) {
      return NextResponse.json({ error: st(request, "err.noPendingEmail") }, { status: 404 });
    }

    /* ------------------------------ 重发 ------------------------------ */

    if (action === "resend") {
      // 已验证过就没必要再发
      if (user.emailVerified !== false) {
        return NextResponse.json({ error: st(request, "err.alreadyVerified") }, { status: 400 });
      }

      const ip = getClientIp(request.headers);
      if (await inResendCooldown(email, ip)) {
        return NextResponse.json(
          { error: st(request, "err.resendCooldown", { n: RESEND_COOLDOWN }) },
          { status: 429 },
        );
      }

      const code = await saveCode(email, userId);
      const sent = await sendVerificationCode(email, code);
      if (!sent.ok) {
        return NextResponse.json({ error: st(request, "err.mailSendFailed") }, { status: 502 });
      }
      await markResent(email, ip);

      return NextResponse.json({ ok: true });
    }

    /* ------------------------------ 验证 ------------------------------ */

    const code = (body.code ?? "").trim();
    if (code.length !== 6) {
      return NextResponse.json({ error: st(request, "err.enter6") }, { status: 400 });
    }

    const result = await checkCode(email, code);
    if (!result.ok) {
      const msg =
        result.reason === "expired"
          ? st(request, "err.codeExpired")
          : result.reason === "too_many"
            ? st(request, "err.tooManyAttempts")
            : st(request, "err.codeIncorrect");
      return NextResponse.json({ error: msg, reason: result.reason }, { status: 400 });
    }

    await redis.hset(KEYS.user(userId), { emailVerified: "true" });
    await consumeCode(email);

    const { sessionId, maxAge } = await createSession(userId);
    await setSessionCookie(sessionId, maxAge);

    return NextResponse.json({
      user: toSafeUser({ ...user, emailVerified: true }),
    });
  } catch (error) {
    console.error("[verify] 验证失败", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: st(request, "err.verifyFailed") }, { status: 500 });
  }
}

/** 前端用来判断当前是否开启了邮箱验证 */
export async function GET(request: Request) {
  return NextResponse.json({ enabled: isEmailConfigured() });
}
