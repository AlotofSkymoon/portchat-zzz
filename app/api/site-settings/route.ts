import { NextResponse } from "next/server";

import {
  CONTACT_TYPE,
  CONTACT_VALUE,
  FOOTER_EXTRA,
  ICP_ICON_URL,
  ICP_TEXT,
  ICP_URL,
  REQUIRE_LOGIN,
} from "@/lib/site";
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from "@/lib/types";
import { hasRedisConfig } from "@/lib/redis";
import { readSiteSettings } from "@/lib/site-settings-store";

/**
 * 站点设置的默认值。
 *
 * 页脚/备案这几项优先取环境变量 —— 这样站长既可以在管理员面板里改
 * （改完存进 Redis，覆盖这里），也可以在部署平台直接设好（当初始值）。
 *
 * 顺序：Redis 里管理员存的值 > 环境变量 > 空
 */
function fallbackSettings(): SiteSettings {
  return {
    ...DEFAULT_SITE_SETTINGS,
    icpText: ICP_TEXT,
    icpUrl: ICP_URL,
    icpIconUrl: ICP_ICON_URL,
    footerExtra: FOOTER_EXTRA,
    contactType: CONTACT_TYPE,
    contactValue: CONTACT_VALUE,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/site-settings —— 公开读取站点级配置。
 *
 * 只返回非敏感字段（Base URL / 默认模型 / 云端保存默认开关），
 * 不含任何密钥。未配置存储时回落默认值，站点照常可用。
 */
export async function GET() {
  if (!hasRedisConfig()) {
    return NextResponse.json({ settings: fallbackSettings(), requireLogin: REQUIRE_LOGIN });
  }

  try {
    /**
     * 逐字段合并，而不是整体展开覆盖。
     *
     * readSiteSettings() 返回的是完整对象（空字段是空串），
     * 直接展开会把环境变量提供的初始值冲掉 ——
     * 表现为"面板里没填，环境变量的值也丢了"。
     *
     * 规则：面板值为空 → 回落到环境变量；面板填了 → 用面板的。
     */
    const stored = await readSiteSettings();
    const base = fallbackSettings();
    const settings: SiteSettings = {
      ...stored,
      defaultBaseUrl: stored.defaultBaseUrl || base.defaultBaseUrl,
      defaultModel: stored.defaultModel || base.defaultModel,
      icpText: stored.icpText || base.icpText,
      icpUrl: stored.icpUrl || base.icpUrl,
      icpIconUrl: stored.icpIconUrl || base.icpIconUrl,
      footerExtra: stored.footerExtra || base.footerExtra,
      contactType: stored.contactType || base.contactType,
      contactValue: stored.contactValue || base.contactValue,
    };
    return NextResponse.json({ settings, requireLogin: REQUIRE_LOGIN });
  } catch {
    return NextResponse.json({ settings: fallbackSettings(), requireLogin: REQUIRE_LOGIN });
  }
}
