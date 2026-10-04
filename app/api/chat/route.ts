import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  DEFAULT_MODEL,
  PROVIDERS,
  isAllowedModelWith,
  isBlockedBaseUrl,
  resolveTarget,
  sanitizeCustomProviders,
} from "@/lib/config";
import { detectPlatform } from "@/lib/platform";
import { getRedis, hasRedisConfig, KEYS } from "@/lib/redis";
import { REQUIRE_LOGIN } from "@/lib/site";
import { configValue } from "@/lib/runtime-config";
import { serverT as st } from "@/lib/i18n/server";
import {
  CREDITS_ADMIN_BYPASS,
  CREDITS_ANONYMOUS,
  CREDITS_ENABLED,
  LOW_CREDIT_MODEL,
  costOfModel,
  readCredits,
  spendCredits,
} from "@/lib/credits";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
/** Vercel 函数最长执行时间（Hobby 60s 上限，Pro 可到 300s） */
export const maxDuration = 60;

/** OpenAI 兼容的消息内容：纯文本 或 多模态片段数组 */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

interface ChatRequestBody {
  messages?: {
    role: "user" | "assistant" | "system";
    content: string | ContentPart[];
  }[];
  model?: string;
  /** 用户自己的 Key（来自 localStorage，可选） */
  apiKey?: string;
  /** 各服务商的 Key：{ agnes?: string; deepseek?: string; inkstone?: string; "custom:x"?: string } */
  keys?: Record<string, string>;
  /**
   * 各服务商「独立」的 Base URL 覆盖值。
   * ⚠️ 必须是按供应商分开的字典，不能是单个字符串 ——
   *    否则改 DeepSeek 的地址会连带把 Agnes 也指过去。
   */
  baseUrls?: Record<string, string>;
  /** 用户自建的 OpenAI 兼容供应商 */
  customProviders?: unknown;
  /** 思考模式：让模型先输出推理过程，再给答案 */
  thinking?: boolean;
  /**
   * 思考强度：low / medium / high。
   *
   * 走 OpenAI 标准字段 `reasoning_effort` 透传给上游。
   * 支持强度调节的模型（DeepSeek R1 系、GLM 5.3 等）会真的变深/变浅；
   * 不支持的（Agnes 是 llama.cpp 服务端，只有布尔开关）会忽略这个字段，
   * 退回由 enable_thinking 决定开不开 —— 不会报错。
   */
  effort?: "low" | "medium" | "high";
  /** 云端保存开关打开时才传 */
  conversationId?: string;
  saveToCloud?: boolean;
  /**
   * 会话标题（云端保存时用）。
   * 之前云端只存消息不存标题，拉回本地时只能显示「新对话」。
   */
  conversationTitle?: string;
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * 「纯打招呼」判断：整轮对话只有一条用户消息，且内容就是一句问候。
 *
 * 只有这种情况才让 Coffing 念开场白。否则（比如用户问「Logo 是什么」）
 * 硬塞自我介绍会把答案搅乱 —— 实测出现过把开场白插进 Logo 说明中间、
 * 还把名字写成 "Coffin" 的情况。
 */
const GREETING_RE =
  /^(hi|hello|hey|yo|hola|bonjour|salut|cou?cou|nihao|ni\s?hao|\u4f60\u597d|\u60a8\u597d|\u55e8|\u54c8\u55e8|\u54c8\u5570|\u5728\u5417|\u5728\u4e48|\u65e9\u4e0a\u597d|\u4e0b\u5348\u597d|\u665a\u4e0a\u597d|who\s+are\s+you)[\s!\u3001,.\uff0c\u3002~\uff01\uff1f?.]*$/i;

function isGreetingOnly(
  messages: { role: string; content: string | ContentPart[] }[],
): boolean {
  const users = messages.filter((m) => m.role === "user");
  if (users.length !== 1) return false;
  const c = users[0].content;
  const text = (typeof c === "string"
    ? c
    : c
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
  )
    .trim()
    .toLowerCase();
  // 带附件的、长句的都不算打招呼
  return text.length > 0 && text.length <= 24 && GREETING_RE.test(text);
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return errorResponse(400, "BAD_REQUEST", st(request, "err.badRequest"));
  }

