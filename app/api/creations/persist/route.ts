import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getRedis, getJsonValue, hasRedisConfig, storageErrorMessage, KEYS } from "@/lib/redis";
import { getSiteS3ConfigAsync } from "@/lib/s3-server";
import { presignS3Put } from "@/lib/s3-sign";
import { getR2Bucket } from "@/lib/storage/binding";
import type { S3Config } from "@/lib/s3-presets";
import type { CreationRecord } from "@/lib/creations";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/creations/persist —— 把生成结果转存到对象存储，做永久保存。
 *
 * 为什么必须有这一步：
 * 上游返回的图片/视频链接是**临时的**，过一段时间就 404。
 * 创作记录里只存了这个链接，所以记录还在、图没了。
 *
 * 做法：服务端把上游文件拉下来，再上传到站点配置的对象存储（R2 / B2 / 七牛等），
 * 用存储桶的公开地址替换掉临时链接 —— 只要桶不删，图就一直在。
 */

interface PersistBody {
  id?: string;
  config?: S3Config;
}

/** 单个文件的下载/上传上限：视频最大 100MB */
const MAX_BYTES = 100 * 1024 * 1024;
/** 下载上游文件的超时（生成完立刻转存，正常几秒内完成） */
const FETCH_TIMEOUT_MS = 60_000;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** 从 URL 或 Content-Type 推断扩展名，猜不出就用 kind 兜底 */
function extOf(url: string, contentType: string, kind: string): string {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const fromCt: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  if (fromCt[ct]) return fromCt[ct];

  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-z0-9]{1,8})$/i);
    if (m) return m[1].toLowerCase();
  } catch {
    /* URL 解析失败，走兜底 */
  }
  return kind === "video" ? "mp4" : "png";
}

/** 拼公开访问地址 */
function publicUrlFor(cfg: S3Config, key: string): string {
  const base = (cfg.publicBaseUrl || cfg.endpoint || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/${key.replace(/^\/+/, "")}`;
}

/** 上传到对象存储：优先 R2 binding（免密钥），否则走预签名 PUT */
async function putObject(
  cfg: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<{ ok: boolean; error?: string }> {
  // 1) R2 binding 直传（Workers 上绑定了桶时最快，且不需要 AK/SK）
  try {
    const bucket = await getR2Bucket();
    if (bucket) {
      await bucket.put(key, body, {
        httpMetadata: { contentType },
      });
      return { ok: true };
    }
  } catch {
    /* binding 不可用（Vercel 上必然），走预签名 */
  }

  // 2) 预签名上传
  if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
    return { ok: false, error: "对象存储未配置完整" };
  }

  try {
    const url = await presignS3Put({
      endpoint: cfg.endpoint,
      bucket: cfg.bucket,
      key,
      region: cfg.region || "auto",
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      expiresIn: 900,
      contentType,
      forcePathStyle: undefined,
    });

    const res = await fetch(url, {
      method: "PUT",
      headers: { "content-type": contentType },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `上传失败（HTTP ${res.status}）${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "上传失败" };
  }
}

export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => st(request, k, vars);

  const user = await getCurrentUser();
  if (!user) return bad(t("err.notLoggedIn"), 401);
  if (!hasRedisConfig()) return bad(storageErrorMessage(), 500);

  let body: PersistBody;
  try {
    body = (await request.json()) as PersistBody;
  } catch {
    return bad(t("err.badRequest"));
  }

  const id = body.id ?? "";
  if (!id) return bad(t("err.badRequest"));

  const redis = getRedis();
  const rec = await getJsonValue<CreationRecord>(KEYS.creation(user.id, id));
  if (!rec?.id) return bad(t("err.badRequest"));

  // 已经永久保存过就不重复传，避免每次点按钮都刷一遍流量
  if (rec.persisted) {
    return NextResponse.json({ ok: true, urls: rec.urls, skipped: true });
  }

  const cfg = body.config?.enabled
    ? body.config
    : ((await getSiteS3ConfigAsync()) ?? null);

  if (!cfg?.enabled) {
    return bad(t("err.storageNotConfigured"), 400);
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const prefix = (cfg.prefix || "agnes-chat").replace(/^\/+|\/+$/g, "");

  const results: string[] = [];
  const failures: string[] = [];

  for (let i = 0; i < rec.urls.length; i++) {
    const src = rec.urls[i];

    // 已经是永久地址（不在上游域名下）就跳过
    if (!/^https?:\/\//i.test(src)) {
      failures.push(src);
      continue;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(src, { signal: ctrl.signal });
      clearTimeout(timer);

      if (!res.ok) {
        failures.push(`HTTP ${res.status}`);
        continue;
      }

      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        failures.push("文件过大");
        continue;
      }

      const contentType = res.headers.get("content-type") || "application/octet-stream";
      const ext = extOf(src, contentType, rec.kind);
      const key = `${prefix}/creations/${user.id}/${yyyy}/${mm}/${id}-${i}.${ext}`;

      const put = await putObject(cfg, key, buf, contentType);
      if (!put.ok) {
        failures.push(put.error ?? "上传失败");
        results.push(src); // 保留原链接，至少还能看一阵
        continue;
      }

      const permanent = publicUrlFor(cfg, key);
      results.push(permanent || src);
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "下载失败");
      results.push(src);
    }
  }

  // 全部失败就不要标记 persisted，否则用户以为存好了其实没存
  const allFailed = failures.length === rec.urls.length && rec.urls.length > 0;
  if (allFailed) {
    return bad(`永久保存失败：${failures[0] ?? "未知原因"}`, 502);
  }

  const updated: CreationRecord = {
    ...rec,
    urls: results.length ? results : rec.urls,
    persisted: true,
    persistedAt: Date.now(),
  };

  await redis.set(KEYS.creation(user.id, id), JSON.stringify(updated));

  return NextResponse.json({
    ok: true,
    urls: updated.urls,
    failed: failures.length,
  });
}
