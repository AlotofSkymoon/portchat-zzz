import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isEmailConfigured, sendVerificationCode } from "@/lib/email";
import { checkCode, consumeCode, saveCode } from "@/lib/email-verify";
import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { verifyTotp } from "@/lib/totp";
import { readTwoFactor } from "@/lib/auth";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 二次认证（reauth）：关闭云端保存这类敏感操作前先过一道。
 *
 * 四种方式任选其一：密码 / 两步验证 / Passkey / 邮箱验证码。
 * 通过后发一张 **10 分钟有效的一次性凭证**，后续敏感操作带上它即可。
 *
 * ⚠️ 为什么是"发凭证"而不是"直接改状态"：
 * reauth 和真正要做的操作是两个请求，中间必须有个凭据把两者串起来，
 * 否则前端只要跳过 reauth 直接调目标接口就绕过了认证。
 *
 * ⚠️ 凭证用后即焚：一个凭证只能完成一次操作，防重放。
 */
import { issueGrant } from "@/lib/reauth";

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    method?: string;
    password?: string;
    code?: string;
    assertion?: unknown;
  };
  const method = body.method ?? "";

  /* ------------------------- 邮箱验证码：先发码 ------------------------- */
  if (method === "email" && !body.code) {
    if (!isEmailConfigured()) {
      return NextResponse.json(
        { error: st(request, "err.mailNotConfigured"), enabled: false },
        { status: 400 },
      );
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await saveCode(user.email, code);
    const sent = await sendVerificationCode(user.email, code);
    if (!sent) {
      return NextResponse.json({ error: st(request, "err.mailSendFailed") }, { status: 500 });
    }
    return NextResponse.json({ ok: true, sent: true, hint: user.email });
  }

  /* ------------------------------ 密码 ------------------------------ */
  if (method === "password") {
    const { verifyPassword } = await import("@/lib/auth");
    const ok = await verifyPassword(body.password ?? "", user.passwordHash ?? "");
    if (!ok) {
      return NextResponse.json({ error: st(request, "err.wrongPassword") }, { status: 400 });
    }
    return NextResponse.json({ ok: true, token: await issueGrant(user.id) });
  }

  /* --------------------------- 两步验证 --------------------------- */
  if (method === "totp") {
    const tf = await readTwoFactor(user);
    // TwoFactorState 里只有 enabledAt（启用时间戳），没有 enabled 布尔位
    if (!tf?.enabledAt || !tf.secret) {
      return NextResponse.json({ error: st(request, "err.twoFactorNotEnabled") }, { status: 400 });
    }
    const code = (body.code ?? "").trim();
    const matched = await verifyTotp(tf.secret, code);
    // 备份码也可以（一次性）
    const backupHit = !matched && (tf.backupCodes ?? []).some((c) => c === code);
    if (!matched && !backupHit) {
      return NextResponse.json({ error: st(request, "err.invalidCode") }, { status: 400 });
    }
    if (backupHit) {
      const { updateUser } = await import("@/lib/auth");
      await updateUser(user.id, {
        twoFactor: JSON.stringify({
          ...tf,
          backupCodes: tf.backupCodes.filter((c) => c !== code),
        }),
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, token: await issueGrant(user.id) });
  }

  /* --------------------------- 邮箱验证码 --------------------------- */
  if (method === "email") {
    const code = (body.code ?? "").trim();
    const ok = await checkCode(user.email, code);
    if (!ok) {
      return NextResponse.json({ error: st(request, "err.invalidCode") }, { status: 400 });
    }
    await consumeCode(user.email);
    return NextResponse.json({ ok: true, token: await issueGrant(user.id) });
  }

  /* ---------------------------- Passkey ---------------------------- */
  if (method === "passkey") {
    // Passkey 的断言校验在 /api/passkey/authenticate/verify（mode=reauth）里完成，
    // 那边成功后会直接下发凭证，这里只做转发提示，避免两套校验逻辑不一致。
    return NextResponse.json(
      { error: st(request, "err.badRequest") },
      { status: 400 },
    );
  }

  return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });
}
