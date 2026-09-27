import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getCloudflareEnv, hasR2Binding } from "@/lib/storage";
import { discoverR2Bucket, r2BucketName, r2PublicHost } from "@/lib/s3-server";
import { credentialStatus } from "@/lib/cf-credentials";
import { serverT } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/upload/discover-r2 —— 自动定位 R2 桶。
 *
 * ⚠️ 之前这个接口**只会**去调 Cloudflare API，于是没配 API 令牌时
 * 一律报"缺少 CLOUDFLARE_API_TOKEN"。但其实绝大多数情况下根本不需要调 API：
 *
 * 桶只要在 wrangler.jsonc 里绑定了，Worker 就已经能直接读写它了 ——
 * 权限来自 binding，跟 API 令牌毫无关系。
 * 用户点了"自动寻找"却被告知"没有 API key"，完全是自找麻烦。
 *
 * 所以现在分三级：
 *
 *   1. **有 R2 binding** → 直接用，零配置（最常见，界面部署默认如此）
 *   2. **有 API 令牌**   → 调 API 列出账户下的桶，按名字匹配
 *   3. **都没有**        → 明确告诉用户走哪条路能解决
 */
export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: t("api.admin.forbidden") }, { status: 403 });

  let body: { bucket?: string };
  try {
    body = (await request.json()) as { bucket?: string };
  } catch {
    return NextResponse.json({ error: t("api.badRequest") }, { status: 400 });
  }

  const wanted = body.bucket?.trim() || r2BucketName() || "";

  /* ---- 第 1 级：R2 binding（不需要任何密钥） ---- */
  if (hasR2Binding()) {
    const env = getCloudflareEnv();
    void env; // binding 存在即可用

    return NextResponse.json({
      found: true,
      // binding 模式下桶名以 wrangler.jsonc 为准；用户填的名字仅作参考
      bucket: wanted || "agnes-chat",
      endpoint: "",
      publicBaseUrl: r2PublicHost(),
      /**
       * 关键标记：告诉前端"走 binding 直传"。
       * 此时 endpoint 为空是正常的 —— 不需要拼 S3 地址，
       * 上传走 /api/upload/direct，读取走 /api/r2/<key>。
       */
      mode: "binding",
      noCredentialsNeeded: true,
      message:
        t("api.upload.r2AlreadyBound"),
    });
  }

  /* ---- 第 2 级：调 Cloudflare API 查找 ---- */
  const creds = credentialStatus();
  if (creds.token.present) {
    const result = await discoverR2Bucket(wanted);
    return NextResponse.json(
      { ...result, mode: "api" },
      { status: result.found ? 200 : 404 },
    );
  }

  /* ---- 第 3 级：都没有，给出可操作的指引 ---- */
  const platform =
    process.env.CF_PAGES === "1" || (getCloudflareEnv() ? true : false)
      ? "cloudflare"
      : "other";

  return NextResponse.json(
    {
      found: false,
      bucket: "",
      endpoint: "",
      publicBaseUrl: "",
      mode: "none",
      error:
        t("api.upload.r2NoBindingNoToken") +
        (platform === "cloudflare"
          ? t("api.upload.r2BindHint")
          : t("api.upload.r2NotWorkers")),
      hint:
        t("api.upload.r2Easiest"),
    },
    { status: 404 },
  );
}
