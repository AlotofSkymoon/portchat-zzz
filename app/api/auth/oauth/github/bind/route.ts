import { NextResponse } from "next/server";

import { getCurrentUser, readOAuth } from "@/lib/auth";
import { getRedis, KEYS, hasRedisConfig } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";
import { resolveGithubOAuth } from "@/lib/oauth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET    /api/auth/oauth/github/bind —— 查当前账号的 GitHub 绑定状态
 * DELETE /api/auth/oauth/github/bind —— 解绑
 *
 * 绑定本身由 /api/auth/oauth/github?mode=bind 发起（跳 GitHub），
 * 回调写库。这里只负责「看」和「解」。
 */

export async function GET(request: Request) {
  const cfg = await resolveGithubOAuth();
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: st(request, "api.notLoggedIn") }, { status: 401 });
  }
  const gh = readOAuth(user)?.github ?? null;
  return NextResponse.json({
    enabled: cfg.source !== "none",
    bound: !!gh?.id,
    login: gh?.login ?? null,
  });
}

export async function DELETE(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: st(request, "err.storageNotConfigured") }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: st(request, "api.notLoggedIn") }, { status: 401 });
  }

  const gh = readOAuth(user)?.github ?? null;
  if (!gh?.id) {
    return NextResponse.json({ error: st(request, "api.auth.oauthNotBound") }, { status: 400 });
  }

  /*
   * 没有密码就不给解绑：这类账号（当初用 GitHub 建号）只有 GitHub 一个入口，
   * 解了就再也进不来。必须先设密码再解绑。
   */
  if (!user.passwordHash) {
    return NextResponse.json({ error: st(request, "api.auth.oauthNeedPasswordFirst") }, { status: 400 });
  }

  const redis = getRedis();

  // 清掉绑定字段，其余字段不动
  const bindings = { ...readOAuth(user) };
  delete bindings.github;
  await redis.hset(KEYS.user(user.id), { oauth: JSON.stringify(bindings) });

  // 索引只在仍指向本人时才删：并发下可能已被别处改写
  const owner = await redis.get<string>(KEYS.githubId(gh.id)).catch(() => null);
  if (owner === user.id) await redis.del(KEYS.githubId(gh.id)).catch(() => undefined);

  return NextResponse.json({ ok: true });
}
