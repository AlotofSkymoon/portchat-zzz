/**
 * 联网搜索（服务端）—— 多源架构。
 *
 * ============ 重要背景：沙盒测试结论不可靠 ============
 *
 * 开发用的沙盒有**出网白名单**：example.com、registry.npmjs.org 这类
 * 绝无反爬的站点都会返回 403，响应体是
 *   {"detail":"No policy rule matched the request","policy_name":"main-policy"}
 * 所以"在沙盒里测出某引擎 403"**不代表生产环境不可用**。
 *
 * 早前据此判定 DuckDuckGo / SearXNG 不可用，是误判。
 * 现在的策略是：多源自动回退，运行时谁通谁上，不写死单一结论。
 *
 * ============ 两类搜索源 ============
 *
 * A. 无需 Key（默认，零配置可用）
 *    - Bing RSS   官方 RSS 输出，结构化，已实测可用
 *    - Sogou      中文结果质量好，已实测可用（无摘要、链接需解析）
 *    - DuckDuckGo 备用（沙盒测不了，生产环境可能可用）
 *
 * B. 需 Key（配了就优先用，稳定性远高于爬 HTML）
 *    - Tavily   专为 LLM 设计，直接返回可注入上下文的答案片段
 *    - Brave    独立索引，不依赖 Google/Bing
 *    - Serper   走 Google 索引
 *    - Exa      神经/语义搜索
 *    - 博查     国内可用，中文友好
 *
 * 有 Key 时优先用 B —— 爬虫源随时可能因反爬失效，而 API 有 SLA。
 */

import { buildQueryCandidates, filterRelevant } from "@/lib/search-query";
import { timeoutSignal } from "@/lib/fetch-timeout";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** 搜索源标识 */
export type SearchProvider =
  | "tavily"
  | "brave"
  | "serper"
  | "exa"
  | "bocha"
  | "bing"
  | "sogou"
  | "duckduckgo";

/** 搜索结果上限放宽：靠压缩显示而非砍条数 */
export const MAX_SEARCH_RESULTS = 100;

/** 单次请求超时（毫秒） */
const TIMEOUT = 12_000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/* ------------------------------ 工具函数 ------------------------------ */

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function stripTags(s: string): string {
  return decodeEntities(s)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1] : null;
}