  const {
    messages,
    model = DEFAULT_MODEL,
    apiKey,
    keys,
    baseUrls,
    customProviders,
    conversationId,
    saveToCloud,
    conversationTitle,
    thinking,
    effort,
  } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse(400, "BAD_REQUEST", st(request, "err.emptyMessage"));
  }

  /**
   * 强制登录校验（服务端防线）。
   *
   * 站长设了 NEXT_PUBLIC_REQUIRE_LOGIN=true 时，没登录一律拒绝。
   * 前端也会拦一道，但那只是体验；绕过前端直接打接口的人在这里被挡住。
   */
  if (REQUIRE_LOGIN) {
    const u = await getCurrentUser();
    if (!u) {
      return NextResponse.json(
        {
          error: st(request, "err.loginRequired"),
          code: "LOGIN_REQUIRED",
        },
        { status: 401 },
      );
    }
  }
  const custom = sanitizeCustomProviders(customProviders);

  if (!isAllowedModelWith(model, custom)) {
    return errorResponse(400, "BAD_MODEL", st(request, "err.badModel"));
  }

  /**
   * 单条消息体积保护。
   *
   * 阈值按平台定：Vercel Serverless 请求体硬上限 4.5MB，
   * Cloudflare Workers 宽松得多（100MB），可以放开。
   * 图片在前端已自动压缩，正常不会触发；触发时给出可操作的指引。
   */
  const MAX_MESSAGE_CHARS = detectPlatform() === "vercel" ? 3_500_000 : 20_000_000;

  // 逐条检查，顺便判断是不是图片引起的，好给针对性提示
  let oversizeIsImage = false;
  for (const m of messages) {
    const size = JSON.stringify(m.content).length;
    if (size <= MAX_MESSAGE_CHARS) continue;

    const hasImage =
      Array.isArray(m.content) &&
      m.content.some((c) => (c as { type?: string }).type === "image_url");
    if (hasImage) oversizeIsImage = true;

    return errorResponse(
      413,
      "TOO_LARGE",
      oversizeIsImage
        ? st(request, "err.imageTooLarge")
        : st(request, "err.messageTooLarge"),
    );
  }

  // 解析：这个模型属于哪个供应商、该打哪个地址
  const target = resolveTarget(model, custom, baseUrls);
  if (!target) {
    return errorResponse(400, "BAD_MODEL", st(request, "err.noProvider"));
  }

  // Key 严格按供应商取，绝不串台
  // - agnes：用户 Key 优先，回落服务端预设
  // - deepseek / 自定义：必须用用户自己的 Key
  let finalKey = "";
  /** 用户是否填了自己的 Key（用于判断这次请求花的是谁的钱） */
  let finalKeyOwnerSupplied = false;
  if (target.providerId === "agnes") {
    const presetKey = configValue("PRESET_AGNES_API_KEY");
    const own = (keys?.agnes ?? apiKey ?? "").trim();
    finalKeyOwnerSupplied = own.length > 0;
    finalKey = own || presetKey;
  } else {
    finalKey = (keys?.[target.providerId] ?? "").trim();
  }

  if (!finalKey) {
    return errorResponse(
      401,
      "NO_API_KEY",
      target.providerId === "agnes"
        ? st(request, "err.noAgnesKey")
        : st(request, "err.providerKeyRequired", { name: target.label }),
    );
  }

  /* ------------------------------ 积分闸门 ------------------------------ */
  /**
   * 按模型计费，每次对话前扣。
   *
   * 规则对所有人一致（不区分是否自带 Key）：统一计价才好解释，
   * 否则用户会问"我明明填了自己的 Key 为什么还扣分"。
   */
  const chatUser = CREDITS_ENABLED ? await getCurrentUser() : null;

  if (CREDITS_ENABLED) {
    if (!chatUser && CREDITS_ANONYMOUS === "block") {
      return NextResponse.json(
        { error: st(request, "err.loginRequired"), code: "LOGIN_REQUIRED" },
        { status: 401 },
      );
    }

    // 会员制：先判封禁，再判档位是否覆盖当前模型
    let memberCover = false;
    if (chatUser) {
      const { getMembership, tierAllowsModel } = await import("@/lib/membership");
      // 用原始记录而不是 getActiveMembership：
      // 后者在被封禁 / 已过期时都返回 null，封禁就永远查不出来。
      const ms = await getMembership(chatUser.id);

      if (ms?.banned) {
        return NextResponse.json(
          { error: st(request, "membership.banned"), code: "BANNED" },
          { status: 403 },
        );
      }

      const active =
        !!ms && !ms.banned && (ms.expiresAt === null || ms.expiresAt > Date.now());

      if (active && ms) {
        if (tierAllowsModel(ms.tier, model, target.providerId)) {
          // 档位覆盖该模型：免积分、不受降级限制
          memberCover = true;
        } else {
          return NextResponse.json(
            {
              error: st(request, "membership.tierNotAllowed"),
              code: "TIER_NOT_ALLOWED",
              tier: ms.tier,
            },
            { status: 403 },
          );
        }
      }
    }

    // 管理员免积分：站长就是额度的提供者，不该被自己定的规则挡住
    const creditsUser =
      chatUser && !(memberCover || (CREDITS_ADMIN_BYPASS && chatUser.role === "admin"))
        ? chatUser
        : null;

    if (creditsUser) {
      const cost = costOfModel(model, target.providerId);
      const acc = await readCredits(creditsUser.id);

      if (acc.available < cost) {
        /**
         * 余额不足时的降级：
         *   · 书生 / 第三方（10 分档）直接拒绝 —— 成本太高，不能白送
         *   · Agnes Low 作为保底档位始终放行（哪怕余额 0），
         *     否则新用户注册完一分没有就完全用不了，等于劝退
         */
        const canFallback = target.providerId === "agnes" && acc.available >= Math.min(cost, 1);
        if (!canFallback) {
          return NextResponse.json(
            {
              error: st(request, "credits.insufficient"),
              code: "INSUFFICIENT_CREDITS",
              cost,
              available: acc.available,
              fallbackModel: LOW_CREDIT_MODEL,
            },
            { status: 402 },
          );
        }
      }

      const spent = await spendCredits(creditsUser.id, cost);
      if (!spent) {
        return NextResponse.json(
          {
            error: st(request, "credits.insufficient"),
            code: "INSUFFICIENT_CREDITS",
            cost,
            available: acc.available,
            fallbackModel: LOW_CREDIT_MODEL,
          },
          { status: 402 },
        );
      }
    }
  }

  // 不支持识图的模型：把图片片段降级为占位文字，避免上游报错
  const visionOk = target.vision;
  let outbound = messages;
  if (!visionOk) {
    outbound = messages.map((m) => {
      if (typeof m.content === "string") return m;
      const textParts = m.content.filter((c) => c.type === "text");
      const imgs = m.content.filter((c) => c.type === "image_url");
      const text =
        textParts.map((c) => (c as { type: "text"; text: string }).text).join("\n") +
        (imgs.length ? "\n" + st(request, "err.imagesDropped", { n: imgs.length }) : "");
      return { ...m, content: text };
    });
  }

  const targetBase = target.baseUrl;

  /**
   * 把图片 URL 补全成绝对地址。
   *
   * 前端可能送来相对路径（例如早期版本 binding 直传返回的 `/api/r2/xxx`）。
   * 上游模型服务器不知道本站域名，相对路径它根本没法取，
   * 结果就是"图发出去了但 AI 看不见"。
   *
   * 在服务端兜底最可靠 —— 因为只有这里知道自己的 origin。
   */
  if (visionOk) {
    const origin = new URL(request.url).origin;
    outbound = outbound.map((m) => {
      if (typeof m.content === "string") return m;
      return {
        ...m,
        content: m.content.map((c) => {
          if (c.type !== "image_url") return c;
          const url = (c as { image_url: { url: string } }).image_url.url;
          if (!url || /^https?:\/\//i.test(url) || url.startsWith("data:")) return c;
          // 相对路径 → 拼上本站 origin
          return { ...c, image_url: { ...(c as { image_url: object }).image_url, url: `${origin}${url.startsWith("/") ? "" : "/"}${url}` } };
        }),
      };
    });
  }

  // SSRF 防护：内置地址一定安全，只校验用户可能改写的部分
  if (target.isCustom && isBlockedBaseUrl(targetBase)) {
    return errorResponse(400, "BLOCKED_URL", st(request, "err.blockedUrl"));
  }

  /**
   * 品牌人格：Coffing。
   *
   * 放在服务端注入而不是前端拼 —— 前端拼的话，绕过页面直接打接口
   * （或老版本客户端）就没有人格了，而且 prompt 会被存进会话记录里。
   *
   * ⚠️ 只在**发给上游时**加，不写进云端会话：
   * 否则每次刷新历史都会多出一条 system 消息。
   */
  const persona = isGreetingOnly(messages)
    ? st(request, "chat.coffingPersona")
    : st(request, "chat.coffingBase");
  const outboundWithPersona = [
    { role: "system" as const, content: persona },
    ...outbound,
  ];

  const upstreamUrl = `${targetBase}/chat/completions`;

  /**
   * 思考模式是否真的开启。
   * 只有「用户开了 + 目标供应商支持」才发，避免给不支持的服务带多余字段。
   */
  const thinkingOn = thinking === true && target.thinking;

  const buildUpstreamRequest = (): RequestInit => ({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${finalKey}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages: outboundWithPersona.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      /**
       * Agnes 的扩展字段：开启后在 delta 里额外回传 reasoning_content。
       * 这是 OpenAI 生态里表示「思考内容」的事实标准字段
       * （DeepSeek R1 也用它），所以前端按同一字段解析即可。
       */
      ...(thinkingOn ? { chat_template_kwargs: { enable_thinking: true } } : {}),
      /**
       * 思考强度：OpenAI 标准字段。
       *
       * 只在真的开了思考时才发 —— 没开思考却带强度字段，
       * 部分上游会直接 400。
       *
       * Agnes（llama.cpp 服务端）不认这个字段，会忽略，
       * 强度对它就只是 UI 上的选择而不生效 —— 可接受，
       * 总比给不支持的服务带字段导致报错好。
       */
      ...(thinkingOn && effort ? { reasoning_effort: effort } : {}),
    }),
    signal: request.signal,
  });

  /** 读取上游建议的等待秒数，没有就给个保守值 */
  function retryAfterSeconds(res: Response): number {
    const raw = res.headers.get("retry-after");
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return Math.min(10, Math.ceil(n));
    }
    return 2;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, buildUpstreamRequest());

    // 瞬时 429 自动重试一次：免费额度常按「每分钟 N 次」计，
    // 这一秒超了、下一秒往往就空出来了，重试能救回大部分情况。
    if (upstream.status === 429) {
      const wait = retryAfterSeconds(upstream);
      await upstream.body?.cancel().catch(() => {});
      await sleep(wait * 1000);
      upstream = await fetch(upstreamUrl, buildUpstreamRequest());
    }
  } catch {
    return errorResponse(502, "NETWORK_ERROR", st(request, "err.networkError", { name: target.label }));
  }

  if (!upstream.ok || !upstream.body) {
    if (upstream.status === 401) {
      return errorResponse(
        401,
        "INVALID_KEY",
        st(request, "err.invalidKey", { name: target.label }),
      );
    }
    if (upstream.status === 429) {
      /**
       * 重试一次仍然是 429，说明不是偶发。
       *
       * 关键：把上游的原始说明一起带回来。
       * 「请求过快」是个筐，实际可能是按 Key 限流、按出口 IP 限流、
       * 按并发限流、甚至是账号被标记 —— 不看上游原文根本分不清。
       * Workers 的出口 IP 由大量站点共用，即便你一分钟只发一条也可能被按 IP 拒。
       */
      const wait = retryAfterSeconds(upstream);
      const raw = await upstream.text().catch(() => "");
      let upstreamMsg = "";
      try {
        const j = JSON.parse(raw) as { error?: { message?: string }; message?: string };
        upstreamMsg = j?.error?.message ?? j?.message ?? "";
      } catch {
        upstreamMsg = raw.slice(0, 200);
      }

      const plat = detectPlatform();
      const tip =
        plat === "cloudflare"
          ? st(request, "err.rateLimitCf")
          : st(request, "err.rateLimitShared");

      return NextResponse.json(
        {
          error: st(request, "err.rateLimitPrefix", { name: target.label }) + tip,
          upstreamMessage: upstreamMsg || st(request, "err.noUpstreamMsg"),
          code: "RATE_LIMIT",
          retryAfter: wait,
          platform: plat,
          diagnoseUrl: "/api/diagnose",
        },
        { status: 429, headers: { "Retry-After": String(wait) } },
      );
    }
    const text = await upstream.text().catch(() => "");
    console.error("[chat] 上游返回错误", upstream.status);
    return errorResponse(
      upstream.status || 500,
      "UPSTREAM_ERROR",
      st(request, "err.upstreamError", { status: upstream.status, text: text.slice(0, 200) }),
    );
  }

  const user = await getCurrentUser();
  const shouldSave = Boolean(saveToCloud && conversationId && user && hasRedisConfig());

  // 统计：累计 AI 回复次数（失败不计）
  if (hasRedisConfig()) {
    try {
      await getRedis().incr(KEYS.statMessages);
    } catch {
      /* 统计失败不影响聊天 */
    }
  }

  // 透传上游 SSE，同时累积助手文本，用于「保存到云端」
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let assistantText = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (shouldSave && assistantText) {
            try {
              const redis = getRedis();
              const payload = JSON.stringify({
                conversationId,
                model,
                title: (conversationTitle ?? "").slice(0, 60),
                messages: [
                  // 存云端时把多模态内容压成纯文本，避免图片 base64 占满 Redis
                  ...(messages ?? []).map((m) => ({
                    role: m.role,
                    content:
                      typeof m.content === "string"
                        ? m.content
                        : m.content
                            .map((c) =>
                              c.type === "text" ? c.text : "[图片]",
                            )
                            .join("\n"),
                  })),
                  { role: "assistant", content: assistantText },
                ],
                updatedAt: Date.now(),
              });
              await redis
                .pipeline()
                .set(KEYS.chat(user!.id, conversationId!), payload)
                .sadd(KEYS.chatIndex(user!.id), conversationId!)
                .exec();
            } catch {
              /* 云端保存失败不影响聊天 */
            }
          }
          controller.close();
          return;
        }
        if (value) {
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === "string") assistantText += delta;
            } catch {
              /* SSE 被分片，忽略 */
            }
          }
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
