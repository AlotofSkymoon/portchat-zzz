import { NextResponse } from "next/server";

import { requireAdmin, isValidEmail } from "@/lib/auth";
import {
  isEmailConfigured,
  mailConfigStatus,
  sendVerificationCode,
} from "@/lib/email";
import { generateCode } from "@/lib/email-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET：管理员查看邮箱验证是否真的启用。
 *
 * ⚠️ 为什么需要这个接口：
 * 「我明明配了 Resend，为什么注册不弹验证码」是最难自查的问题 ——
 * 可能是变量没注入、可能只在 Preview 环境配了没配 Production、
 * 也可能 Cloudflare 部署需要 wrangler secret 而不是环境变量。
 * 没有这个接口，站长只能看到「没弹验证码」，完全不知道卡在哪一环。
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }
  return NextResponse.json({ ...mailConfigStatus() });
}

/**
 * POST：给指定邮箱发一封真实验证码邮件，用来验证 Resend 到底通不通。
 *
 * ⚠️ 刻意发「真验证码」而不是随便一段文字：
 * 这样测出来的就是线上真实链路，格式、发件人、域名策略都一致。
 * 发出的码不写入 Redis，避免污染/覆盖用户正在用的验证码。
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  if (!isEmailConfigured()) {
    return NextResponse.json({
      ok: false,
      error: "未配置 Resend",
      ...mailConfigStatus(),
    }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { to?: string };
  const to = (body.to ?? "").trim();

  if (!isValidEmail(to)) {
    return NextResponse.json({ ok: false, error: "邮箱格式不正确" }, { status: 400 });
  }

  const result = await sendVerificationCode(to, generateCode());

  return NextResponse.json({
    ok: result.ok,
    error: result.error,
    status: result.status,
    detail: result.detail,
    hint: result.hint,
    from: mailConfigStatus().from,
  }, { status: result.ok ? 200 : 502 });
}