function isHttpUrl(s: string): string | null {
  const t = s.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, {
    ...init,
    redirect: "follow",
    signal: timeoutSignal(TIMEOUT),
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ========================================================================
   A 类：无需 Key
   ======================================================================== */

/* ------------------------------ Bing RSS ------------------------------ */

function parseBingRss(xml: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  for (const item of xml.split(/<item>/i).slice(1)) {
    if (out.length >= limit) break;
    const title = stripTags(unwrapCdata(pick(item, "title") ?? ""));
    const url = isHttpUrl(stripTags(unwrapCdata(pick(item, "link") ?? "")));
    if (!title || !url) continue;
    if (out.some((r) => r.url === url)) continue;
    out.push({ title, url, snippet: stripTags(unwrapCdata(pick(item, "description") ?? "")) });
  }
  return out;
}

async function searchBing(query: string, limit: number): Promise<SearchResult[]> {
  const xml = await fetchText(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=${limit}`,
    { headers: { Accept: "application/rss+xml, application/xml, text/xml" } },
  );
  return parseBingRss(xml, limit);
}

/* ------------------------------- Sogou ------------------------------- */

/**
 * 搜狗。中文结果质量很好（实测标题准确），但有三个坑：
 *   1. 链接是 /link?url=xxx 跳转形式，不是真实地址
 *   2. 抓不到摘要
 *   3. 显示的"来源"常是中文站名（如"博客园"）而非域名
 *
 * 所以取链接的优先级是：
 *   真实 URL > 显示域名 > 搜狗跳转地址（兜底）
 * 跳转地址虽不是最终地址，但用户点击能到达，比丢弃整个结果强。
 */
function parseSogou(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  const blocks = html.split(/<div[^>]+class="vrwrap"/i).slice(1);

  for (const b of blocks) {
    if (out.length >= limit) break;

    const titleM = b.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (!titleM) continue;
    const title = stripTags(titleM[1]);
    if (!title) continue;

    // 显示来源：可能是完整 URL、纯域名、或中文站名
    const citeM = b.match(/class="citeLinkClass"[^>]*>([\s\S]*?)</i);
    const cite = citeM ? stripTags(citeM[1]) : "";

    let url: string | null =
      cite.match(/https?:\/\/[^\s"'<>]+/i)?.[0] ??
      (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(cite) ? `https://${cite}` : null);

    // 兜底：搜狗的跳转链接（点击可到达真实页面）
    if (!url) {
      const jumpM = b.match(/href="(\/link\?url=[^"]+)"/i);
      if (jumpM) url = `https://www.sogou.com${decodeEntities(jumpM[1])}`;
    }

    if (!url) continue;
    if (out.some((r) => r.url === url)) continue;

    // 摘要抓不到就留空，让模型只看到标题+来源
    out.push({ title, url, snippet: "" });
  }

  return out;
}

async function searchSogou(query: string, limit: number): Promise<SearchResult[]> {
  const html = await fetchText(
    `https://www.sogou.com/web?query=${encodeURIComponent(query)}`,
    { headers: { Accept: "text/html" } },
  );
  return parseSogou(html, limit);
}

/* ---------------------------- DuckDuckGo ---------------------------- */

function unwrapDuckUrl(href: string): string {
  try {
    const u = new URL(href.startsWith("//") ? `https:${href}` : href);
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}

function parseDuckDuckGo(html: string, limit: number): SearchResult[] {
  const out: SearchResult[] = [];
  for (const b of html.split(/<div[^>]+class="[^"]*result[^"]*"[^>]*>/i).slice(1)) {
    if (out.length >= limit) break;
    const m = b.match(
      /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!m) continue;
    const url = isHttpUrl(unwrapDuckUrl(m[1]));
    const title = stripTags(m[2]);
    if (!title || !url) continue;
    if (out.some((r) => r.url === url)) continue;
    const sn =
      b.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ??
      b.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    out.push({ title, url, snippet: sn ? stripTags(sn[1]) : "" });
  }
  return out;
}

async function searchDuck(query: string, limit: number): Promise<SearchResult[]> {
  const html = await fetchText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: { Accept: "text/html" } },
  );
  return parseDuckDuckGo(html, limit);
}

/* ========================================================================
   B 类：需 Key —— 配了就优先用
   ======================================================================== */

type KeyedRunner = (query: string, limit: number, key: string) => Promise<SearchResult[]>;

/* -------------------------------- Tavily -------------------------------- */

/**
 * Tavily：专为 LLM 设计，返回的 answer 字段是已经提炼好的答案片段。
 * 免费额度 1000 次/月。https://tavily.com
 */
const runTavily: KeyedRunner = async (query, limit, key) => {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: Math.min(limit, 50),
      search_depth: "basic",
    }),
    signal: timeoutSignal(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const d = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (d.results ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "" }))
    .filter((r) => r.url && r.title);
};

/* -------------------------------- Brave -------------------------------- */

