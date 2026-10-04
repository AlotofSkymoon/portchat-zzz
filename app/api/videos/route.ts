import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { configValue } from "@/lib/runtime-config";
import { serverT as st } from "@/lib/i18n/server";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { REQUIRE_LOGIN } from "@/lib/site";
import {
  AGNES_VIDEO_MODEL,
  AGNES_VIDEO_POLL_URL,
  AGNES_VIDEO_URL,
  VIDEO_RATIOS,
  VIDEO_SECONDS,
  VIDEO_SIZES,
} from "@/lib/config";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Agnes 文生视频代理。
 *
 * ⚠️ 跟生图最大的区别：视频是**异步**的。
 *    POST /v1/videos 只是"建任务"，立刻返回 video_id；
 *    真正的 mp4 要拿这个 id 去 /agnesapi 反复查，status 变 completed 才有 url。
 *    所以这里拆成两个动词：POST 建任务、GET 查进度。
 *
 * Key 与生图共用 AGNES_IMAGE_API_KEY（站长只填一个 Key 就能同时开图和视频）。
 */

/**
 * 从上游响应里掏出视频地址。
 *
 * 文档里两种位置都出现过：顶层 url（v2.0 文档）和 metadata.url（2.5 文档）。
 * 两边都兼容，避免只认一种导致"明明生成完了却显示失败"。
 */
function pickUrl(data: unknown): string {
  const d = data as Record<string, unknown>;
  const top = typeof d?.url === "string" ? d.url : "";
  if (top) return top;
  const meta = d?.metadata as Record<string, unknown> | undefined;
  const inMeta = typeof meta?.url === "string" ? meta.url : "";
  if (inMeta) return inMeta;
  const data2 = d?.data as { url?: string }[] | undefined;
  const inData = Array.isArray(data2) && typeof data2[0]?.url === "string" ? data2[0]!.url : "";
  return inData;
}

/** 建任务 / 查进度共用的 Key 解析：用户自带优先，回落服务端预设 */
function resolveKey(own?: string): string {
  const trimmed = (own ?? "").trim();
  return trimmed || configValue("AGNES_IMAGE_API_KEY", "PRESET_AGNES_API_KEY");
}

/** 把上游非 2xx 的原始响应转成带状态码的错误，交给外层归类成中文提示 */
async function readUpstream(res: Response): Promise<never> {
  const raw = (await res.text().catch(() => "")).slice(0, 500);
  const err = new Error(raw) as Error & { status?: number };
  err.status = res.status;
  throw err;
}

function hintFor(t: (k: string, v?: Record<string, string | number>) => string, status: number) {
  if (status === 401 || status === 403) return t("api.imageAuthFailed");
  if (status === 429) return t("api.imageRateLimited");
  if (status === 502) return t("api.imageBadResponse");
  return t("api.videoFailed", { status: String(status) });
}

/* ------------------------------ 创建任务 ------------------------------ */

export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => st(request, k, vars);
  const denied = REQUIRE_LOGIN && !(await getCurrentUser());
  if (denied) {
    return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  }

  let body: {
    prompt?: string;
    seconds?: string;
    aspectRatio?: string;
    size?: string;
    apiKey?: string;
  };
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

  const finalKey = resolveKey(body.apiKey);
  if (!finalKey) {
    return NextResponse.json({ error: t("api.noAgnesKey") }, { status: 400 });
  }

  // 时长按文档以字符串传；不在允许档位里就回落 "5"
  const rawSec = (body.seconds ?? "").trim();
  const seconds = (VIDEO_SECONDS as readonly string[]).includes(rawSec) ? rawSec : "5";

  const rawRatio = (body.aspectRatio ?? "").trim();
  const aspectRatio = (VIDEO_RATIOS as readonly string[]).includes(rawRatio)
    ? rawRatio
    : "16:9";

  const rawSize = (body.size ?? "").trim();
  const size = (VIDEO_SIZES as readonly string[]).includes(rawSize) ? rawSize : "720P";

  const payload = {
    model: AGNES_VIDEO_MODEL,
    prompt,
    seconds,
    size,
    aspect_ratio: aspectRatio,
  };

  try {
    const upstream = await fetch(AGNES_VIDEO_URL, {
      method: "POST",
      signal: timeoutSignal(45_000),
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${finalKey}`,
      },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) await readUpstream(upstream);

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;

    // 三个 id 字段文档都列了：video_id 是推荐的查询键，task_id / id 兜底
    const videoId =
      (typeof data.video_id === "string" && data.video_id) ||
      (typeof data.task_id === "string" && data.task_id) ||
      (typeof data.id === "string" && data.id) ||
      "";

    if (!videoId) {
      return NextResponse.json({ error: t("api.videoNoTask") }, { status: 502 });
    }

    // 少数上游会同步直接返回 url（不用轮询），这里一并带回去
    const url = pickUrl(data);
    const status = typeof data.status === "string" ? data.status : "queued";

    return NextResponse.json({
      videoId,
      model: AGNES_VIDEO_MODEL,
      status,
      url: url || undefined,
      sent: payload,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: t("api.imageTimeout") }, { status: 504 });
    }
    const status = (err as Error & { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: hintFor(t, status), upstream: (err as Error).message },
      { status: 502 },
    );
  }
}

/* ------------------------------ 查询进度 ------------------------------ */

export async function GET(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => st(request, k, vars);
  const denied = REQUIRE_LOGIN && !(await getCurrentUser());
  if (denied) {
    return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  }

  const url = new URL(request.url);
  const videoId = (url.searchParams.get("video_id") ?? "").trim();
  const apiKey = (url.searchParams.get("apiKey") ?? "").trim();
  if (!videoId) {
    return NextResponse.json({ error: t("api.badRequest") }, { status: 400 });
  }

  const finalKey = resolveKey(apiKey);
  if (!finalKey) {
    return NextResponse.json({ error: t("api.noAgnesKey") }, { status: 400 });
  }

  /*
   * 文档推荐的查询形式：video_id + model_name。
   * 只带 video_id 的简写形式只对 mode:"text" 的任务有效，带上 model_name 更稳。
   */
  const pollUrl = `${AGNES_VIDEO_POLL_URL}?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(AGNES_VIDEO_MODEL)}`;

  try {
    const upstream = await fetch(pollUrl, {
      signal: timeoutSignal(30_000),
      headers: { authorization: `Bearer ${finalKey}` },
    });
    if (!upstream.ok) await readUpstream(upstream);

    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    const status = typeof data.status === "string" ? data.status : "";
    const progress = Number(data.progress ?? 0) || 0;
    const videoUrl = pickUrl(data);

    // 失败时上游会把原因放在 error 字段（字符串或对象）
    const rawErr = data.error;
    const errText =
      typeof rawErr === "string"
        ? rawErr
        : rawErr && typeof rawErr === "object"
          ? String((rawErr as { message?: string }).message ?? "")
          : "";

    return NextResponse.json({
      status: status || "queued",
      progress,
      url: videoUrl || undefined,
      error: errText || undefined,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: t("api.imageTimeout") }, { status: 504 });
    }
    const status = (err as Error & { status?: number }).status ?? 502;
    return NextResponse.json(
      { error: hintFor(t, status), upstream: (err as Error).message },
      { status: 502 },
    );
  }
}
