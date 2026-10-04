import { hasRedisConfig } from "@/lib/redis";
import { readSiteSettings } from "@/lib/site-settings-store";

/**
 * GitHub OAuth 凭证的解析。
 *
 * 两处来源，环境变量优先：
 *   1. 环境变量 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET（部署平台里配）
 *   2. 管理员面板里填的站点设置（/admin → 站点设置）
 *
 * 为什么环境变量优先：换部署环境时不必清库，且面板里误填也不会把线上登录改坏。
 * 面板里填的值存在存储里，管理员随时可改，不用重新部署。
 */

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  /** env = 来自环境变量；site = 来自管理员面板；none = 都没配 */
  source: "env" | "site" | "none";
}

/** 环境变量是否完整配置了 GitHub OAuth */
export function githubOAuthFromEnv(): boolean {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

/**
 * 解析当前可用的 GitHub OAuth 凭证。
 * 都没配时返回空串，调用方据此隐藏登录按钮。
 */
export async function resolveGithubOAuth(): Promise<GithubOAuthConfig> {
  const envId = process.env.GITHUB_CLIENT_ID?.trim() ?? "";
  const envSecret = process.env.GITHUB_CLIENT_SECRET?.trim() ?? "";
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, source: "env" };
  }

  if (!hasRedisConfig()) {
    return { clientId: "", clientSecret: "", source: "none" };
  }

  try {
    const s = await readSiteSettings();
    const id = (s.githubClientId ?? "").trim();
    const secret = (s.githubClientSecret ?? "").trim();
    if (id && secret) return { clientId: id, clientSecret: secret, source: "site" };
  } catch {
    /* 存储读不到就当没配，不能因为读失败把登录页搞崩 */
  }

  return { clientId: "", clientSecret: "", source: "none" };
}
