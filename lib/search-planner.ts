/**
 * 搜索决策 —— 决定「这条消息到底要不要联网搜」。
 *
 * ============ 为什么要这个 ============
 *
 * 原来的逻辑是：只要开了「联网」开关，每一条消息都无脑搜一次。
 * 结果就是问「你好」「把这段改成 async」也要等一轮搜索往返，
 * 慢、费额度，还经常搜回一堆跟问题无关的东西塞进上下文把答案带偏。
 *
 * 用户开了联网，意思是「**需要的时候**帮我查」，不是「每句都查」。
 *
 * ============ 三层决策，越便宜越靠前 ============
 *
 *  1. 规则层（零成本、零延迟）
 *     - 显式指令（"搜一下…"）→ 必搜
 *     - 强时效信号（今天/最新/股价/天气…）→ 必搜
 *     - 纯礼貌用语、对上文的改写/翻译/续写 → 必不搜
 *
 *  2. 模型层（只在规则拿不准时）
 *     一次极短调用，让模型读懂用户到底想要什么，顺便产出搜索关键词。
 *     这一步才是「理解用户意思」—— 比如「它多少钱」里的「它」
 *     必须结合上文才知道指的是什么。
 *
 *  3. 兜底
 *     模型不可用/超时/输出解析不了 → 退回原来的「搜」，
 *     保证联网能力不会因为决策器抽风而整个消失。
 */

import { configValue } from "./runtime-config";
import { resolveTarget } from "./config";
import { buildQueryCandidates } from "./search-query";

export interface SearchPlan {
  /** 是否要搜 */
  need: boolean;
  /** 搜索词（按优先级排序，可能为空） */
  queries: string[];
  /** 决策来源，便于排查「为什么没搜 / 为什么搜了」 */
  via: "rule-force" | "rule-skip" | "model" | "fallback";
  /** 人类可读的原因 */
  reason: string;
}

/* ========================================================================
   第 1 层：本地规则
   ======================================================================== */

/**
 * 用户明确要求搜：无论如何都搜。
 *
 * ⚠️ 收紧的两处（都是实测会误伤的）：
 *  - 不要单字「查」「找」："查询数据库为什么慢" 是纯技术问题，
 *    被判成必搜就正好是用户想避免的「每句都搜」。
 *  - 不要「查询」：同理，"这个查询怎么优化" 不该搜。
 * 必须是「搜一下 / 查一下 / 帮我找 / 查资料」这类完整的指令式表达。
 */
const FORCE_SEARCH_RE =
  /(搜(一)?(下|索)|查(一)?下|查查|查资料|上网查|帮我(搜|查|找)|找(一)?下资料|search\s+(for|the)|look\s+it\s+up|google\s+it)/i;

/**
 * 强时效 / 强事实信号。
 *
 * 命中就搜，不再问模型 —— 省一次调用，而且这类问题
 * 模型几乎一定会判「需要」，问了也是浪费。
 *
 * ⚠️ 刻意不含「今天几号 / 星期几」：这类问题靠系统给的当前日期就能答，
 *    搜了反而搜不到有用的（还会拖慢）。让它们落到模型层去判。
 */
const TIME_SENSITIVE_RE =
  /(今天|明天|昨天|现在|刚刚|最新|最近|今年|本月|这周|本周|目前|当下|多少钱|什么价|价格|涨价|降价|股价|汇率|天气|比分|排名|新闻|上映|开售|截止|还剩几天|有多大|有多少人)/;

const TIME_SENSITIVE_EN_RE =
  /\b(latest|newest|current(ly)?|right\s+now|today|tonight|this\s+week|this\s+month|this\s+year|how\s+much|stock\s+price|exchange\s+rate|weather|forecast|score|standings|rank(ing)?|news|headline|release[d]?|launch(ed)?|deadline)\b/i;

/** 明确指向外部资源，光靠模型记忆答不了 */
const NEEDS_FETCH_RE = /(官网|官方网站|这个网站|这个页面|官方网站上)/;

/**
 * 明确不需要搜：对已有内容的加工，或纯客套。
 *
 * ⚠️ 这里必须**极度保守**。宁可多问一次模型，也不要把
 * 「用最新的 React 写法改一下」误判成不用搜。
 * 所以下面只收**不含任何实体词**的纯指令，且要求匹配到句尾或标点。
 */
