import { NextResponse } from "next/server";

import { getCurrentUser, toSafeUser, updateUser } from "@/lib/auth";
import { RECOMMENDED_EMAIL_DOMAIN, checkEmailAllowed, isPastEmailDeadline } from "@/lib/email-policy";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 昵称上限：够放下"阿强"也够放"SuperLongNickname"，但不至于撑爆顶栏 */
const NICKNAME_MAX = 24;

/** 当前账号的邮箱状态 + 昵称，设置页的邮箱/昵称卡片直接用这一份 */
export async function GET(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: st(request, "err.loginRequired"), code: "LOGIN_REQUIRED" }, { status: 401 });
    }

    const policy = checkEmailAllowed(user.email);
    return NextResponse.json({
      user: toSafeUser(user),
      email: {
        address: user.email,
        mustChange: !policy.ok,
        pastDeadline: !policy.ok && isPastEmailDeadline(),
        reason: policy.reason ?? null,
        recommendedDomain: RECOMMENDED_EMAIL_DOMAIN,
      },
    });
  } catch (error) {
    console.error("[profile] 读取失败");
    return NextResponse.json({ error: st(request, "err.loginGeneric") }, { status: 500 });
  }
}

/** 改昵称。传空字符串表示清除（回落显示邮箱） */
export async function PATCH(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: st(request, "err.loginRequired"), code: "LOGIN_REQUIRED" }, { status: 401 });
    }

    const body = (await request.json()) as { nickname?: unknown };
    if (typeof body.nickname !== "string") {
      return NextResponse.json({ error: st(request, "err.invalidJson") }, { status: 400 });
    }

    // 折行/连续空格压成单空格，否则"阿 强"和"阿    强"会是两个名字
    const nickname = body.nickname.replace(/\s+/g, " ").trim().slice(0, NICKNAME_MAX);

    const updated = await updateUser(user.id, { nickname });
    if (!updated) {
      return NextResponse.json({ error: st(request, "err.loginGeneric") }, { status: 500 });
    }

    return NextResponse.json({ user: toSafeUser(updated) });
  } catch (error) {
    console.error("[profile] 更新失败");
    return NextResponse.json({ error: st(request, "err.loginGeneric") }, { status: 500 });
  }
}
