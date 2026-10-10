import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { loadPasskeys } from "@/lib/passkey";
import { randomB64url, rpConfig, saveChallenge } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Passkey 注册第一步：下发创建参数。
 *
 * ⚠️ residentKey 必须是 required：
 * 只有可发现凭据（discoverable credential）才能在登录时**不给用户 id**
 * 直接让认证器自己选账号 —— 这正是 Passkey 免输入邮箱登录的前提。
 */
export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const { rpId, rpName } = rpConfig(request);
    const existing = await loadPasskeys(user);

    if (existing.length >= 10) {
      return NextResponse.json({ error: "最多只能绑定 10 个 Passkey" }, { status: 400 });
    }

    const challenge = randomB64url(32);
    const chalId = await saveChallenge({
      challenge,
      action: "register",
      userId: user.id,
    });

    return NextResponse.json({
      chalId,
      rp: { id: rpId, name: rpName },
      user: { id: user.id, name: user.email, displayName: user.nickname || user.email },
      challenge,
      // 已绑过的凭据要排除掉，否则同一个钥匙圈能重复注册同一把钥匙
      excludeCredentials: existing.map((c) => ({
        id: c.credId,
        type: "public-key",
        transports: c.transports ?? ["internal"],
      })),
      authenticatorSelection: {
        // 只要平台认证器（Touch ID / Face ID / Windows Hello / iCloud 钥匙圈）
        authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
      attestation: "none",
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 60_000,
    });
  } catch (error) {
    console.error("[passkey/register/options] 生成参数失败");
    return NextResponse.json({ error: "无法开始 Passkey 绑定" }, { status: 500 });
  }
}
