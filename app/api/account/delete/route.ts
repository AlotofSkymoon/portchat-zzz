import { NextResponse } from "next/server";

import {
  DELETION_GRACE_MINUTES,
  cancelDeletion,
  clearGithubVerified,
  githubVerifiedLogin,
  readDeletion,
  scheduleDeletion,
} from "@/lib/account-deletion";
import {
  getCurrentUser,
  getClientIp,
  readTwoFactor,
  verifyPassword,
} from "@/lib/auth";
import { getRedis, hasRedisConfig, KEYS, storageErrorMessage } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";
import { hashBackupCode, normalizeBackupCode, verifyTotp } from "@/lib/totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 注销账号。
 *
 *   GET    查询状态（是否待注销、还剩多久）
 *   POST   申请注销：需要「GitHub 认证 + 密码 + 两步验证」三样齐全
 *   DELETE 取消注销：需要两步验证
 *
 * 三要素的存放方式：
 *  - GitHub：OAuth 回调时写在服务端（见 markGithubVerified），前端伪造不了
 *  - 密码 / 验证码：在本次请求里直接校验，不经过前端中转
 */

/** 校验两步验证码（TOTP 或备份码），通过则消费掉用过的备份码 */
async function checkTwoFactor(
  userId: string,
  tf: { secret: string; backupCodes?: string[] },
  code: string,
): Promise<boolean> {
  const clean = (code ?? "").trim();
  if (!clean) return false;
  if (await verifyTotp(tf.secret, clean)) return true;

  const digest = await hashBackupCode(normalizeBackupCode(clean));
  const idx = (tf.backupCodes ?? []).indexOf(digest);
  if (idx < 0) return false;

  const rest = [...(tf.backupCodes ?? [])];
  rest.splice(idx, 1);
  await getRedis().hset(KEYS.user(userId), {
    twoFactor: JSON.stringify({ ...tf, backupCodes: rest }),
  });
  return true;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  const rec = readDeletion(user);
  if (!rec) return NextResponse.json({ pending: false });
  return NextResponse.json({
    pending: true,
    deleteAt: rec.deleteAt,
    minutesLeft: Math.max(0, Math.ceil((rec.deleteAt - Date.now()) / 60_000)),
    graceMinutes: DELETION_GRACE_MINUTES,
  });
}

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  // 已经在宽限期里就不用再申请一次
  if (readDeletion(user)) {
    return NextResponse.json({ error: st(request, "api.account.alreadyScheduled") }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
    code?: string;
  };
  const password = typeof body.password === "string" ? body.password : "";
  const code = typeof body.code === "string" ? body.code : "";

  /* ------------------------------ 1. GitHub ------------------------------ */
  /*
   * 没绑定 GitHub 的账号走不了这一步 —— 那就永远无法注销，不合理。
   * 这类账号退化为「密码 + 两步验证」两要素，并在响应里说明。
   * 绑定了 GitHub 的必须过 GitHub，这是硬性要求。
   */
  const ghBound = typeof user.oauth === "string" ? null : user.oauth?.github?.id ?? null;
  let githubLogin: string | null = null;
  if (ghBound) {
    const login = await githubVerifiedLogin(user.id);
    if (!login) {
      return NextResponse.json(
        { error: st(request, "api.account.needGithubVerify"), needGithub: true },
        { status: 403 },
      );
    }
    githubLogin = login;
  }

  /* ------------------------------- 2. 密码 ------------------------------- */
  if (!user.passwordHash) {
    return NextResponse.json({ error: st(request, "api.account.needPasswordFirst") }, { status: 400 });
  }
  const passOk = await verifyPassword(password, user.passwordHash);
  if (!passOk) {
    // 不区分「密码错」和「账号不存在」：这里已登录，只可能是密码错
    return NextResponse.json({ error: st(request, "api.account.wrongPassword") }, { status: 400 });
  }

  /* ----------------------------- 3. 两步验证 ----------------------------- */
  const tf = readTwoFactor(user);
  if (!tf?.enabledAt) {
    return NextResponse.json(
      { error: st(request, "api.account.needTwoFactorSetup"), needTwoFactor: true },
      { status: 400 },
    );
  }
  if (!(await checkTwoFactor(user.id, tf, code))) {
    return NextResponse.json(
      { error: st(request, "api.account.wrongTwoFactor"), needTwoFactor: true },
      { status: 400 },
    );
  }

  await clearGithubVerified(user.id);
  const rec = await scheduleDeletion(user.id, githubLogin);

  /*
   * 不删会话：用户还得留在这看倒计时、点「取消」或「导出」。
   * 真删除发生在宽限期过后（惰性触发，见 lib/account-deletion.ts 顶部说明）。
   */
  console.info("[account] 注销申请已受理", { ip: getClientIp(request.headers) });

  return NextResponse.json({
    ok: true,
    deleteAt: rec.deleteAt,
    minutesLeft: DELETION_GRACE_MINUTES,
    graceMinutes: DELETION_GRACE_MINUTES,
  });
}

export async function DELETE(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  if (!readDeletion(user)) {
    return NextResponse.json({ error: st(request, "api.account.notScheduled") }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const tf = readTwoFactor(user);
  if (!tf?.enabledAt) {
    return NextResponse.json({ error: st(request, "api.account.needTwoFactorSetup") }, { status: 400 });
  }
  if (!(await checkTwoFactor(user.id, tf, typeof body.code === "string" ? body.code : ""))) {
    return NextResponse.json(
      { error: st(request, "api.account.wrongTwoFactor"), needTwoFactor: true },
      { status: 400 },
    );
  }

  await cancelDeletion(user.id);
  await clearGithubVerified(user.id);
  return NextResponse.json({ ok: true });
}
