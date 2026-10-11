import { hasRedisConfig } from "@/lib/redis";
import { readSiteSettings } from "@/lib/site-settings-store";
import type { GithubOauthDomainEntry, SiteSettings } from "@/lib/types";

/**
 * GitHub OAuth 凭证的解析。
 *
 * 三个来源，按此顺序取第一个可用的：
 *   1. 按域名配置的 OAuth App（管理员面板里填，多域名部署用）
 *   2. 环境变量 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 *   3. 管理员面板里的单一配置（同上，不分域名）
 *
 * 为什么域名映射排在最前：GitHub OAuth App 的回调地址是写死在 App 里的，
 * 一个 App 只能对应一个域名。站点同时跑 chat.xyz.ci 和 pot-ai.cc.cd 时，
 * 必须建两个 App。若让环境变量压过域名映射，多域名就永远配不生效。
 *
 * 环境变量仍保留在第 2 位：单域名部署时不用进面板也能用，
 * 且某个域名没登记到映射表时还能兜底，不至于整站登录挂掉。
 */

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** 域名映射命中 / 环境变量 / 面板单一配置 / 都没配 */
  source: "site-domain" | "env" | "site" | "none";
  /** source 为 site-domain 时，命中的是哪个域名（已规范化） */
  domain?: string;
}

/**
 * state 用的 Cookie 名与有效期。
 *
 * ⚠️ 这两个常量必须放在 lib 里，不能从 app/api/**\/route.ts 导出。
 * Next.js 会为路由文件生成类型校验：只允许导出 GET/POST/runtime/dynamic 等
 * 固定名字，多出来的具名导出会报 TS2344（Property 'xxx' is incompatible
 * with index signature）。之前就是写在 route.ts 里 export 出去才构建失败的。
 */
/** state 有效期：10 分钟足够完成一次授权 */
export const STATE_TTL_SECONDS = 600;
export const STATE_COOKIE = "pc_oauth_state";

/**
 * 把各种写法的主机名统一成一种形式。
 *
 * 要处理的情况：大小写、带协议、带路径、带端口、尾部根点。
 * 不统一的话 `Chat.xyz.ci:443` 和 `chat.xyz.ci` 会被当成两个域名，
 * 明明配了却匹配不上。
 */
export function normalizeHost(raw: string): string {
  let h = (raw ?? "").trim().toLowerCase();
  if (!h) return "";
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // 去掉协议
  const slash = h.indexOf("/");
  if (slash >= 0) h = h.slice(0, slash); // 去掉路径
  // 去掉端口。IPv6 的 [::1]:3000 单独处理，不去动方括号里的内容
  if (!h.startsWith("[")) {
    const colon = h.lastIndexOf(":");
    if (colon > 0) h = h.slice(0, colon);
  }
  h = h.replace(/\.+$/, ""); // 去掉 DNS 根点
  return h;
}

/** 去掉 www. 前缀，让 www.chat.xyz.ci 也能命中 chat.xyz.ci */
function stripWww(h: string): string {
  return h.startsWith("www.") ? h.slice(4) : h;
}

/**
 * 从请求里取当前访问的主机名。
 *
 * 优先 x-forwarded-host：Vercel / CF 等反代后面，host 头可能是内部地址，
 * 拿它去匹配域名表就会全部落空。取不到再依次回落到 host 头和 URL。
 */
export function requestHost(request: Request): string {
  const fwd = request.headers.get("x-forwarded-host") ?? "";
  const direct = request.headers.get("host") ?? "";
  let urlHost = "";
  try {
    urlHost = new URL(request.url).host;
  } catch {
    /* request.url 不合法时忽略，下面还有兜底 */
  }
  // x-forwarded-host 可能是 "a.com, b.com" 的链，取第一个（最外层）加的
  const first = fwd.split(",")[0] ?? "";
  return normalizeHost(first || direct || urlHost);
}

/**
 * 在域名配置表里找当前 host 对应的一套凭证。
 * 先精确匹配，再忽略 www. 前缀匹配一次。
 */
export function matchDomainEntry(
  host: string,
  list: GithubOauthDomainEntry[],
): GithubOauthDomainEntry | null {
  const h = normalizeHost(host);
  if (!h) return null;

  for (const e of list) {
    const d = normalizeHost(e?.domain ?? "");
    if (d && d === h) return e;
  }

  /*
   * 再忽略 www. 前缀比一次。
   *
   * 两个方向都要覆盖：访问 www.a.com 而配置写的是 a.com，以及
   * 配置写 www.a.com 而访问的是 a.com。只写一个方向的话，管理员
   * 随手填了 www 就永远匹配不上，而且看不出原因。
   */
  const stripped = stripWww(h);
  for (const e of list) {
    const d = normalizeHost(e?.domain ?? "");
    if (d && stripWww(d) === stripped) return e;
  }

  return null;
}

/** 环境变量是否完整配置了 GitHub OAuth */
export function githubOAuthFromEnv(): boolean {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

/**
 * 解析当前可用的 GitHub OAuth 凭证。
 *
 * @param host 当前访问域名。不传就只走环境变量和面板单一配置，
 *             等于退回单域名时代的行为 —— 调用方应尽量传。
 *
 * 都没配时返回空串，调用方据此隐藏登录按钮。
 */
export async function resolveGithubOAuth(host?: string): Promise<GithubOAuthConfig> {
  const h = normalizeHost(host ?? "");

  // 存储没配就不用读了，两次读取都是白跑
  let settings: SiteSettings | null = null;
  if (hasRedisConfig()) {
    try {
      settings = await readSiteSettings();
    } catch {
      /* 存储读不到就当没配，不能因为读失败把登录页搞崩 */
      settings = null;
    }
  }

  /* 1) 按域名配置的 OAuth App —— 多域名部署走这里 */
  if (h && settings) {
    const list = Array.isArray(settings.githubOauthDomains) ? settings.githubOauthDomains : [];
    const hit = matchDomainEntry(h, list);
    if (hit) {
      const id = (hit.clientId ?? "").trim();
      const secret = (hit.clientSecret ?? "").trim();
      // 命中了但填了一半（只填 ID 没填 Secret）就当没配，继续往下兜底，
      // 否则会拿着空 Secret 去换 token，用户只看到一句含糊的失败
      if (id && secret) {
        return {
          clientId: id,
          clientSecret: secret,
          source: "site-domain",
          domain: normalizeHost(hit.domain ?? ""),
        };
      }
    }
  }

  /* 2) 环境变量 —— 单域名部署 / 兜底 */
  const envId = process.env.GITHUB_CLIENT_ID?.trim() ?? "";
  const envSecret = process.env.GITHUB_CLIENT_SECRET?.trim() ?? "";
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, source: "env" };
  }

  /* 3) 面板里的单一配置 —— 兼容旧数据，不分域名 */
  if (settings) {
    const id = (settings.githubClientId ?? "").trim();
    const secret = (settings.githubClientSecret ?? "").trim();
    if (id && secret) return { clientId: id, clientSecret: secret, source: "site" };
  }

  return { clientId: "", clientSecret: "", source: "none" };
}
