import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { newQrId, newSecret, saveQrToken } from "@/lib/qr-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 已登录设备生成二维码登录令牌。
 *
 * ⚠️ 二维码内容里带明文 secret —— 这是**必须的**，
 * 扫码的那台设备必须能读到它才能兑换会话。
 * 服务端存的只是 hash，所以泄露的只有二维码本身（本来就是给人扫的）。
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
    const payload = `${origin}/qr?id=${encodeURIComponent(id)}&s=${encodeURIComponent(secret)}`;

    return NextResponse.json({ id, secret, payload, expiresIn: 300 });
  } catch {
    return NextResponse.json({ error: "生成二维码失败" }, { status: 500 });
  }
}
