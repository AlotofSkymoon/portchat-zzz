import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { indexCred, loadPasskeys, nextLabel, syncIndexes, writePasskeys } from "@/lib/passkey";
import { requireSyncable, rpConfig, takeChallenge, verifyRegistration } from "@/lib/webauthn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Passkey 注册第二步：校验 attestation 并落库。
 *
 * ⚠️「仅支持 iCloud 钥匙圈」这句要求的真相：
 * WebAuthn **没有**任何字段能直接读出「这个凭据来自 iCloud 钥匙圈」。
 * 能拿到的只有 BE/BS 两个标志位：
 *   BE(backup eligible) = 这把密钥允许被备份（可同步）
 *   BS(backup state)    = 它当前确实已被备份（已上云同步）
 * 「钥匙圈类」凭据（iCloud / Google 密码管理器 / 1Password）都会置 BE=1。
 * 所以这里用 BE 作为代理判据：BE=0 说明是**只存在本机、不同步**的密钥 ——
 * 丢了设备就找不回来，正是需求里要排除的那种。
 * 因此严格模式下 BE=0 会被拒绝，并给出明确提示，而不是默默放行。
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

    const body = (await request.json().catch(() => ({}))) as {
      chalId?: string;
      label?: string;
      credential?: {
        id?: string;
        rawId?: string;
        response?: {
          clientDataJSON?: string;
          attestationObject?: string;
          transports?: string[];
        };
      };
    };

    const chalId = body.chalId ?? "";
    const cred = body.credential;
    if (!chalId || !cred?.rawId || !cred.response?.clientDataJSON || !cred.response?.attestationObject) {
      return NextResponse.json({ error: "参数不完整" }, { status: 400 });
    }

    const chal = await takeChallenge(chalId);
    if (!chal || chal.action !== "register" || chal.userId !== user.id) {
      return NextResponse.json({ error: "验证已过期，请重试" }, { status: 400 });
    }

    const { rpId, origin } = rpConfig(request);

    let parsed;
    try {
      parsed = await verifyRegistration({
        id: cred.id ?? cred.rawId,
        rawId: cred.rawId,
        response: {
          clientDataJSON: cred.response.clientDataJSON,
          attestationObject: cred.response.attestationObject,
          transports: cred.response.transports,
        },
        expected: { challenge: chal.challenge, rpId, origin },
      });
    } catch {
      return NextResponse.json({ error: "Passkey 校验失败，请重试" }, { status: 400 });
    }

    // 严格模式：必须是可同步（钥匙圈类）凭据
    if (requireSyncable() && !parsed.backupEligible) {
      return NextResponse.json(
        {
          error:
            "这把密钥不会同步到钥匙圈（iCloud 钥匙圈等），设备丢失后无法恢复，已拒绝绑定。请改用 iCloud 钥匙圈 / 密码管理器生成的 Passkey。",
        },
        { status: 400 },
      );
    }

    const list = await loadPasskeys(user);
    if (list.some((c) => c.credId === parsed.credId)) {
      return NextResponse.json({ error: "这个 Passkey 已经绑定过了" }, { status: 400 });
    }

    list.push({
      id: parsed.credId,
      credId: parsed.credId,
      // 浏览器回传的写法也存下来：登录时它带回来的就是这个字符串
      rawId: cred.id ?? cred.rawId,
      userId: user.id,
      spki: parsed.spki,
      alg: parsed.alg,
      signCount: parsed.signCount,
      label: (body.label ?? "").trim() || nextLabel(list),
      createdAt: Date.now(),
      lastUsedAt: 0,
      backupEligible: parsed.backupEligible,
      backupState: parsed.backupState,
      transports: parsed.transports,
    });

    // before 传加入前的长度对应的旧列表：此处 list 已含新凭据，
    // syncIndexes 只关心「after 里没有的索引要清掉」，前后传同一份即可
    await syncIndexes(user.id, list, list);
    await writePasskeys(user.id, list);
    // 浏览器返回的写法也登记一份 —— 登录时它带回来的就是这个字符串
    if (cred.id && cred.id !== parsed.credId) await indexCred(cred.id, user.id);

    return NextResponse.json({
      ok: true,
      passkeys: list.map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        synced: c.backupEligible,
      })),
    });
  } catch (error) {
    console.error("[passkey/register/verify] 绑定失败");
    return NextResponse.json({ error: "Passkey 绑定失败" }, { status: 500 });
  }
}
