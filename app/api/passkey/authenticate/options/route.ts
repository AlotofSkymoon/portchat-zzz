import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { readPasskeys } from "@/lib/passkey";
import { randomB64url, rpConfig, saveChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Passkey 认证第一步：下发挑战值。
 *
 * 两种用途：
 *   - `mode=login`  ：未登录 → 不给 allowCredentials，让认证器弹出自己的钥匙列表
 *   - `mode=reauth` ：已登录 → 限定只能用**本人**的凭据（用于关云端保存这类敏感操作）
 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    const mode = body.mode === "reauth" ? "reauth" : "login";

    const user = await getCurrentUser();
    if (mode === "reauth" && !user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { rpId } = rpConfig(request);
    const challenge = randomB64url(32);

    const chalId = await saveChallenge({
      challenge,
      action: "authenticate",
      userId: mode === "reauth" && user ? user.id : undefined,
    });

    return NextResponse.json({
      chalId,
      rpId,
      challenge,
      allowCredentials:
        mode === "reauth" && user
          ? readPasskeys(user).map((c) => ({
              id: c.credId,
              type: "public-key",
              transports: c.transports ?? ["internal"],
            }))
          : [],
      userVerification: "preferred",
      timeout: 60_000,
    });
  } catch (error) {
    console.error("[passkey/authenticate/options] 生成挑战失败");
    return NextResponse.json({ error: "无法开始 Passkey 验证" }, { status: 500 });
  }
}
