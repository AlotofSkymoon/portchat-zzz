import { NextResponse } from "next/server";

import {
  checkLoginRateLimit,
  createSession,
  getClientIp,
  isValidEmail,
  setSessionCookie,
  toSafeUser,
  verifyPassword,
  readTwoFactor,
  type UserRecord,
} from "@/lib/auth";
import { isEmailConfigured } from "@/lib/email";
import { getRedis, getValue, hasRedisConfig,
  storageErrorMessage, hgetAll, KEYS } from "@/lib/redis";
import { verifyTotp, hashBackupCode, normalizeBackupCode } from "@/lib/totp";
import { issueTrustCookie, isTrustedDevice } from "@/lib/two-factor";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_ERROR = "err.loginFailed";

export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json(
        { error: storageErrorMessage() },
        { status: 500 },
      );
    }

    // 简单限流：同一 IP 1 分钟最多 10 次
    const ip = getClientIp(request.headers);
    const allowed = await checkLoginRateLimit(ip, 10, 60);
    if (!allowed) {
      return NextResponse.json({ error: st(request, "err.loginTooMany") }, { status: 429 });
    }

    const body = (await request.json()) as {
      email?: string;
      password?: string;
      code?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const code = (body.code ?? "").trim();

    if (!isValidEmail(email) || !password) {
      // 不区分“邮箱不存在”和“密码错误”，统一模糊提示
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    const redis = getRedis();

    const userId = await getValue<string>(KEYS.userEmail(email));
    if (!userId) {
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    const user = await hgetAll<UserRecord>(KEYS.user(userId));
    if (!user?.passwordHash) {
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: st(request, GENERIC_ERROR) }, { status: 401 });
    }

    /*
     * 密码对了，但邮箱还没验证 —— 不放行。
     *
     * 只在**确实要求验证**时才拦：老账号没有 emailVerified 字段（undefined），
     * 按已验证处理；只有显式 false 才算未验证，否则一次更新会把老用户全锁在门外。
     */
    if (user.emailVerified === false && isEmailConfigured()) {
      return NextResponse.json(
        { error: st(request, "err.emailNotVerified"), needVerification: true, email },
        { status: 403 },
      );
    }

    /*
     * 两步验证。
     *
     * 「免 2FA 一个月」靠一个签名的信任 Cookie（见 lib/two-factor.ts）：
     * 这台设备上一次验证过，30 天内不再问。换设备 / 清 Cookie 就重新要。
     *
     * 注意顺序：只有密码已经对了才走到这里，所以 2FA 不会泄露"这个账号存不存在"。
     */
    const tf = readTwoFactor(user);
    if (tf?.enabledAt) {
      const trusted = await isTrustedDevice(user.id);
      if (!trusted) {
        // 还没输验证码 → 告诉前端把验证码框显示出来，此时**不发会话**
        if (!code) {
          return NextResponse.json(
            { error: "请输入两步验证的验证码", needTwoFactor: true },
            { status: 401 },
          );
        }

        const viaTotp = await verifyTotp(tf.secret, code);
        let consumedBackup = false;

        if (!viaTotp) {
          // 备份码：只能用一次，用掉就从库里删掉
          const digest = await hashBackupCode(normalizeBackupCode(code));
          const idx = (tf.backupCodes ?? []).indexOf(digest);
          if (idx < 0) {
            return NextResponse.json(
              { error: "验证码不对", needTwoFactor: true },
              { status: 401 },
            );
          }
          const rest = [...tf.backupCodes];
          rest.splice(idx, 1);
          await redis.hset(KEYS.user(user.id), {
            twoFactor: JSON.stringify({ ...tf, backupCodes: rest }),
          });
          consumedBackup = true;
        }

        await issueTrustCookie(user.id);
        const s = await createSession(user.id);
        await setSessionCookie(s.sessionId, s.maxAge);
        return NextResponse.json({
          user: toSafeUser(user),
          backupRemaining: consumedBackup
            ? Math.max(0, (tf.backupCodes?.length ?? 0) - 1)
            : (tf.backupCodes?.length ?? 0),
        });
      }
    }

    const { sessionId, maxAge } = await createSession(user.id);
    await setSessionCookie(sessionId, maxAge);
    return NextResponse.json({ user: toSafeUser(user) });
  } catch (error) {
    console.error("[login] 登录失败");
    return NextResponse.json({ error: st(request, "err.loginGeneric") }, { status: 500 });
  }
}
