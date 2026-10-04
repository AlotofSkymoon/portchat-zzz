import { NextResponse } from "next/server";

import {
  getCurrentUser,
  getClientIp,
  isValidEmail,
  updateUser,
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
import {
  getValue,
  hasRedisConfig,
  storageErrorMessage,
  KEYS,
} from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";
import {
  checkEmailAllowed,
  isPastEmailDeadline,
} from "@/lib/email-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 换绑邮箱。
 *
 * 两步走：
 *   1) action=request  → 给**新邮箱**发验证码（此时还没改任何数据）
 *   2) action=confirm  → 校验验证码，真正改掉邮箱
 *
 * ⚠️ 为什么要单独一个接口，而不复用 /api/auth/send-code：
 * send-code 遇到「已注册且已验证」的邮箱会直接拒绝（那是给注册用的语义），
 * 但换绑的目标邮箱完全可能是别人的旧邮箱或用户自己的另一个邮箱，
 * 复用会误判。这里只要求：新邮箱没被**别人**占用。
 *
 * ⚠️ 换绑后必须保持登录态不变：
 * 改的是 user.email，不动 session。否则用户换完绑就被踢下线，体验很差。
 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json(
        { error: storageErrorMessage() },
        { status: 500 },
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      newEmail?: string;
      code?: string;
    };
    const action = body.action ?? "";
    const newEmail = (body.newEmail ?? "").trim().toLowerCase();

    if (action !== "request" && action !== "confirm") {
      return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });
    }

    if (!isValidEmail(newEmail)) {
      return NextResponse.json({ error: st(request, "err.invalidEmail") }, { status: 400 });
    }

    // 白名单校验：新邮箱必须合规
    const policy = checkEmailAllowed(newEmail);
    if (!policy.ok) {
      return NextResponse.json(
        {
          error:
            policy.reason === "microsoft"
              ? st(request, "err.emailMicrosoft")
              : policy.reason === "temporary"
                ? st(request, "err.emailTemporary")
                : st(request, "err.emailNotAllowed"),
        },
        { status: 400 },
      );
    }

    // 不能换成自己当前这个邮箱
    if (newEmail === user.email) {
      return NextResponse.json(
        { error: st(request, "err.emailSameAsCurrent") },
        { status: 400 },
      );
    }

    // 新邮箱不能已经被别人占用
    const ownerId = await getValue<string>(KEYS.userEmail(newEmail));
    if (ownerId && ownerId !== user.id) {
      return NextResponse.json({ error: st(request, "err.emailTaken") }, { status: 409 });
    }

    /* ---------------------------- 第一步：发码 ---------------------------- */

    if (action === "request") {
      if (!isEmailConfigured()) {
        return NextResponse.json(
          { error: st(request, "err.mailNotConfigured"), enabled: false },
          { status: 400 },
        );
      }

      const ip = getClientIp(request.headers);
      if (await inResendCooldown(newEmail, ip)) {
        return NextResponse.json(
          { error: st(request, "err.resendCooldown", { n: RESEND_COOLDOWN }) },
          { status: 429 },
        );
      }

      const code = await saveCode(newEmail, user.id);
      const sent = await sendVerificationCode(newEmail, code);
      if (!sent.ok) {
        console.error("[change-email] 发信失败", sent.status, sent.hint ?? sent.error);
        return NextResponse.json(
          {
            error: sent.hint
              ? `${sent.error}：${sent.hint}`
              : st(request, "err.mailSendFailed"),
          },
          { status: 502 },
        );
      }

      await markResent(newEmail, ip);
      return NextResponse.json({ ok: true, email: newEmail });
    }

    /* ---------------------------- 第二步：确认 ---------------------------- */

    const code = (body.code ?? "").trim();
    if (!code) {
      return NextResponse.json({ error: st(request, "err.codeRequired") }, { status: 400 });
    }

    const result = await checkCode(newEmail, code);
    if (!result.ok) {
      return NextResponse.json(
        { error: st(request, result.reason === "expired" ? "err.codeExpired" : "err.codeWrong") },
        { status: 400 },
      );
    }

    // 旧邮箱索引必须删掉，否则旧邮箱永远登不上（而且指向错误账号）
    const redis = (await import("@/lib/redis")).getRedis();
    const pipeline = redis.pipeline();
    pipeline.del(KEYS.userEmail(user.email));
    pipeline.set(KEYS.userEmail(newEmail), user.id);
    await pipeline.exec();

    await updateUser(user.id, { email: newEmail, emailVerified: "true" });
    await consumeCode(newEmail);

    return NextResponse.json({ ok: true, email: newEmail });
  } catch (error) {
    console.error(
      "[change-email] 失败",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: st(request, "err.serverError") }, { status: 500 });
  }
}

/**
 * 查询当前用户的换绑状态。
 * 前端据此决定是否要弹出「必须换绑」的提示。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  }
  const policy = checkEmailAllowed(user.email);
  return NextResponse.json({
    email: user.email,
    mustChange: !policy.ok,
    pastDeadline: !policy.ok && isPastEmailDeadline(),
    domain: policy.domain,
  });
}
