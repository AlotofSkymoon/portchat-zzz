import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, resolveTarget } from "@/lib/config";
import { credentialStatus } from "@/lib/cf-credentials";
import { detectPlatform } from "@/lib/platform";
import { configValue } from "@/lib/runtime-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/diagnose —— 真实打一次上游，把返回原样报回来。
 *
 * 为什么需要它：
 * 「请求过快（429）」这句话太笼统，可能是本站限流、上游按 Key 限流、
 * 上游按出口 IP 限流、模型无权限、Key 无效…… 光看提示根本分不清。
 * 这个接口直接替你问一次上游，把状态码和原始响应贴出来，真相一目了然。
 *
 * 仅管理员可用：会用到服务端的 Key，且响应体里含有上游信息。
 */
export async function GET() {
  /**
   * requireAdmin 内部是 throw（不是返回 null），不接住会变成 500，
   * 看起来跟"接口不存在"一样难排查。这里按状态码翻译成明确提示。
   */
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin();
  } catch (err) {
    const status = (err as Error & { status?: number })?.status ?? 500;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "请先登录管理员账号再访问本接口（第一个注册的账号自动成为管理员）。"
            : "需要管理员权限。",
        code: status === 401 ? "LOGIN_REQUIRED" : "FORBIDDEN",
      },
      { status },
    );
  }
  if (!admin) {
    return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });
  }

  const platform = detectPlatform();
  const target = resolveTarget(DEFAULT_MODEL, []);
  const key = configValue("PRESET_AGNES_API_KEY");

  if (!target) {
    return NextResponse.json({ error: "找不到默认模型所属供应商" }, { status: 500 });
  }

  const result: Record<string, unknown> = {
    platform,
    model: DEFAULT_MODEL,
    targetBase: target.baseUrl,
    providerId: target.providerId,
    hasKey: Boolean(key),
    keyPrefix: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : "",
    /**
     * Cloudflare 凭证识别情况。
     *
     * 「配了 R2 但用不了」绝大多数时候不是配置错，而是**根本没读到** ——
     * 变量名五花八门、Workers 上 process.env 拿不到 secret、
     * 粘贴混入换行…… 表现全一样，光看现象分不清。
     *
     * 这里把"读到了哪个变量、从哪读的、长度对不对"直接列出来，
     * 一眼就能看出是没填、名字不对，还是形态不对。
     */
    cloudflareCredentials: credentialStatus(),
  };

  if (!key) {
    return NextResponse.json({
      ...result,
      ok: false,
      problem: "服务端没配 PRESET_AGNES_API_KEY，无法测试",
    });
  }

  // 真实发一个最小请求，把上游的回应原样记录下来
  const started = Date.now();
  try {
    const res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      }),
    });

    const bodyText = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      /* 非 JSON，保留原文 */
    }

    // 挑几个有助于判断限流维度的响应头
    const interesting = [
      "retry-after",
      "x-ratelimit-limit-requests",
      "x-ratelimit-remaining-requests",
      "x-ratelimit-reset-requests",
      "cf-ray",
      "cf-cache-status",
      "server",
    ];
    const headers: Record<string, string> = {};
    for (const h of interesting) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }

    return NextResponse.json({
      ...result,
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - started,
      headers,
      body: bodyText.slice(0, 600),
      parsed,
      hint: interpret(platform, res.status, bodyText),
    });
  } catch (err) {
    return NextResponse.json({
      ...result,
      ok: false,
      problem: err instanceof Error ? err.message : String(err),
      hint: "请求根本没发出去或连接被拒。检查 Base URL 是否正确、Workers 是否允许出站。",
    });
  }
}

/** 把状态码翻译成人能看懂的判断 */
function interpret(platform: string, status: number, body: string): string {
  if (status === 200) return "上游正常，本站到模型服务的链路没问题。";

  if (status === 429) {
    const sharedIp =
      platform === "cloudflare"
        ? "注意：Cloudflare Workers 的出口 IP 由大量站点共用，上游若按「出口 IP」限流，即使你一分钟只发一两条也可能被拒 —— 这是 Workers 部署 AI 代理最常见的原因。可尝试改用 Vercel 部署、或让访客自带 API Key。"
        : "请确认是否多个站点共用了同一个 Key。";
    return `上游按额度拒绝了请求（429）。${sharedIp} 上游原始说明：${body.slice(0, 200)}`;
  }
  if (status === 401) return "Key 无效或已失效，去服务商后台重新生成。";
  if (status === 403) return "Key 无该模型权限，或账号被限制。检查模型名是否需要单独开通。";
  if (status === 404) return "Base URL 或模型名不对，上游找不到该资源。";
  if (status >= 500) return "上游服务暂时故障，稍后重试。";
  return `未预期的状态码 ${status}，看 body 字段里的原始响应。`;
}
