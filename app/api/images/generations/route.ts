import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { configValue } from "@/lib/runtime-config";
import { serverT as st } from "@/lib/i18n/server";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { REQUIRE_LOGIN } from "@/lib/site";
import { AGNES_IMAGE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Agnes 文生图代理。
 *
 * 为什么要走服务端：浏览器直连会把 Key 暴露在前端，而且上游
 * 通常不给跨域。这里统一代转，Key 用户优先、回落服务端预设。
 */
export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => st(request, k, vars);
  const denied = REQUIRE_LOGIN && !(await getCurrentUser());
  if (denied) {
    return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  }

  let body: { prompt?: string; apiKey?: string; size?: string; n?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t("api.badRequest") }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: t("api.promptRequired") }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json({ error: t("api.promptTooLong") }, { status: 400 });
  }

  const own = (body.apiKey ?? "").trim();
  const finalKey = own || configValue("PRESET_AGNES_API_KEY");
  if (!finalKey) {
    return NextResponse.json({ error: t("api.noAgnesKey") }, { status: 400 });
  }

  const size = /^\d{2,4}x\d{2,4}$/.test(body.size ?? "") ? body.size! : "1024x1024";
  const n = Math.min(Math.max(Number(body.n) || 1, 1), 4);

  try {
    const upstream = await fetch(AGNES_IMAGE_URL, {
      method: "POST",
      signal: timeoutSignal(50_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${finalKey}`,
      },
      body: JSON.stringify({ model: "agnes-image", prompt, size, n }),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      // 上游返回的都是英文技术信息，原样透出对用户毫无帮助，
      // 这里按状态码归类成能看懂的提示。
      const hint =
        upstream.status === 401 || upstream.status === 403
          ? t("api.imageAuthFailed")
          : upstream.status === 429
            ? t("api.imageRateLimited")
            : t("api.imageFailed", { status: String(upstream.status) });
      return NextResponse.json({ error: hint, upstream: raw.slice(0, 500) }, { status: 502 });
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: t("api.imageBadResponse") }, { status: 502 });
    }

    const list = (data as { data?: { url?: string; b64_json?: string }[] })?.data ?? [];
    if (!list.length) {
      return NextResponse.json({ error: t("api.imageEmpty") }, { status: 502 });
    }

    const images = list
      .map((item) =>
        item.url
          ? item.url
          : item.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : null,
      )
      .filter((u): u is string => Boolean(u));

    return NextResponse.json({ images });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? t("api.imageTimeout") : t("api.imageNetworkError") },
      { status: aborted ? 504 : 502 },
    );
  }
}
