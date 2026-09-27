import { NextResponse } from "next/server";

import { getR2Bucket } from "@/lib/storage/binding";
import { serverT } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/r2/<...key> —— 用 binding 读取 R2 对象。
 *
 * ⚠️ 必须是 catch-all（`[...key]`）而不是单段 `[key]`：
 * 对象 key 形如 `agnes-chat/1699999999-ab12cd-photo.jpg`，**含斜杠**。
 * 用 `[key]` 的话 Next.js 只会匹配单段，多出来的部分直接 404 ——
 * 于是探测失败、图片被退回 base64、base64 太长 AI 又解析不了。
 * 症状是"明明配了 R2 却还是看不见图"，非常难查，这个坑已经踩过一次。
 *
 * 路由存在的意义：桶没开"公开读"时外部访问不了 r2.dev 域名，
 * 但 Worker 通过 binding 照样能读到，所以让读取也走一遍 Worker ——
 * **不需要把桶设成公开，也不需要任何密钥**。
 *
 * 配了 S3_ACCESS_HOST 自定义域时，前端会直接用那个域名，不走这里。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const t = (k: string, vars?: Record<string, string | number>) => serverT(request, k, vars);

  // 与上传同一套获取逻辑，避免"能传不能读"或"能读不能传"
  const bucket = await getR2Bucket();

  if (!bucket) {
    return NextResponse.json({ error: t("api.r2.noBinding") }, { status: 503 });
  }

  const { key: segs } = await params;
  const key = (segs ?? []).join("/");
  if (!key) return NextResponse.json({ error: t("api.r2.missingKey") }, { status: 400 });

  // 防目录穿越
  if (key.includes("..")) {
    return NextResponse.json({ error: t("api.r2.badPath") }, { status: 400 });
  }

  try {
    const obj = (await bucket.get(key)) as {
      body?: ReadableStream;
      httpMetadata?: { contentType?: string };
      size?: number;
    } | null;

    if (!obj?.body) {
      return NextResponse.json({ error: t("api.r2.notFound") }, { status: 404 });
    }

    return new NextResponse(obj.body as ReadableStream, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: t("api.r2.readFailed", { msg: err instanceof Error ? err.message : t("api.upload.unknownError") }) },
      { status: 500 },
    );
  }
}
