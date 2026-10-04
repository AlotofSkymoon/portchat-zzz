import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { configValue } from "@/lib/runtime-config";
import { serverT as st } from "@/lib/i18n/server";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { REQUIRE_LOGIN } from "@/lib/site";
import {
  AGNES_IMAGE_MODEL,
  AGNES_IMAGE_URL,
  IMAGE_MAX_COUNT,
  IMAGE_RATIOS,
  IMAGE_SIZES,
} from "@/lib/config";

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

  let body: { prompt?: string; apiKey?: string; size?: string; ratio?: string; n?: number };
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
  // 生图单独给一个变量名，站长可以只配生图 Key 而不开聊天预设 Key
  const finalKey = own || configValue("AGNES_IMAGE_API_KEY", "PRESET_AGNES_API_KEY");
  if (!finalKey) {
    return NextResponse.json({ error: t("api.noAgnesKey") }, { status: 400 });
  }

  /*
   * size 用文档推荐的档位写法（1K/2K/3K/4K）。
   * 旧的 1024x1024 精确尺寸也放行（文档说"兼容历史写法"），
   * 但默认值改成 1K + ratio，因为档位式才是官方推荐路径。
   */
  const rawSize = (body.size ?? "").trim();
  const size = (IMAGE_SIZES as readonly string[]).includes(rawSize)
    ? rawSize
    : /^\d{2,4}x\d{2,4}$/.test(rawSize)
      ? rawSize
      : "1K";

  const rawRatio = (body.ratio ?? "").trim();
  const ratio = (IMAGE_RATIOS as readonly string[]).includes(rawRatio) ? rawRatio : "1:1";

  const n = Math.min(Math.max(Math.trunc(Number(body.n) || 1), 1), IMAGE_MAX_COUNT);

  /**
   * 发一次上游请求。
   *
   * ⚠️ 上游文档没有列出 n 参数，实测可能只返回 1 张。这里先按 n 请求一次，
   *    数量不够再并发补齐（见下方 fallback），这样两种上游都能出满 n 张。
   */
  async function callOnce(count: number): Promise<string[]> {
    const upstream = await fetch(AGNES_IMAGE_URL, {
      method: "POST",
      signal: timeoutSignal(50_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${finalKey}`,
      },
      body: JSON.stringify({ model: AGNES_IMAGE_MODEL, prompt, size, ratio, n: count }),
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      // 上游返回的都是英文技术信息，原样透出对用户毫无帮助，
      // 这里把状态码带上，交给外层归类成能看懂的提示。
      const err = new Error(raw.slice(0, 500)) as Error & { status?: number };
      err.status = upstream.status;
      throw err;
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      const err = new Error(raw.slice(0, 500)) as Error & { status?: number };
      err.status = 502;
      throw err;
    }

    const list = (data as { data?: { url?: string; b64_json?: string }[] })?.data ?? [];
    return list
      .map((item) =>
        item.url
          ? item.url
          : item.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : null,
      )
      .filter((u): u is string => Boolean(u));
  }

  try {
    const images: string[] = [];

    try {
      images.push(...(await callOnce(n)));
    } catch (e) {
      // 超时交给最外层处理（要返回 504 而不是 502）
      if (e instanceof Error && e.name === "AbortError") throw e;
      const status = (e as Error & { status?: number }).status ?? 502;
      const hint =
        status === 401 || status === 403
          ? t("api.imageAuthFailed")
          : status === 429
            ? t("api.imageRateLimited")
            : status === 502
              ? t("api.imageBadResponse")
              : t("api.imageFailed", { status: String(status) });
      return NextResponse.json(
        { error: hint, upstream: (e as Error).message },
        { status: 502 },
      );
    }

    if (!images.length) {
      return NextResponse.json({ error: t("api.imageEmpty") }, { status: 502 });
    }

    // 上游不支持 n 时只回 1 张，这里并发补够（补发的失败静默忽略，已有图就够用）
    if (images.length < n) {
      const extra = await Promise.all(
        Array.from({ length: n - images.length }, () =>
          callOnce(1).catch(() => [] as string[]),
        ),
      );
      for (const arr of extra) images.push(...arr);
    }

    return NextResponse.json({ images });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? t("api.imageTimeout") : t("api.imageNetworkError") },
      { status: aborted ? 504 : 502 },
    );
  }
}
