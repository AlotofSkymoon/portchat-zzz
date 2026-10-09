import { NextResponse } from "next/server";

import { serverT } from "@/lib/i18n/server";
import { planSearch } from "@/lib/search-planner";
import { runAgenticSearch } from "@/lib/search-agent";
import { MAX_SEARCH_RESULTS, configuredKeyedSources } from "@/lib/web-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/web-search —— 联网搜索。
 *
 * 开启「联网」开关后，前端先调这里拿结果，再把结果作为上下文
 * 一起发给模型，模型据此作答并标注来源。
 *
 * ============ 不是每句都搜 ============
 *
 * 用户开了联网不等于「每句话都要查」。所以这里先过一遍决策器：
 * 问「你好」「把这段改成 async」这种直接跳过，不等搜索往返；
 * 该搜的才搜，且用模型提炼过的关键词而不是整句硬截。
 *
 * 返回 skipped=true 表示「这次不用搜」，前端据此跳过拼上下文。
 *
 * 不需要任何 API Key：走 Bing / Sogou / DuckDuckGo 的公开端点。
 */
export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  let body: {
    query?: string;
    limit?: number;
    /** 最近几条对话（决策用，可省略） */
    messages?: { role: string; content: unknown }[];
    /** 关掉决策，回到「每句都搜」（调试用） */
    always?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: t("api.badRequest") }, { status: 400 });
  }

  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ ok: false, error: t("api.webSearch.queryMissing") }, { status: 400 });
  }

  // 条数放宽到 1~100（摘要会自动压缩，不必担心撑爆上下文）
  const limit = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Number(body.limit) || 30));

  /* ---------------------- 决策：这次到底要不要搜 ---------------------- */

  const history = Array.isArray(body.messages) ? body.messages : [];
  const plan =
    body.always === true
      ? { need: true, queries: [] as string[], via: "fallback" as const, reason: "always" }
      : await planSearch({ messages: history, signal: request.signal });

  if (!plan.need) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      decision: { need: false, via: plan.via, reason: plan.reason },
      results: [],
      context: "",
      keyedSources: configuredKeyedSources(),
    });
  }

  /* ---------------------------- 真正开搜 ---------------------------- */

  const agent = await runAgenticSearch({
    question: query,
    limit,
    // 决策器已经想好的关键词直接当首轮用，省一次往返
    seedQueries: plan.queries,
    signal: request.signal,
  });

  // 多轮时把关键词链告诉模型：它自己搜过什么，不该再重复追问
  const chain =
    agent.queries.length > 1 ? `搜索过程：${agent.queries.join(" → ")}\n\n` : "";

  return NextResponse.json({
    ok: agent.ok,
    error: agent.error,
    results: agent.results,
    context: agent.ok ? chain + agent.context : "",
    // 实际命中的源 + 各源尝试情况，便于排查"搜不到/搜不准"
    via: agent.via ?? null,
    attempts: agent.attempts,
    // 决策依据，排查"为什么搜了 / 为什么没搜"
    decision: { need: true, via: plan.via, reason: plan.reason, queries: plan.queries },
    // Agent 自己走的每一步（关键词链 + 每轮命中数），前端可展示"AI 搜了哪些词"
    agent: { queries: agent.queries, steps: agent.steps, rounds: agent.rounds, finished: agent.finished },
    // 当前配置了哪些 Key 源（只给标识，不含密钥）
    keyedSources: configuredKeyedSources(),
  });
}
