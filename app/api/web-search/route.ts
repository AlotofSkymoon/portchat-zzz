import { NextResponse } from "next/server";

import { serverT } from "@/lib/i18n/server";
import {
  MAX_SEARCH_RESULTS,
  configuredKeyedSources,
  formatSearchContext,
  webSearch,
} from "@/lib/web-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/web-search —— 联网搜索。
 *
 * 开启「联网」开关后，前端先调这里拿结果，再把结果作为上下文
 * 一起发给模型，模型据此作答并标注来源。
 *
 * 不需要任何 API Key：走 DuckDuckGo 的公开 HTML 端点。
 */
export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  let body: { query?: string; limit?: number };
  try {
    body = (await request.json()) as { query?: string; limit?: number };
  } catch {
    return NextResponse.json({ ok: false, error: t("api.badRequest") }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ ok: false, error: t("api.webSearch.queryMissing") }, { status: 400 });
  }

  // 条数放宽到 1~100（摘要会自动压缩，不必担心撑爆上下文）
  const limit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Number(body.limit) || 30));

  const outcome = await webSearch(query, limit);

  return NextResponse.json({
    ok: outcome.ok,
    error: outcome.error,
    results: outcome.results,
    context: outcome.ok ? formatSearchContext(query, outcome.results) : "",
    // 实际命中的源 + 各源尝试情况，便于排查"搜不到/搜不准"
    via: outcome.via ?? null,
    attempts: outcome.attempts ?? [],
    // 当前配置了哪些 Key 源（只给标识，不含密钥）
    keyedSources: configuredKeyedSources(),
  });
}
