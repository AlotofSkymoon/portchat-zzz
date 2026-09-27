import { NextResponse } from "next/server";

import { getR2Bucket } from "@/lib/storage/binding";
import { r2PublicHost } from "@/lib/s3-server";
import { serverT } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/upload/direct —— 通过 R2 binding 直传，**不需要 AK/SK**。
 *
 * 为什么要有这条路：
 * Worker 一旦在 wrangler.jsonc 里绑定了 R2，权限就来自 binding 本身 ——
 * 桶是用户自己的，Worker 天然拥有读写权，再要一对 Access Key 纯属多余。
 *
 * 比预签名上传更好的地方：
 *   - 不用配任何密钥
 *   - 不把 endpoint / 桶名暴露给浏览器
 *   - 文件经 Worker 落 R2，便于统一做体积与类型校验
 *
 * ⚠️ 代价：文件要经过 Worker，受请求体上限约束（免费版 100MB）。
 *    超大文件仍应走 /api/upload/presign 的预签名直传。
 */

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function safeName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-80);
  return cleaned || "file";
}

export async function POST(request: Request) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  /**
   * 统一走 getR2Bucket() —— 它内部依次尝试：
   *   OpenNext 官方 API → 注入的 override → globalThis 扫描
   *
   * 以前这里直接用 getCloudflareEnv() + pickBinding()，只覆盖第三条路，
   * 于是在 Workers 上出现「设置面板显示已绑定、一上传却报没有绑定」的矛盾。
   */
  const bucket = await getR2Bucket();

  if (!bucket) {
    return bad(
      t("api.upload.noR2"),
      503,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad(t("api.upload.needMultipart"));
  }

  const file = form.get("file");
  const rawName = String(form.get("filename") ?? "");
  const prefix = String(form.get("prefix") ?? "agnes-chat").trim() || "agnes-chat";

  if (!(file instanceof File)) return bad(t("api.upload.noFile"));

  const contentType = file.type || "application/octet-stream";
  // 同一文件名会互相覆盖，加时间戳 + 随机串区分
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `${prefix}/${stamp}-${rand}-${safeName(rawName || file.name)}`;

  try {
    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType },
    });
  } catch (err) {
    return bad(
      t("api.upload.writeFailed", { msg: err instanceof Error ? err.message : t("api.upload.unknownError") }),
      500,
    );
  }

  /**
   * 公开 URL 的拼法 —— **必须是绝对 URL**。
   *
   * ⚠️ 这里曾经返回相对路径 `/api/r2/xxx`，结果 AI 完全读不到图：
   * 前端把 content 原样塞进 `image_url.url` 发给上游，
   * 而上游服务器不知道本站域名，相对路径对它毫无意义。
   * 表现为"明明配了 R2、上传也成功，AI 还是看不见图"。
   *
   * 所以这里用请求的 origin 拼成绝对地址：
   * 1. 配了 S3_ACCESS_HOST / R2_PUBLIC_BASE_URL 自定义域 → 用它
   * 2. 否则走同源的 /api/r2/<key> 代理（桶不用开公开读）
   */
  const host = r2PublicHost().replace(/\/+$/, "");
  const origin = new URL(request.url).origin;
  const publicUrl = host ? `${host}/${key}` : `${origin}/api/r2/${key}`;

  return NextResponse.json({
    ok: true,
    key,
    url: publicUrl,
    size: file.size,
    contentType,
    via: "r2-binding",
  });
}
