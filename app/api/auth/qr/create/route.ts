import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { encodeLoginToken, newQrId, newSecret, saveQrToken } from "@/lib/qr-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 已登录设备生成登录令牌（一串可复制的字符，替代原来的二维码）。
 *
 * ⚠️ 令牌明文里带 secret —— 这是**必须的**，
 * 另一台设备必须能读到它才能兑换会话。
 * 服务端存的只是 hash，所以泄露的只有令牌本身（本来就是要交给对方用的）。
 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const id = newQrId();
    const secret = newSecret();
    await saveQrToken(id, secret, user.id);

    const origin = new URL(request.url).origin;
    // 主要形态是这串令牌；URL 形态继续保留，兼容旧链接与「直接打开」的用法
    const token = encodeLoginToken(id, secret);
    const payload = `${origin}/qr?id=${encodeURIComponent(id)}&s=${encodeURIComponent(secret)}`;

    return NextResponse.json({ id, secret, token, payload, expiresIn: 300 });
  } catch {
    return NextResponse.json({ error: "生成二维码失败" }, { status: 500 });
  }
}
