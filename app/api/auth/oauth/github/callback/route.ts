import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { createSession, createUserId, setSessionCookie, toSafeUser, getCurrentUser, readOAuth } from "@/lib/auth";
import { getRedis, hgetAll, hasRedisConfig, storageErrorMessage, KEYS } from "@/lib/redis";
import { issueTrustCookie } from "@/lib/two-factor";
import { resolveGithubOAuth, STATE_COOKIE } from "@/lib/oauth-config";
import type { UserRecord } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oauth/github/callback —— GitHub 授权完成后的回跳。
 *
 * 流程：
 *   1. 校验 state（防 CSRF）
 *   2. code 换 access_token
 *   3. 拉 GitHub 用户信息（优先用邮箱，没有就用 <login>@users.noreply.github.com）
 *   4. 已有账号就绑定/登录，没有就自动建号
 *   5. 建 session 并种 Cookie，跳回目标页
 */

const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const EMAIL_URL = "https://api.github.com/user/emails";

interface GithubUser {
  id: number;
  login: string;
  email: string | null;
  name?: string | null;
}

function fail(request: Request, reason: string, redirect = "/login") {
  const url = new URL(redirect, request.url);
  url.searchParams.set("oauth_error", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  if (!hasRedisConfig()) return fail(request, "storage");

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const returnedState = url.searchParams.get("state") || "";

  const store = await cookies();
  const raw = store.get(STATE_COOKIE)?.value || "";
  store.set(STATE_COOKIE, "", { path: "/", maxAge: 0 }); // state 一次性

  let saved: { state: string; redirect: string; mode?: "login" | "bind" } = {
    state: "",
    redirect: "/chat",
  };
  try {
    saved = JSON.parse(raw);
  } catch {
    return fail(request, "state");
  }

  if (!saved.state || saved.state !== returnedState) return fail(request, "state");
  if (!code) return fail(request, "no_code");

  const mode: "login" | "bind" = saved.mode === "bind" ? "bind" : "login";

  // 环境变量优先，其次是管理员在 /admin 面板里填的
  const cfg = await resolveGithubOAuth();
  const clientId = cfg.clientId;
  const clientSecret = cfg.clientSecret;
  if (!clientId || !clientSecret) return fail(request, "not_configured");

  /* --------------------------- 换 access_token --------------------------- */
  let accessToken = "";
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!data.access_token) return fail(request, data.error || "token");
    accessToken = data.access_token;
  } catch {
    return fail(request, "token");
  }

  /* ---------------------------- 拉用户信息 ---------------------------- */
  let gh: GithubUser;
  try {
    const ghRes = await fetch(USER_URL, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "Portchat",
      },
    });
    if (!ghRes.ok) return fail(request, "profile");
    gh = (await ghRes.json()) as GithubUser;

    // 公开资料里 email 可能是 null（用户设了私密），再去 emails 接口取主邮箱
    if (!gh.email) {
      try {
        const mailRes = await fetch(EMAIL_URL, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/vnd.github+json",
            "user-agent": "Portchat",
          },
        });
        if (mailRes.ok) {
          const list = (await mailRes.json()) as {
            email: string;
            primary: boolean;
            verified: boolean;
          }[];
          const primary = list.find((m) => m.primary && m.verified) ?? list.find((m) => m.verified);
          if (primary) gh.email = primary.email;
        }
      } catch {
        /* 取不到邮箱不影响登录，走兜底地址 */
      }
    }
  } catch {
    return fail(request, "profile");
  }

  const githubId = String(gh.id);
  const email = (gh.email || `${gh.login}@users.noreply.github.com`).toLowerCase();

  const redis = getRedis();

  /* --------------------------- 绑定模式 --------------------------- */
  /*
   * 已登录用户在设置里点「绑定 GitHub」走这里。
   * 跟登录模式的差别：不建会话、不动登录态，只把 GitHub id 写进当前账号。
   */
  if (mode === "bind") {
    const current = await getCurrentUser();
    if (!current) return fail(request, "need_login", saved.redirect || "/chat");

    const owner = await redis.get<string>(KEYS.githubId(githubId)).catch(() => null);
    if (owner && owner !== current.id) return fail(request, "already_bound", saved.redirect || "/chat");

    const bindings = { ...readOAuth(current), github: { id: githubId, login: gh.login } };
    // 只改 oauth 一个字段 —— 用 set 整个覆盖会丢掉 hash 里其他内容
    await redis.hset(KEYS.user(current.id), { oauth: JSON.stringify(bindings) });
    await redis.set(KEYS.githubId(githubId), current.id).catch(() => undefined);

    const done = new URL(saved.redirect || "/chat", request.url);
    done.searchParams.set("oauth_bound", "1");
    return NextResponse.redirect(done);
  }

  /* ------------------------------ 找用户 ------------------------------ */
  // 1) 先按 GitHub id 精确匹配（已绑定过的）
  let userId = await redis.get<string>(KEYS.githubId(githubId)).catch(() => null);

  // 2) 再按邮箱匹配（先用邮箱注册过、现在用 GitHub 登录同一个人）
  if (!userId) {
    const byEmail = await redis.get<string>(KEYS.userEmail(email)).catch(() => null);
    if (byEmail) userId = byEmail;
  }

  let user: UserRecord | null = null;
  if (userId) {
    // ⚠️ 用户记录是 Redis hash，不能用 get / getJsonValue
    user = await hgetAll<UserRecord>(KEYS.user(userId));
  }

  /* ------------------------------ 建用户 ------------------------------ */
  if (!user) {
    const id = createUserId();
    const now = new Date().toISOString();
    // 没有密码：passwordHash 置空字符串，密码登录会失败，只能用 GitHub 登录。
    // 比塞一个随机密码更明确 —— 不会出现"用邮箱登录提示密码错误"的困惑。
    const record: UserRecord = {
      id,
      email,
      passwordHash: "",
      role: "user",
      createdAt: now,
      emailVerified: true, // GitHub 已验证过邮箱所有权
      oauth: { github: { id: githubId, login: gh.login } },
    };
    // hash 写入；oauth 是嵌套对象，序列化成 JSON 字段
    await redis.hset(KEYS.user(id), {
      id,
      email,
      passwordHash: "",
      role: "user",
      createdAt: now,
      emailVerified: "true",
      oauth: JSON.stringify(record.oauth),
    });
    await redis.set(KEYS.userEmail(email), id);
    await redis.incr(KEYS.usersCount).catch(() => undefined);
    user = record;
  } else {
    // 老账号补上绑定关系（首次用 GitHub 登录已有的邮箱账号）
    const bindings = { ...readOAuth(user), github: { id: githubId, login: gh.login } };
    // 只改 oauth 一个字段，不动其余字段 —— 用 set 整个覆盖会丢掉 hash 里其他内容
    await redis.hset(KEYS.user(user.id), { oauth: JSON.stringify(bindings) });
    user = { ...user, oauth: bindings };
  }

  // 建索引，下次按 GitHub id 直达
  await redis.set(KEYS.githubId(githubId), user.id).catch(() => undefined);

  /* ------------------------------ 建会话 ------------------------------ */
  const session = await createSession(user.id);
  await setSessionCookie(session.sessionId, session.maxAge);

  // GitHub 登录本身已完成了一次强身份认证（GitHub 侧可能还有自己的 2FA），
  // 所以这里直接种信任 Cookie：之后 30 天内本站不再要求输验证码。
  await issueTrustCookie(user.id);

  const target = new URL(saved.redirect || "/chat", request.url);
  target.searchParams.set("oauth_ok", "1");
  return NextResponse.redirect(target);
}