/** Brave Search：独立索引，免费 2000 次/月。https://brave.com/search/api */
const runBrave: KeyedRunner = async (query, limit, key) => {
  const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}`;
  const res = await fetch(u, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: timeoutSignal(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const d = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return (d.web?.results ?? [])
    .map((r) => ({ title: stripTags(r.title ?? ""), url: r.url ?? "", snippet: stripTags(r.description ?? "") }))
    .filter((r) => r.url && r.title);
};

/* -------------------------------- Serper -------------------------------- */

/** Serper：走 Google 索引，免费 2500 次。https://serper.dev */
const runSerper: KeyedRunner = async (query, limit, key) => {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": key },
    body: JSON.stringify({ q: query, num: Math.min(limit, 20) }),
    signal: timeoutSignal(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const d = (await res.json()) as {
    organic?: { title?: string; link?: string; snippet?: string }[];
  };
  return (d.organic ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.link ?? "", snippet: r.snippet ?? "" }))
    .filter((r) => r.url && r.title);
};

/* --------------------------------- Exa --------------------------------- */

/** Exa：语义/神经搜索。https://exa.ai */
const runExa: KeyedRunner = async (query, limit, key) => {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      numResults: Math.min(limit, 20),
      contents: { text: { maxCharacters: 400 } },
    }),
    signal: timeoutSignal(TIMEOUT),
  });
  if (!res.ok) throw new Error(`Exa HTTP ${res.status}`);
  const d = (await res.json()) as {
    results?: { title?: string; url?: string; text?: string }[];
  };
  return (d.results ?? [])
    .map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.text ?? "" }))
    .filter((r) => r.url && r.title);
};

/* -------------------------------- 博查 -------------------------------- */

/** 博查 AI：国内可用，中文友好。https://open.bochaai.com */
const runBocha: KeyedRunner = async (query, limit, key) => {
  const res = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, count: Math.min(limit, 20), summary: true }),
    signal: timeoutSignal(TIMEOUT),
  });
  if (!res.ok) throw new Error(`博查 HTTP ${res.status}`);
  const d = (await res.json()) as {
    data?: { webPages?: { value?: { name?: string; url?: string; summary?: string }[] } };
  };
  return (d.data?.webPages?.value ?? [])
    .map((r) => ({ title: r.name ?? "", url: r.url ?? "", snippet: r.summary ?? "" }))
    .filter((r) => r.url && r.title);
};

/* --------------------------- Key 源注册表 --------------------------- */

/**
 * 按顺序尝试：第一个配了 Key 的就作为首选。
 *
 * Serper 排第一是因为**注册不需要信用卡**，门槛最低：
 * 免费额度 2500 次，用 Google 的索引，结果质量稳定。
 * 其余源各有优势，配了多个时按下面的顺序取第一个可用的。
 */
const KEYED_SOURCES: { id: SearchProvider; env: string; run: KeyedRunner; label: string }[] = [
  { id: "serper", env: "SERPER_API_KEY", run: runSerper, label: "Serper" },
  { id: "tavily", env: "TAVILY_API_KEY", run: runTavily, label: "Tavily" },
  { id: "brave", env: "BRAVE_API_KEY", run: runBrave, label: "Brave Search" },
  { id: "bocha", env: "BOCHA_API_KEY", run: runBocha, label: "博查 AI" },
  { id: "exa", env: "EXA_API_KEY", run: runExa, label: "Exa" },
];

/** 当前配置了哪些 Key 源（供 /health 展示，不含密钥本身） */
export function configuredKeyedSources(): SearchProvider[] {
  return KEYED_SOURCES.filter((s) => (process.env[s.env] ?? "").trim()).map((s) => s.id);
}

/* ========================================================================
   调度
   ======================================================================== */

export interface SearchOutcome {
  ok: boolean;
  results: SearchResult[];
  error?: string;
  /** 实际命中的源 */
  via?: SearchProvider;
  /** 每个源的尝试情况，便于排查 */
  attempts?: string[];
}

/**
 * 执行搜索。
 *
 * 流程：
 *   1. 把整句提问压缩成关键词（否则引擎会被高频字带偏）
 *   2. 若配了 Key 源 → 优先用（稳定、结构化）
 *   3. 否则依次尝试 Bing → Sogou → DuckDuckGo
 *   4. 结果做相关性过滤，不相关的丢弃
 *   5. 全部失败返回 ok=false，由调用方决定如何提示
 *
 * @param rawQuery 原始提问（用于兜底提取关键词）
 * @param limit 结果条数上限
 * @param plannedQueries 决策器给出的关键词，优先级最高。
 *   这些是模型读懂用户意图后提炼的（比如把「它多少钱」还原成具体产品名），
 *   比本地从整句里硬截的词准得多，所以排在本地候选前面。
 */
export async function webSearch(
  rawQuery: string,
  limit = 30,
  plannedQueries: string[] = [],
): Promise<SearchOutcome> {
  const raw = rawQuery.trim();
  if (!raw) return { ok: false, results: [], error: "搜索词为空" };
  if (raw.length > 500) return { ok: false, results: [], error: "搜索词过长" };

  const candidates = Array.from(
    new Set(
      [
        ...plannedQueries.map((q) => q.trim()).filter((q) => q && q.length <= 200),
        ...buildQueryCandidates(raw),
      ].filter(Boolean),
    ),
  ).slice(0, 5);

  if (candidates.length === 0) {
    return { ok: false, results: [], error: "无法从提问中提取搜索词" };
  }

  const attempts: string[] = [];

  /** 按候选词依次尝试某个源 */
  const trySource = async (
    id: SearchProvider,
    run: (q: string, l: number) => Promise<SearchResult[]>,
  ): Promise<SearchResult[] | null> => {
    for (const q of candidates) {
      try {
        const rs = await run(q, limit);
        if (rs.length === 0) {
          attempts.push(`${id}/${q}：无结果`);
          continue;
        }
        const relevant = filterRelevant(rs, q);
        if (relevant.length > 0) return relevant.slice(0, limit);
        attempts.push(`${id}/${q}：${rs.length} 条均不相关`);
      } catch (err) {
        attempts.push(`${id}/${q}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return null;
  };

  // 1) Key 源优先
  for (const s of KEYED_SOURCES) {
    const key = (process.env[s.env] ?? "").trim();
    if (!key) continue;
    const got = await trySource(s.id, (q, l) => s.run(q, l, key));
    if (got) return { ok: true, results: got, via: s.id, attempts };
  }

  // 2) 无需 Key 的源，依次回退
  for (const [id, run] of [
    ["bing", searchBing],
    ["sogou", searchSogou],
    ["duckduckgo", searchDuck],
  ] as const) {
    const got = await trySource(id, run);
    if (got) return { ok: true, results: got, via: id, attempts };
  }

  return {
    ok: false,
    results: [],
    error: `未搜到相关内容（${attempts.slice(0, 3).join("；")}）`,
    attempts,
  };
}

