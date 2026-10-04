import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { serverT as st } from "@/lib/i18n/server";
import { resolveGithubOAuth } from "@/lib/oauth-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oauth/github —— 跳转到 GitHub 授权页。
 *
 * 配置项，二选一（环境变量优先）：
 *   A. Vercel / Workers 环境变量：
 *        GITHUB_CLIENT_ID
 *        GITHUB_CLIENT_SECRET
 *   B. 管理员面板 /admin → 站点设置 → GitHub 登录（存在存储里，不用重新部署）
 *
 * 回调地址（GitHub OAuth App 后台里填这条）：
 *   https://<你的域名>/api/auth/oauth/github/callback
 *
 * state 的作用：防止别人诱导你的浏览器发起登录、把会话绑到他的账号上
 * （CSRF）。这里用一段随机数存 cookie，回调时比对。
 */

const GITHUB_AUTHORIZE = "https://github.com/login/oauth/authorize";
/** state 有效期：10 分钟足够完成一次授权 */
const STATE_TTL_SECONDS = 600;
const STATE_COOKIE = "pc_oauth_state";

/** 只申请读取公开资料和邮箱，不要 write 权限 */
const SCOPE = "read:user user:email";

export async function GET(request: Request) {
  /*
   * ?probe=1 —— 只问"配没配"，不跳转。
   * 登录页要靠它决定要不要显示 GitHub 按钮：
   * 不查的话没配置也会显示，点下去 501，用户只看到一句报错。
   */
  if (new URL(request.url).searchParams.get("probe") === "1") {
    const cfg = await resolveGithubOAuth();
    return NextResponse.json({ enabled: cfg.source !== "none", source: cfg.source });
  }

  // 环境变量优先，其次是管理员面板里填的
  const cfg = await resolveGithubOAuth();
  const clientId = cfg.clientId;
  if (!clientId) {
    return NextResponse.json({ error: st(request, "api.auth.oauthNotConfigured") }, { status: 501 });
  }

  const url = new URL(request.url);
  // 只允许站内相对路径，防止开放重定向（?redirect=https://evil.com）
  const raw = url.searchParams.get("redirect") || "/chat";
  const redirect = /^\/(?!\/)/.test(raw) ? raw : "/chat";

  const origin = url.origin;
  const callbackUrl = `${origin}/api/auth/oauth/github/callback`;

  // 24 字节随机数，URL 安全
  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

  const store = await cookies();
  store.set(STATE_COOKIE, JSON.stringify({ state, redirect }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: SCOPE,
    state,
    // 不请求重新授权：用户已经授权过就不要再弹一次
    allow_signup: "true",
  });

  return NextResponse.redirect(`${GITHUB_AUTHORIZE}?${params.toString()}`);
}

export { STATE_COOKIE, STATE_TTL_SECONDS };
