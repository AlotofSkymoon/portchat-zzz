import { NextResponse } from "next/server";

import {
  checkLoginRateLimit,
  createSession,
  getClientIp,
  getCurrentUser,
  setSessionCookie,
  toSafeUser,
} from "@/lib/auth";
import { findUserByCredId, readPasskeys, writePasskeys } from "@/lib/passkey";
import { hasRedisConfig, hgetAll, KEYS, storageErrorMessage } from "@/lib/redis";
import { issueTrustCookie } from "@/lib/two-factor";
import { issueGrant } from "@/lib/reauth";
import { b64urlDecode, rpConfig, takeChallenge, verifyAssertion } from "@/lib/webauthn";
import type { UserRecord } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * flags 里的 UV 位（bit 2）。
 *
 * ⚠️ 为什么关心它：userVerification 我们只设了 "preferred"，
 * 认证器可以不做生物识别就签名。只有 UV=1 才说明真的验了人 ——
 * 这时 Passkey 本身就相当于第二因子，可以免 2FA；
 * UV=0 则退回要求 TOTP，不能无条件放行。
 */
function userVerified(authDataB64: string): boolean {
  try {
    const authData = b64urlDecode(authDataB64);
    return authData.length > 32 && (authData[32] & 0x04) !== 0;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const ip = getClientIp(request.headers);
    if (!(await checkLoginRateLimit(ip, 10, 60))) {
      return NextResponse.json({ error: "尝试太频繁，请稍后再试" }, { status: 429 });
    }

    const current = await getCurrentUser();
    const body = (await request.json().catch(() => ({}))) as {
      chalId?: string;
      credential?: {
        id?: string;
        rawId?: string;
        response?: {
          clientDataJSON?: string;
          authenticatorData?: string;
          signature?: string;
          userHandle?: string | null;
        };
      };
    };

    const cred = body.credential;
    const chalId = body.chalId ?? "";
    if (
      !chalId ||
      !cred?.response?.clientDataJSON ||
      !cred?.response?.authenticatorData ||
      !cred?.response?.signature
    ) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const chal = await takeChallenge(chalId);
    if (!chal || chal.action !== "authenticate") {
      return NextResponse.json({ error: "验证已过期，请重试" }, { status: 400 });
    }

    const credId = cred.id ?? cred.rawId ?? "";
    if (!credId) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    /*
     * 确定要拿哪把钥匙来验签。
     * reauth 模式（已登录）：只能用自己的凭据，挑战值里记了 userId。
     * login 模式（未登录）：靠 credId 反查用户 —— 这就是为什么注册时要 residentKey=required。
     */
    let user: UserRecord | null = null;
    if (chal.userId) {
      if (!current || current.id !== chal.userId) {
        return NextResponse.json({ error: "登录状态已变化，请重试" }, { status: 401 });
      }
      user = current;
    } else {
      const uid = await findUserByCredId(credId);
      if (!uid) {
        return NextResponse.json({ error: "这个 Passkey 没有对应的账号" }, { status: 401 });
      }
      const found = await hgetAll<UserRecord>(KEYS.user(uid));
      if (found?.id) user = found;
    }

    if (!user) {
      return NextResponse.json({ error: "账号不存在" }, { status: 401 });
    }

    const list = readPasskeys(user);
    const credential = list.find((c) => c.credId === credId);
    if (!credential) {
      return NextResponse.json({ error: "这个 Passkey 没有对应的账号" }, { status: 401 });
    }

    const { rpId, origin } = rpConfig(request);

    try {
      const { signCount } = await verifyAssertion({
        rawId: credId,
        response: {
          clientDataJSON: cred.response.clientDataJSON,
          authenticatorData: cred.response.authenticatorData,
          signature: cred.response.signature,
          userHandle: cred.response.userHandle,
        },
        credential: {
          credId: credential.credId,
          spki: credential.spki,
          alg: credential.alg,
          signCount: credential.signCount,
        },
        expected: { challenge: chal.challenge, rpId, origin },
      });

      /*
       * signCount 只增不减。出现「比上次小」说明同一把钥匙被复制了
       * （克隆攻击的典型特征）。这里记下新值但不直接拒绝 ——
       * 部分平台认证器恒为 0，一刀切会误伤。
       */
      const updated = list.map((c) =>
        c.credId === credId ? { ...c, signCount, lastUsedAt: Date.now() } : c,
      );
      await writePasskeys(user.id, updated);
    } catch {
      return NextResponse.json({ error: "Passkey 验证失败" }, { status: 401 });
    }

    // reauth：只证明「本人操作」，不建会话。
    // 顺手签发一张一次性凭证，关闭云端保存这类敏感操作带上它即可。
    if (chal.userId) {
      const token = await issueGrant(user.id);
      return NextResponse.json({
        ok: true,
        verified: true,
        token,
        userVerified: userVerified(cred.response.authenticatorData),
      });
    }

    const uv = userVerified(cred.response.authenticatorData);
    if (!uv) {
      // 认证器没做生物识别 —— 视为单因子，这里直接拒绝，避免绕过 2FA 的设计意图
      return NextResponse.json(
        { error: "这台设备没有完成生物识别验证，请改用密码登录" },
        { status: 401 },
      );
    }

    // Passkey 本身抗钓鱼且已验人，视为已通过第二因子，发一个月的设备信任
    await issueTrustCookie(user.id);
    const s = await createSession(user.id);
    await setSessionCookie(s.sessionId, s.maxAge);
    return NextResponse.json({ ok: true, user: toSafeUser(user) });
  } catch (error) {
    console.error("[passkey/authenticate/verify] 验证失败");
    return NextResponse.json({ error: "Passkey 验证失败" }, { status: 500 });
  }
}