const SKIP_PATTERNS: RegExp[] = [
  // 客套（整句就是问候/感谢/道别）
  /^(hi|hello|hey|yo|thanks?|thank\s+you|thx|ok|okay|你好|您好|嗨|哈啰|哈喽|谢谢|多谢|感谢|再见|拜拜|早安|午安|晚安|辛苦了)[\s!,.~、。，！？?！…]*$/i,
  // 对上文的加工（整句就是一条指令，不带新实体）
  /^(继续|接着说|继续说|再说一点|再说点|再详细|详细一点|详细点|简单一点|简单点|简短一点|简短点|换个说法|换种说法|重写一下|重写|改写一下|改写|润色一下|润色|精简一下|精简|扩写一下|扩写|总结一下|总结|概括一下|概括)[\s。.,!！?？]*$/,
  // 换语言重说 / 翻译（必须出现语言名，否则"用户画像"这种也会被误伤）
  /^(用(英文|英语|中文|日文|日语|韩文|法文|法语|德文|西班牙文|粤语|广东话|白话|文言文)|翻译(成|为)?(英文|英语|中文|日文|日语|法文|法语)?|用(英文|中文|日文|法文)(说|讲|回答|回复|重写))/,
];

/** 纯数学/代码运算，不需要搜 */
function isPureCalculation(s: string): boolean {
  const t = s.trim();
  if (t.length > 60) return false;
  return (
    /[+\-*/^%=]/.test(t) &&
    /^[\d\s+\-*/^%=().a-zA-Z一-龥]{0,60}$/.test(t) &&
    /\d/.test(t) &&
    !/[一-龥]{3,}/.test(t)
  );
}

/** 取出纯文本（多模态消息只取文字部分） */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .map((c) => (c?.type === "text" ? c.text ?? "" : ""))
      .join(" ");
  }
  return "";
}

/* ========================================================================
   第 2 层：模型判断
   ======================================================================== */

const DECIDE_SYSTEM = [
  "你是一个搜索决策器。判断用户这条消息是否需要联网搜索才能回答好。",
  "",
  "需要搜索：",
  "- 涉及会变的信息：新闻、股价、汇率、天气、比分、价格、政策、最新版本",
  "- 你知识截止之后的事",
  "- 需要具体事实但你不确定：某个小众工具的用法、某个网站的内容、某人的原话",
  "- 用户问的是「现在」怎样，而不是「一般」怎样",
  "",
  "不需要搜索：",
  "- 通用知识、概念解释、编程语法、数学题、创作写作",
  "- 对上文内容的改写、翻译、续写、总结",
  "- 闲聊、问候、观点讨论",
  "- 用户自己已经提供了材料让你处理（代码、文本、图片）",
  "- 问日期、星期、时间——用下面给的当前日期直接答即可",
  "",
  "只输出 JSON，不要任何其他文字：",
  '{"need": true, "queries": ["关键词1"]}',
  "或",
  '{"need": false, "queries": []}',
  "",
  "queries 要求：",
  "- 搜索引擎友好的关键词，不是完整句子；去掉「请问」「帮我」这类客套",
  "- 最多 2 个；不确定时只给 1 个",
  "- 用户提到的专名、产品名、地名保留原样",
  "- 代码、长文本不要放进去",
].join("\n");

/** 决策调用超时：宁可超时走兜底，也不要让用户干等 */
const DECIDE_TIMEOUT = 8_000;

/**
 * 让模型判断要不要搜，并产出关键词。
 *
 * 用**服务端预设 Key**，跟起标题一样：
 * 判断要不要搜是站点自己的事，不该烧用户的额度。
 * 没有预设 Key 就返回 null，由调用方走兜底。
 */