/* ------------------------------ 上下文构造 ------------------------------ */

/** 摘要压缩上限：条数越多，单条越短 */
function snippetLimit(total: number): number {
  if (total <= 8) return 260;
  if (total <= 20) return 140;
  if (total <= 40) return 90;
  return 60;
}

function compress(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max) + "…";
}

/**
 * 喂给模型的证据上限。
 *
 * 以前是把搜到的 30 条全塞进去，模型被这坨东西淹没，最常见的反应就是
 * **把检索结果原样复读一遍**——用户看到的回答就是一串带 URL 的编号列表，
 * 而不是答案。条数压到 10 条以内，模型才会真的去"读"而不是"抄"。
 *
 * 其余命中条目仍然会通过 results 回传给前端，在回答下方以来源卡片展示，
 * 用户照样点得到，只是不再占模型的上下文。
 */
const EVIDENCE_CAP = 10;

export function formatSearchContext(query: string, results: SearchResult[]): string {
  // 只取前 10 条喂模型；URL 不进去（模型用不上，还会诱导它照抄）
  const evidence = results.slice(0, EVIDENCE_CAP);
  const cap = snippetLimit(evidence.length);
  const lines = evidence.map(
    (r, i) => `[${i + 1}] ${r.title}：${compress(r.snippet || "（无摘要）", cap)}`,
  );

  return [
    `【联网检索到的资料，共 ${results.length} 条，以下是最相关的 ${evidence.length} 条】`,
    ...lines,
    "",
    "【怎么用这些资料】",
    "- 把它当作你已经查过的背景知识，直接回答用户的问题。",
    "- 提到具体事实、数字、时间时在句末标注来源编号，例如：……[3]。",
    "- 禁止复述或罗列检索结果本身，禁止输出网址，禁止用编号列表当答案。",
    "- 资料里没有的就直说没有，不要编。",
  ].join("\n");
}
