import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hitArenaRateLimit } from "@/lib/arena-rate-limit";
import { isAllowedModelWith, resolveTarget, sanitizeCustomProviders } from "@/lib/config";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { serverT as st } from "@/lib/i18n/server";
import { REQUIRE_LOGIN } from "@/lib/site";
import { configValue } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 竞技场的**单步**模型调用。
 *
 * 只负责「给定 system + user，打某个模型，把文本拿回来」，
 * 剧本怎么走由前端决定（理由见 lib/arena/types.ts 顶部注释）。
 *
 * 刻意做非流式：竞技场要的是"这一轮所有人的发言都到齐再往下推"，
 * 流式在这里没有意义，还会把前端状态机搞复杂。
 */

interface TurnBody {
  model?: string;
  system?: string;
  user?: string;
  maxTokens?: number;
  keys?: Record<string, string>;
  baseUrls?: Record<string, string>;
  customProviders?: unknown;
}

/** 单次输出上限：防止某个模型啰嗦起来把整局成本拉爆 */
const MAX_TOKENS_CAP = 1200;

/** 单次上游请求超时 */
const UPSTREAM_TIMEOUT_MS = 55_000;

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  let body: TurnBody;
  try {
    body = (await request.json()) as TurnBody;
  } catch {
    return err(400, "BAD_REQUEST", st(request, "err.badRequest"));
  }

  const {
    model = "",
    system = "",
    user = "",
    maxTokens = 500,
    keys,
    baseUrls,
    customProviders,
  } = body;

  if (!user.trim()) return err(400, "BAD_REQUEST", st(request, "err.emptyMessage"));

  if (REQUIRE_LOGIN) {
    const u = await getCurrentUser();
    if (!u) return err(401, "LOGIN_REQUIRED", st(request, "err.loginRequired"));
  }

  const custom = sanitizeCustomProviders(customProviders);
  if (!isAllowedModelWith(model, custom)) {
    return err(400, "BAD_MODEL", st(request, "err.badModel"));
  }

  const target = resolveTarget(model, custom, baseUrls);
  if (!target) return err(400, "BAD_MODEL", st(request, "err.noProvider"));

  // Key 规则与聊天一致：agnes 可用服务端预设，其余必须用用户自己的
  let finalKey = "";
  if (target.providerId === "agnes") {
    finalKey = (keys?.agnes ?? "").trim() || configValue("PRESET_AGNES_API_KEY");
  } else {
    finalKey = (keys?.[target.providerId] ?? "").trim();
  }
  if (!finalKey) {
    return err(
      401,
      "NO_API_KEY",
      target.providerId === "agnes"
        ? st(request, "err.noAgnesKey")
        : st(request, "err.providerKeyRequired", { name: target.label }),
    );
  }

  /* ---------------------------- 限流 ---------------------------- */
  const u = await getCurrentUser();
  if (u?.role !== "admin") {
    const fwd = request.headers.get("x-forwarded-for") ?? "";
    const ip = fwd.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
    const r = await hitArenaRateLimit(u ? `u:${u.id}` : `ip:${ip}`);
    if (!r.allowed) {
      return NextResponse.json(
        { error: st(request, "arena.rateLimited"), code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(r.retryAfter) } },
      );
    }
  }

  /* --------------------------- 上游调用 --------------------------- */
  const started = Date.now();
  const tokenCap = Math.min(Math.max(50, Math.floor(maxTokens)), MAX_TOKENS_CAP);

  const send = async (): Promise<Response> =>
    fetch(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${finalKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(system.trim() ? [{ role: "system", content: system }] : []),
          { role: "user", content: user },
        ],
        stream: false,
        max_tokens: tokenCap,
        // 竞技场要的是"各模型风格差异"，temperature 太低大家说一样的话
        temperature: 0.9,
      }),
      signal: timeoutSignal(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });

  let upstream: Response;
  try {
    upstream = await send();
    // 瞬时 429 重试一次（免费额度常按每分钟计，隔 2 秒往往就空出来了）
    if (upstream.status === 429) {
      await upstream.text().catch(() => "");
      await new Promise((r) => setTimeout(r, 2000));
      upstream = await send();
    }
  } catch {
    return err(502, "NETWORK_ERROR", st(request, "err.networkError", { name: target.label }));
  }

  const ms = Date.now() - started;

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => "");
    let detail = "";
    try {
      const j = JSON.parse(raw) as { error?: { message?: string }; message?: string };
      detail = j?.error?.message ?? j?.message ?? "";
    } catch {
      detail = raw.slice(0, 200);
    }
    if (upstream.status === 401) {
      return err(401, "INVALID_KEY", st(request, "err.invalidKey", { name: target.label }));
    }
    return err(
      upstream.status >= 500 ? 502 : 400,
      "UPSTREAM_ERROR",
      detail || st(request, "err.upstreamError", { name: target.label }),
    );
  }

  let text = "";
  try {
    const j = (await upstream.json()) as {
      choices?: { message?: { content?: string | unknown } }[];
    };
    const c = j?.choices?.[0]?.message?.content;
    /**
     * 部分上游（含某些推理模型）返回的 content 是分片数组而不是字符串。
     * 直接当字符串用会得到 "[object Object]"，必须逐个取 text 字段。
     */
    text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c
              .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : ""))
              .join("")
          : "";
  } catch {
    return err(502, "BAD_JSON", st(request, "err.upstreamError", { name: target.label }));
  }

  return NextResponse.json({ text: text.trim(), ms });
}
