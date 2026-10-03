import { NextResponse } from "next/server";

import { getClientIp, isValidEmail } from "@/lib/auth";
import { isEmailConfigured, sendVerificationCode } from "@/lib/email";
import {
  RESEND_COOLDOWN,
  inResendCooldown,
  markResent,
  saveCode,
} from "@/lib/email-verify";
import { getValue, hasRedisConfig, hgetAll, storageErrorMessage, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";
import type { UserRecord } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 注册前发送验证码。
 *
 * ⚠️ 为什么必须在注册**之前**发：
 * 以前只有「提交注册 → 服务端顺带发码 → 跳到 /verify 页」这一条路，
 * 用户看到的注册表单上根本没有「发送验证码」的入口 ——
 * 于是出现"我配了 Resend，但注册页面什么验证码都没有"的观感。
 * 现在表单上就有按钮，点了立刻发。
 *
 * ⚠️ 发码时不创建账号：
 * 万一用户填完邮箱就走了，不该留下一个永远未验证的僵尸账号。
 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    if (!isEmailConfigured()) {
      // 没配邮件服务就谈不上发码，前端据此隐藏验证码区域
      return NextResponse.json({ error: st(request, "err.mailNotConfigured"), enabled: false }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { email?: string };
    const email = (body.email ?? "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: st(request, "err.invalidEmail") }, { status: 400 });
    }

    const ip = getClientIp(request.headers);
    if (await inResendCooldown(email, ip)) {
      return NextResponse.json(
        { error: st(request, "err.resendCooldown", { n: RESEND_COOLDOWN }) },
        { status: 429 },
      );
    }

    /*
     * 已注册且已验证 → 不该再发注册码，直接让他去登录。
     * 已注册但未验证 → 照发，让他补完验证（否则那个账号永远作废）。
     */
    const existingId = await getValue<string>(KEYS.userEmail(email));
    if (existingId) {
      const user = await hgetAll<UserRecord>(KEYS.user(existingId));
      if (user && user.emailVerified !== false) {
        return NextResponse.json(
          { error: st(request, "err.emailRegisteredLogin") },
          { status: 409 },
        );
      }
    }

    // userId 传空：此时账号还没建，验证码只跟邮箱绑定
    const code = await saveCode(email, "");
    const sent = await sendVerificationCode(email, code);

    if (!sent.ok) {
      /*
       * 这里**不放行**。发不出去就直接告诉用户 ——
       * 注册接口里那种「发信失败也放行」的兜底是给已建号的情况擦屁股的，
       * 这一步还没建号，静默放行等于把验证环节整个跳过。
       */
      console.error("[send-code] 发信失败", sent.status, sent.hint ?? sent.error);
      return NextResponse.json(
        { error: sent.hint ? `${sent.error}：${sent.hint}` : st(request, "err.mailSendFailed") },
        { status: 502 },
      );
    }

    await markResent(email, ip);
    return NextResponse.json({ ok: true, email });
  } catch (error) {
    console.error("[send-code] 发送失败", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: st(request, "err.mailSendFailed") }, { status: 500 });
  }
}
