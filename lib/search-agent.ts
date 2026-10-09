/**
 * 联网搜索 Agent —— 让模型自己决定「搜什么、还要不要再搜」。
 *
 * ============ 为什么需要这个 ============
 *
 * 旧实现是「一次决策 + 一次搜索」：把整句提问压成关键词，搜一回就交差。
 * 遇到「孙楠最近在做什么」这种问题就废了——第一轮搜「孙楠」换来的只是
 * 「孙楠是谁」，而用户要的是近况，得再搜一次「孙楠 现状」才拿得到。
 *
 * 这里改成 **模型自己驱动的多轮循环**：
 *
 *   1. 模型读用户问题 → 输出下一步：搜某个词，或者「够了，可以回答了」
 *   2. 服务端照它说的去搜，把结果压缩成摘要
 *   3. 摘要塞回给模型，再问一次「还要不要再搜」
 *   4. 直到模型说够了，或用完轮次预算
 *
 * 用户举的例子正是这个流程：
 *   「谁是孙楠」      → 第一轮搜「孙楠」
 *   「他最近在干嘛」  → 第二轮搜「孙楠 现状」
 *
 * ============ 几个刻意的取舍 ============
 *
 * - **用站点预设 Key，不烧用户额度**：判断"还要不要再搜"是站点自己的事，
 *   跟判断"要不要搜"一样。没有预设 Key 就退化成单轮，不会卡住。
 * - **轮次上限默认 3**：再多用户等不起，而且搜索引擎本身也该换个词就该出结果。
 * - **每一步都超时**：宁可少搜一轮，也不要让用户在输入框前干等。
 * - **搜过的词不再搜**：模型重复输出同一个词说明它卡住了，直接收尾。
 */

import { resolveTarget } from "@/lib/config";
import { configValue } from "@/lib/runtime-config";
import { webSearch, formatSearchContext, type SearchResult } from "@/lib/web-search";

/** 单步决策：继续搜，还是够了 */
interface AgentDecision {
  action: "search" | "answer";
  query: string;
}

/** 每一步的记录，便于前端展示"AI 搜了哪些词" */
export interface AgentStep {
  round: number;
  query: string;
  hits: number;
  via?: string;
}

export interface AgentOutcome {
  ok: boolean;
  /** 各轮结果按 url 去重后的合并集 */
  results: SearchResult[];
  /** 拼给模型的上下文 */
  context: string;
  /** 关键词链：["孙楠", "孙楠 现状"] */
  queries: string[];
  steps: AgentStep[];
  rounds: number;
  /** 怎么结束的：模型说够了 / 轮次用尽 / 一开始就失败 */
  finished: "answer" | "exhausted" | "failed";
  error?: string;
  via?: string;
  attempts: string[];
}

/** 默认最多搜 3 轮 */
const DEFAULT_MAX_ROUNDS = 3;
/** 单步决策超时 */
const STEP_TIMEOUT = 8_000;
/** 每轮回传给模型的证据条数（多了费 token，少了判断不准） */
const EVIDENCE_PER_ROUND = 6;
/** 每条证据的摘要长度 */
const SNIPPET_LEN = 140;

const STEP_SYSTEM = [
  "你是一个联网搜索 Agent。用户会给你一个问题和已经搜到的证据。",
  "你要判断：信息是否足够回答用户的问题。",
  "",
  "只输出一个 JSON 对象，不要任何其它文字：",
  '- 还需要更多信息：{"action":"search","query":"搜索关键词"}',
  '- 信息已经足够：{"action":"answer","query":""}',
  "",
  "query 要求：",
  "- 搜索引擎友好的关键词，不是完整句子；去掉「请问」「帮我」这类客套",
  "- 只给 1 个词；和已搜过的词必须有实质区别（换角度、加时间限定、加具体方面）",
  "- 用户提到的专名、产品名、地名保留原样",
  "",
  "判断准则：",
  "- 用户问近况/最新/现在，而证据里没有时间信息 → 继续搜，加上「现状」「最新」「2026」等词",
  "- 用户问的是对比/多个方面，而证据只覆盖了一部分 → 继续搜剩下的方面",
  "- 只是简单的事实问答，证据已经回答了 → 直接 answer",
  "- 已经搜过 2 轮还没有更好的结果 → 倾向 answer，不要为了完美一直搜",
].join("\n");

/** 从模型输出里抠出第一个 JSON 对象（模型爱加解释文字） */
function parseDecision(raw: string): AgentDecision | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const action = obj.action === "search" ? "search" : "answer";
    const query = typeof obj.query === "string" ? obj.query.trim() : "";
    if (action === "search" && !query) return null;
    return { action, query };
  } catch {
    return null;
  }
}

