import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { readSiteSettings, writeSiteSettings } from "@/lib/site-settings-store";
import { githubOAuthFromEnv, normalizeHost } from "@/lib/oauth-config";
import {
  DEFAULT_SITE_SETTINGS,
  type GithubOauthDomainEntry,
  type SiteSettings,
} from "@/lib/types";
import { presetProvidersFromEnv, sanitizePresetKeys } from "@/lib/preset-keys";
import { sanitizeProviderModels } from "@/lib/config";
import { serverT, serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 清洗「按域名配置的 GitHub OAuth」列表。
 *
 * 只保留域名和 Client ID 都非空的条目 —— 只填了一半的配置留着就是坑，
 * 解析时会命中它却发现 Secret 是空的。
 * 域名规范化后去重：同一域名出现两条时只有第一条会被命中。
 */
function sanitizeOauthDomains(
  input: unknown,
  fallback: GithubOauthDomainEntry[],
): GithubOauthDomainEntry[] {
  if (!Array.isArray(input)) return Array.isArray(fallback) ? fallback : [];
  const seen = new Set<string>();
  const out: GithubOauthDomainEntry[] = [];
  for (const raw of input.slice(0, 50)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    // 域名统一规范化：大小写、端口、www 等写法差异在保存时就抹平
    const domain = normalizeHost(String(r.domain ?? "")).slice(0, 200);
    const clientId = String(r.clientId ?? "").trim().slice(0, 200);
    const clientSecret = String(r.clientSecret ?? "").trim().slice(0, 300);
    if (!domain || !clientId) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, clientId, clientSecret });
  }
  return out;
}

/** GET：管理员读取当前站点配置 */
export async function GET(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: st(request, "err.needAdmin") }, { status: 403 });

  if (!hasRedisConfig()) {
    return NextResponse.json({ settings: DEFAULT_SITE_SETTINGS, storage: false });
  }

  return NextResponse.json({
    settings: await readSiteSettings(),
    storage: true,
    /** 环境变量里已配预设 Key 的服务商 —— 面板里填的会被压过，必须告诉管理员 */
    presetFromEnv: presetProvidersFromEnv(),
    /**
     * 环境变量一旦配了就压过面板里的值。
     * 不告诉管理员的话，他会一直疑惑"我明明填了为什么没生效"。
     */
    githubFromEnv: githubOAuthFromEnv(),
  });
}

/** POST：管理员更新站点配置（全站生效） */
export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: st(request, "err.needAdmin") }, { status: 403 });

  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  let body: Partial<SiteSettings>;
  try {
    body = (await request.json()) as Partial<SiteSettings>;
  } catch {
    return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });
  }

  const current = await readSiteSettings();
  const next: SiteSettings = {
    defaultBaseUrl: String(body.defaultBaseUrl ?? current.defaultBaseUrl ?? "").trim(),
    defaultModel: String(body.defaultModel ?? current.defaultModel ?? "").trim(),
    cloudSaveDefault:
      typeof body.cloudSaveDefault === "boolean"
        ? body.cloudSaveDefault
        : Boolean(current.cloudSaveDefault),
    /* 页脚 / 备案：管理员在面板里填 */
    icpText: String(body.icpText ?? current.icpText ?? "").trim(),
    icpUrl: String(body.icpUrl ?? current.icpUrl ?? "").trim(),
    icpIconUrl: String(body.icpIconUrl ?? current.icpIconUrl ?? "").trim(),
    footerExtra: String(body.footerExtra ?? current.footerExtra ?? "").trim().slice(0, 300),
    /* 联系方式：只允许 telegram / qq / 空，值最多 200 字符 */
    contactType:
      body.contactType === "telegram" || body.contactType === "qq"
        ? body.contactType
        : (current.contactType ?? ""),
    contactValue: String(body.contactValue ?? current.contactValue ?? "").trim().slice(0, 200),
    /* GitHub OAuth：管理员面板里填，环境变量优先于这里 */
    githubClientId: String(body.githubClientId ?? current.githubClientId ?? "")
      .trim()
      .slice(0, 200),
    githubClientSecret: String(body.githubClientSecret ?? current.githubClientSecret ?? "")
      .trim()
      .slice(0, 300),
    /** 多域名部署：每个域名一套 OAuth App */
    githubOauthDomains: sanitizeOauthDomains(
      body.githubOauthDomains ?? current.githubOauthDomains ?? [],
      current.githubOauthDomains ?? [],
    ),
    /* 站点预设 Key：按服务商存，值不对外下发 */
    presetKeys: sanitizePresetKeys(body.presetKeys ?? current.presetKeys ?? {}),
    /**
     * 站点级模型清单：管理员在内置供应商下追加的模型，全站可见。
     *
     * 之前管理员追加的模型只写进自己浏览器的 localStorage，
     * 其他用户完全看不到 —— 现在存到这里，所有人都能用。
     */
    providerModels: sanitizeProviderModels(
      (body.providerModels ?? current.providerModels ?? {}) as Record<string, unknown>,
    ),
    /**
     * 被下架的模型（「最垃圾模型」投票后由管理员手动隐藏）。
     * 只接受字符串数组，其余一律当空数组，避免脏数据把整份配置写坏。
     */
    hiddenModels: Array.isArray(body.hiddenModels)
      ? Array.from(
          new Set(
            body.hiddenModels
              .filter((x): x is string => typeof x === "string")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        ).slice(0, 500)
      : (current.hiddenModels ?? []),
  };

  // Base URL 做基本校验，避免管理员手滑写坏全站
  if (next.defaultBaseUrl && !/^https?:\/\//i.test(next.defaultBaseUrl)) {
    return NextResponse.json({ error: t("api.admin.baseUrlScheme") }, { status: 400 });
  }

  await writeSiteSettings(next);

  /**
   * 写回后立即读一次并一起返回。
   *
   * 之前这里直接返回内存里的 next，所以"看起来保存成功"，
   * 实际根本没写进去（或读回来是默认值）也无法发现。
   * 现在前端可以把回读值直接填进表单，存没存进去一眼能看出来。
   */
  const saved = await readSiteSettings();
  return NextResponse.json({ ok: true, settings: saved, verified: saved.cloudSaveDefault === next.cloudSaveDefault });
}
