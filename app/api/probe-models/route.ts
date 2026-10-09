import { NextResponse } from "next/server";

import { isBlockedBaseUrl, PROVIDERS, type ProviderId } from "@/lib/config";
import { isTimeoutError, timeoutSignal } from "@/lib/fetch-timeout";
import { serverT } from "@/lib/i18n/server";
import { loadStoredPresetKeys, resolvePresetKey } from "@/lib/preset-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/probe-models —— 自动发现某个 OpenAI 兼容服务上有哪些模型。
 *
 * 做法就是标准的 `GET {baseUrl}/models`，OpenAI 官方定义，绝大多数
 * 中转服务（One API / New API / VoAPI / 各家官方 API）都实现了。
 *
 * 拿不到就如实告诉前端"没探测到"，由前端引导用户手填 ——
 * 有些中转站出于安全考虑会关掉这个端点，这是正常的，不该因此卡住添加流程。
 */

interface ProbeBody {
  baseUrl?: string;
  apiKey?: string;
  /** 内置服务商 id。没填 Key 时，若地址与该服务商地址一致就用站点预设 Key 探测 */
  providerId?: string;
}

/** 从 /models 的响应里抽出模型 id 列表，兼容几种常见结构 */
function extractIds(data: unknown): string[] {
  const out: string[] = [];

  // OpenAI 标准：{ data: [{ id: "gpt-4o", ... }] }
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    for (const item of (data as { data: unknown[] }).data) {
      if (item && typeof item === "object") {
        const id = (item as { id?: unknown }).id;
        if (typeof id === "string" && id.trim()) out.push(id.trim());
      }
    }
  }

  // 少数服务直接返回字符串数组
  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === "string" && item.trim()) out.push(item.trim());
    }
  }

  return out;
}

export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  let body: ProbeBody;
  try {
    body = (await request.json()) as ProbeBody;
  } catch {
    return NextResponse.json({ error: t("api.badRequest") }, { status: 400 });
  }

  const base = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (body.apiKey ?? "").trim();

  if (!base) return NextResponse.json({ error: t("api.probe.needBaseUrl") }, { status: 400 });
  if (!/^https?:\/\//i.test(base)) {
    return NextResponse.json({ error: t("api.probe.baseUrlScheme") }, { status: 400 });
  }
  if (isBlockedBaseUrl(base)) {
    return NextResponse.json({ error: t("api.probe.noInternal") }, { status: 400 });
  }

  /**
   * 没填用户 Key 时，若探测地址正好是某个内置服务商的地址，就用它的站点预设 Key。
   *
   * ⚠️ 这里必须比对地址：地址必须与该服务商自己的地址一致才垫 Key。
   * 否则任何人都能拿任意 baseUrl 来探测，把站点 Key 发到他自己的服务器上。
   */
  let effectiveKey = key;
  if (!effectiveKey && body.providerId && body.providerId in PROVIDERS) {
    const pid = body.providerId as ProviderId;
    const ownBase = PROVIDERS[pid].baseUrl.replace(/\/+$/, "");
    if (base === ownBase) {
      effectiveKey = resolvePresetKey(pid, await loadStoredPresetKeys());
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  // 没填 Key 也照样探测：不少中转站的 /models 是公开的
  if (effectiveKey) headers.Authorization = `Bearer ${effectiveKey}`;

  try {
    const res = await fetch(`${base}/models`, {
      headers,
      // 探测不该拖太久，超时就当探测失败
      signal: timeoutSignal(10_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: res.status,
          error: t("api.probe.upstreamStatus", { status: res.status }),
        },
        { status: 200 },
      );
    }

    const raw = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    const ids = extractIds(parsed);
    if (ids.length === 0) {
      return NextResponse.json({
        ok: false,
        error: t("api.probe.noModels"),
        raw: raw.slice(0, 200),
      });
    }

    // 去重 + 排序，最多给 200 个，防止列表爆炸
    const unique = Array.from(new Set(ids)).sort().slice(0, 200);
    return NextResponse.json({ ok: true, models: unique, total: unique.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 超时单独说明，比笼统的"失败"更好定位
    const timedOut = isTimeoutError(err);
    return NextResponse.json({
      ok: false,
      error: timedOut
        ? t("api.probe.timeout")
        : t("api.probe.unreachable", { msg }),
    });
  }
}
