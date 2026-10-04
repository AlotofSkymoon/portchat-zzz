import { NextResponse } from "next/server";

import { presignS3Put } from "@/lib/s3-sign";
import { UPLOAD_LIMITS, type S3Config } from "@/lib/s3-presets";
import { getSiteS3Config, getSiteS3ConfigAsync } from "@/lib/s3-server";
import { detectPlatform, platformLabel } from "@/lib/platform";
import { getRedis, hasRedisConfig, KEYS } from "@/lib/redis";
import { serverT } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PresignBody {
  filename?: string;
  contentType?: string;
  size?: number;
  config?: S3Config;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** 文件名清洗：只留安全字符，避免 object key 注入 */
function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-80);
  return cleaned || "file";
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  if (i === -1) return "";
  const ext = name.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

function classify(contentType: string, filename: string): "image" | "video" | "other" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  const ext = extOf(filename);
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "m4v", "avi", "mkv"].includes(ext)) return "video";
  return "other";
}

export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  let body: PresignBody;
  try {
    body = (await request.json()) as PresignBody;
  } catch {
    return bad(t("api.badRequest"));
  }

  const { filename = "", contentType = "application/octet-stream", size = 0, config } = body;

  /**
   * 站点托管模式：管理员已在服务端配好 R2，
   * 前端只需传 { enabled: true, useSiteConfig: true }，密钥不会离开服务器。
   */
  // 同步读不到时用异步版：只填了 R2_BUCKET_NAME + API Token 的情况
  const siteCfg = getSiteS3Config() ?? (await getSiteS3ConfigAsync());
  const useSite = Boolean(config?.enabled && (config as { useSiteConfig?: boolean }).useSiteConfig);

  let effective: S3Config | undefined = config;

  if (useSite) {
    if (!siteCfg) return bad(t("api.upload.siteNotConfigured"), 503);
    // 目录前缀沿用站点配置，其余用服务端凭证
    effective = { ...siteCfg, prefix: config?.prefix?.trim() || siteCfg.prefix };
  }

  if (!effective?.enabled) return bad(t("api.upload.notEnabled"));
  if (!effective.endpoint?.trim()) return bad(t("api.upload.missingEndpoint"));
  if (!effective.bucket?.trim()) return bad(t("api.upload.missingBucket"));
  if (!effective.accessKeyId?.trim()) return bad(t("api.upload.missingAk"));
  if (!effective.secretAccessKey?.trim()) return bad(t("api.upload.missingSk"));
  if (!effective.region?.trim()) return bad(t("api.upload.missingRegion"));

  const cfg = effective;

  // endpoint 必须是 https，防止凭证泄露到明文通道
  let endpoint = cfg.endpoint.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(endpoint)) endpoint = `https://${endpoint}`;
  if (!endpoint.startsWith("https://") && !endpoint.includes("localhost")) {
    return bad(t("api.upload.endpointHttps"));
  }

  /**
   * 平台锁定（默认**关闭**）。
   *
   * 以前这里按部署平台硬限制：Workers 只准 R2、Vercel 只准 B2。
   * 结果是 Supabase / MinIO / AWS S3 在任何平台上都被拒 ——
   * 「站点托管」之外的自定义存储全部用不了，属于适配 bug。
   *
   * 参考 Rin 的做法：S3 兼容存储只靠配置驱动（S3_ENDPOINT / S3_BUCKET /
   * S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY），不做平台绑定。
   * 所以这里默认放开任意 endpoint，任谁配对了凭证就能传。
   *
   * 只有站长明确想锁死时才设 S3_LOCK_TO_PLATFORM=true。
   */
  const lockToPlatform = (process.env.S3_LOCK_TO_PLATFORM ?? "").trim().toLowerCase() === "true";
  if (lockToPlatform) {
    const platform = detectPlatform();
    if (platform !== "local") {
      const host = new URL(endpoint).host.toLowerCase();
      if (platform === "cloudflare" && !host.includes("r2.cloudflarestorage.com")) {
        return bad(t("api.upload.platformR2Only"));
      }
      if (platform === "vercel" && !host.includes("backblazeb2.com")) {
        return bad(t("api.upload.platformB2Only", { platform: platformLabel(platform) }));
      }
    }
  } else {
    // 保持引用，避免 import 被 tree-shake 掉后误删（lint 也认这个用法）
    void detectPlatform;
    void platformLabel;
  }

  const kind = classify(contentType, filename);
  const limit =
    kind === "image" ? UPLOAD_LIMITS.image : kind === "video" ? UPLOAD_LIMITS.video : UPLOAD_LIMITS.other;
  if (size > limit) {
    return bad(
      t("api.upload.tooLarge", {
        kind:
          kind === "video"
            ? t("api.upload.kindVideo")
            : kind === "image"
              ? t("api.upload.kindImage")
              : t("api.upload.kindFile"),
        size: Math.round(limit / 1024 / 1024),
      }),
      413,
    );
  }

  // 简单限流：同 IP 1 分钟 30 次（有 Redis 时才生效）
  if (hasRedisConfig()) {
    try {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        request.headers.get("x-real-ip") ||
        "unknown";
      const redis = getRedis();
      const rlKey = KEYS.ratelimitUpload(ip);
      const hits = await redis.incr(rlKey);
      if (hits === 1) await redis.expire(rlKey, 60);
      if (hits > 30) return bad(t("api.upload.rateLimited"), 429);
    } catch {
      /* 限流失败不阻塞 */
    }
  }

  // object key：前缀 / 年 / 月 / uuid.扩展名
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = extOf(filename) || (kind === "video" ? "mp4" : kind === "image" ? "png" : "bin");
  const prefix = (cfg.prefix?.trim() || "agnes-chat").replace(/^\/+|\/+$/g, "");
  const key = `${prefix}/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;

  try {
    /**
     * 寻址风格（参考 Rin 的 S3_FORCE_PATH_STYLE）。
     *
     * 不配置时按 endpoint 自动推断：R2 / MinIO / 内网 IP 走 path-style，
     * AWS S3 / B2 / 阿里云 OSS 走 virtual-host。
     * 遇到自动判断不对的自建服务，可以用环境变量显式覆盖：
     *   S3_FORCE_PATH_STYLE=true   → 一律 path-style
     *   S3_FORCE_PATH_STYLE=false  → 一律 virtual-host
     */
    const forcePathStyle = (() => {
      const v = (process.env.S3_FORCE_PATH_STYLE ?? "").trim().toLowerCase();
      if (v === "true" || v === "1") return true;
      if (v === "false" || v === "0") return false;
      return undefined; // 交给 presignS3Put 自动推断
    })();

    const uploadUrl = await presignS3Put({
      endpoint,
      bucket: cfg.bucket.trim(),
      key,
      region: cfg.region.trim(),
      accessKeyId: cfg.accessKeyId.trim(),
      secretAccessKey: cfg.secretAccessKey.trim(),
      expiresIn: 900,
      forcePathStyle,
    });

    const publicBase = cfg.publicBaseUrl?.trim().replace(/\/+$/, "");
    /**
     * 没配自定义域名时，外链拼法必须和签名用的寻址风格一致 ——
     * 否则签名走 virtual-host、外链却是 path-style（或反过来），
     * 结果上传成功但链接打不开，极难排查。
     */
    const publicUrl = publicBase
      ? `${publicBase}/${key}`
      : // 七牛：签名走 path-style，但公开外链必须用「空间域名」风格
        // https://<空间名称>.s3.<region>.qiniucs.com/<key>
        endpoint.includes("qiniucs.com")
        ? (() => {
            const u = new URL(endpoint);
            return `https://${cfg.bucket.trim()}.${u.host}/${key}`;
          })()
        : forcePathStyle === false
        ? (() => {
            const u = new URL(endpoint);
            return `${u.protocol}//${cfg.bucket.trim()}.${u.host}/${key}`;
          })()
        : `${endpoint}/${cfg.bucket.trim()}/${key}`;

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      key,
      safeName: safeName(filename),
      kind,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : t("api.upload.signError");
    return bad(t("api.upload.signFailed", { msg }), 500);
  }
}