async function askModel(
  context: string[],
  signal?: AbortSignal,
): Promise<{ need: boolean; queries: string[] } | null> {
  const presetKey = configValue("PRESET_AGNES_API_KEY")?.trim();
  if (!presetKey) return null;

  const model = process.env.UPSTREAM_MODEL?.trim() || "agnes-3.0-flash";
  const target = resolveTarget(model, []);
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECIDE_TIMEOUT);
  // 外部取消（用户点了停止）时一起带上
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

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
          { role: "system", content: DECIDE_SYSTEM },
          { role: "user", content: context.join("\n") },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[search-plan] 上游返回", res.status);
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    return parseDecision(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * 解析模型输出。
 *
 * 模型经常不老实：给 ```json 代码块、前后带解释、用单引号、
 * 甚至 need 写成字符串 "false"。这里全部兼容，实在解析不了返回 null。
 */
function parseDecision(raw: string): { need: boolean; queries: string[] } | null {
  const s = raw.trim();
  if (!s) return null;

  // 取第一个 {...} 块
  const m = s.match(/\{[\s\S]*?\}/);
  if (!m) {
    // 兜底：模型直接说 yes/no
    if (/^(yes|true|1|需要|搜)/i.test(s)) return { need: true, queries: [] };
    if (/^(no|false|0|不需要|不搜)/i.test(s)) return { need: false, queries: [] };
    return null;
  }

  let parsed: { need?: unknown; queries?: unknown };
  try {
    parsed = JSON.parse(m[0]) as typeof parsed;
  } catch {
    return null;
  }

  const need =
    parsed.need === true || parsed.need === "true" || parsed.need === 1 || parsed.need === "1";

  const queries = Array.isArray(parsed.queries)
    ? (parsed.queries as unknown[])
        .map((q) => (typeof q === "string" ? q.trim() : ""))
        .filter(Boolean)
        .slice(0, 2)
    : [];

  return { need, queries };
}

/* ========================================================================
   对外入口
   ======================================================================== */

export interface PlanInput {
  /** 最近几条消息（含上文，用于理解指代），最后一条是用户当前提问 */
  messages: { role: string; content: unknown }[];
  signal?: AbortSignal;
  /** 当前日期，模型判断"最新/最近"需要它 */
  now?: Date;
}

/**
 * 决定这次要不要搜、搜什么。
 *
 * 绝对不抛异常 —— 决策器出问题最多退化成「照常搜」，
 * 不能因为它把聊天搞挂。
 */
export async function planSearch(input: PlanInput): Promise<SearchPlan> {
  try {
    const msgs = input.messages ?? [];
    const last = [...msgs].reverse().find((m) => m.role === "user");
    const text = textOf(last?.content).trim();

    if (!text) {
      return { need: false, queries: [], via: "rule-skip", reason: "没有可搜索的文本" };
    }

    // 1) 显式指令 → 必搜
    if (FORCE_SEARCH_RE.test(text)) {
      return {
        need: true,
        queries: buildQueryCandidates(text).slice(0, 2),
        via: "rule-force",
        reason: "用户明确要求搜索",
      };
    }

    // 2) 强时效 / 需抓外部资源 → 必搜
    if (
      TIME_SENSITIVE_RE.test(text) ||
      TIME_SENSITIVE_EN_RE.test(text) ||
      NEEDS_FETCH_RE.test(text)
    ) {
      return {
        need: true,
        queries: buildQueryCandidates(text).slice(0, 2),
        via: "rule-force",
        reason: "命中时效/事实信号",
      };
    }

    // 3) 纯客套 / 对上文的加工 / 纯计算 → 不搜
    if (SKIP_PATTERNS.some((re) => re.test(text)) || isPureCalculation(text)) {
      return { need: false, queries: [], via: "rule-skip", reason: "纯客套或对上文的加工" };
    }

    // 4) 拿不准 → 问模型
    const now = input.now ?? new Date();
    const dateLine = `当前日期：${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // 只带最近 4 条足够理解指代，太长既费 token 又容易跑偏
    const recent = msgs.slice(-4).map((m) => {
      const body = textOf(m.content).trim().slice(0, 300);
      const who = m.role === "user" ? "用户" : "助手";
      return `${who}：${body}`;
    });

    const decided = await askModel(
      [dateLine, "", ...recent, "", "请判断上面最后一条用户消息。"],
      input.signal,
    );

    if (!decided) {
      // 模型不可用 → 退回原来的行为（照搜），保证联网能力不消失
      return {
        need: true,
        queries: buildQueryCandidates(text).slice(0, 2),
        via: "fallback",
        reason: "决策器不可用，退回照常搜索",
      };
    }

    if (!decided.need) {
      return { need: false, queries: [], via: "model", reason: "模型判定不需要搜索" };
    }

    // 模型说要搜，但没给关键词 → 用本地提取兜底
    const queries = decided.queries.length
      ? decided.queries
      : buildQueryCandidates(text).slice(0, 2);

    if (queries.length === 0) {
      return { need: false, queries: [], via: "model", reason: "无法提取搜索词" };
    }

    return { need: true, queries, via: "model", reason: "模型判定需要搜索" };
  } catch {
    // 决策器自身出错也不能把聊天搞挂
    return { need: true, queries: [], via: "fallback", reason: "决策器异常" };
  }
}