/** 把搜索结果压成给模型看的证据块 */
function buildEvidence(results: SearchResult[]): string {
  if (results.length === 0) {
    return "（这一轮没有搜到任何结果）";
  }
  return results
    .slice(0, EVIDENCE_PER_ROUND)
    .map((r, i) => {
      const snip = (r.snippet ?? "").replace(/\s+/g, " ").slice(0, SNIPPET_LEN);
      return `${i + 1}. ${r.title}${snip ? ` —— ${snip}` : ""}`;
    })
    .join("\n");
}

/**
 * 让模型决定下一步。
 *
 * 用**服务端预设 Key**，跟"要不要搜"的决策一样：
 * 这是站点自己的调度开销，不该烧用户额度。
 * 没有预设 Key / 上游异常 → 返回 null，由调用方收尾。
 */
async function askNextStep(
  question: string,
  queries: string[],
  evidenceBlocks: string[],
  signal?: AbortSignal,
): Promise<AgentDecision | null> {
  const presetKey = configValue("PRESET_AGNES_API_KEY")?.trim();
  if (!presetKey) return null;

  const model = process.env.UPSTREAM_MODEL?.trim() || "agnes-3.0-flash";
  const target = resolveTarget(model, []);
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  const searched = queries.length > 0 ? `\n已经搜过的词：${queries.join(" / ")}` : "";
  const evidence =
    evidenceBlocks.length > 0
      ? `\n\n已经搜到的证据：\n${evidenceBlocks.join("\n\n")}`
      : "\n\n（还没有任何证据）";

  try {
    const res = await fetch(`${target.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${presetKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        max_tokens: 96,
        messages: [
          { role: "system", content: STEP_SYSTEM },
          { role: "user", content: `用户的问题：${question}${searched}${evidence}` },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[search-agent] 上游返回", res.status);
      return null;
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseDecision(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Agent 式联网搜索：模型自己决定搜什么、还要不要再搜。
 *
 * @param question 用户的原始提问（模型看的是这个，不是压缩后的关键词）
 * @param limit 每轮结果条数上限
 * @param maxRounds 最多搜几轮
 */
export async function runAgenticSearch(options: {
  question: string;
  limit?: number;
  maxRounds?: number;
  /** 首轮关键词（决策器已提炼过的话优先用它，比让模型再想一遍快） */
  seedQueries?: string[];
  signal?: AbortSignal;
}): Promise<AgentOutcome> {
  const { question, limit = 30, maxRounds = DEFAULT_MAX_ROUNDS, seedQueries = [], signal } = options;

  const queries: string[] = [];
  const steps: AgentStep[] = [];
  const evidenceBlocks: string[] = [];
  const merged: SearchResult[] = [];
  const attempts: string[] = [];
  let via: string | undefined;
  let anyOk = false;

  const seen = new Set<string>();
  const absorb = (results: SearchResult[]) => {
    for (const r of results) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
    }
  };

  for (let round = 1; round <= maxRounds; round++) {
    /* ---------- 这一步搜什么 ---------- */

    let nextQuery = "";

    // 第一轮若有现成关键词（决策器给的），直接用，省一次往返
    if (round === 1 && seedQueries.length > 0) {
      nextQuery = seedQueries[0].trim();
    }

    if (!nextQuery) {
      const decision = await askNextStep(question, queries, evidenceBlocks, signal);
      // 模型不可用 / 说够了 → 收尾
      if (!decision || decision.action === "answer") {
        return {
          ok: anyOk,
          results: merged,
          context: merged.length > 0 ? formatSearchContext(queries[0] ?? question, merged) : "",
          queries,
          steps,
          rounds: steps.length,
          finished: anyOk ? "answer" : "failed",
          error: anyOk ? undefined : "搜索失败",
          via,
          attempts,
        };
      }
      nextQuery = decision.query;
    }

    // 重复词说明模型卡住了，别再浪费一轮
    if (queries.some((q) => q === nextQuery)) {
      break;
    }

    /* ---------- 执行搜索 ---------- */

    const outcome = await webSearch(nextQuery, limit, []);
    queries.push(nextQuery);

    if (outcome.attempts?.length) attempts.push(...outcome.attempts);
    if (outcome.ok) {
      anyOk = true;
      via = outcome.via ?? via;
      absorb(outcome.results);
      steps.push({
        round,
        query: nextQuery,
        hits: outcome.results.length,
        via: outcome.via,
      });
      evidenceBlocks.push(`第 ${round} 轮搜「${nextQuery}」的结果：\n${buildEvidence(outcome.results)}`);
    } else {
      steps.push({ round, query: nextQuery, hits: 0 });
      evidenceBlocks.push(`第 ${round} 轮搜「${nextQuery}」：没有搜到结果。`);
    }

    if (signal?.aborted) break;
  }

  return {
    ok: anyOk,
    results: merged,
    context: merged.length > 0 ? formatSearchContext(queries[0] ?? question, merged) : "",
    queries,
    steps,
    rounds: steps.length,
    finished: "exhausted",
    error: anyOk ? undefined : "搜索失败",
    via,
    attempts,
  };
}
