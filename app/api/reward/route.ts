import { NextResponse } from "next/server";

import { getCurrentSafeUser } from "@/lib/auth";
import { buildPdf, type PdfBlock } from "@/lib/pdf";
import { getReward } from "@/lib/reward";
import { REWARD_BITMAPS } from "@/lib/reward-assets";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { currentPeriod, previousPeriod } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 获奖者查看/下载自己的奖励。
 *
 * GET            → JSON（域名）
 * GET ?format=pdf → 恭喜函 PDF
 *
 * ⚠️ 只认当前登录者本人：转移码是敏感凭证，绝不能按 userId 参数下发，
 * 否则任何人改一下查询串就能拿到别人的域名。
 */

/** 转移码的最大字号（pt）—— 再大就会溢出 A4 的内容宽度 */
const CODE_MAX_SIZE = 96;
/** A4 内容宽度（595.28 - 56*2） */
const CONTENT_W = 483.28;
/** Courier 字符宽度 = 0.6em */
const MONO_ADVANCE = 0.6;

/**
 * 转移码字号：默认 96pt，字符多了就自动缩到刚好放得下。
 *
 * ⚠️ 不能写死 96 —— 转移码长度各家平台不一样（DNSHE 的通常 8–20 位），
 * 写死的话长码会被页面右边界截断，而 PDF 不会换行、也不会报错，
 * 只会静默少显示几个字符，那是最危险的一种错。
 */
function codeSize(code: string): number {
  const fit = (CONTENT_W * 0.96) / Math.max(1, code.length * MONO_ADVANCE);
  return Math.max(18, Math.min(CODE_MAX_SIZE, fit));
}

function domainSize(domain: string): number {
  const fit = (CONTENT_W * 0.9) / Math.max(1, domain.length * MONO_ADVANCE);
  return Math.max(10, Math.min(20, fit));
}

export async function GET(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const user = await getCurrentSafeUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const url = new URL(request.url);
  const wantPdf = url.searchParams.get("format") === "pdf";
  const lang = url.searchParams.get("lang") ?? "zh-CN";

  const periods = [currentPeriod(), previousPeriod()];
  let hit = null as Awaited<ReturnType<typeof getReward>>;
  for (const p of periods) {
    const r = await getReward(p);
    if (r && r.userId === user.id) {
      hit = r;
      break;
    }
  }

  if (!hit) {
    return NextResponse.json(
      { error: wantPdf ? "暂无可下载的奖励" : "本月还没有你的奖励" },
      { status: 404 },
    );
  }

  if (!wantPdf) {
    return NextResponse.json({
      period: hit.period,
      domain: hit.domain,
      count: hit.count,
    });
  }

  /**
   * 版面（自上而下）：
   *   贺词两行 → 隔开一行 → 转移码（超大标题）→ 域名 → 底部说明
   *
   * 中文/英文走预渲染位图（base14 字体没中文字形），
   * 转移码和域名是 ASCII，用 Courier 等宽绘制，居中位置可精确算出。
   */
  const art = REWARD_BITMAPS[lang] ?? REWARD_BITMAPS["zh-CN"];

  const blocks: PdfBlock[] = [
    { kind: "image", data: Buffer.from(art.head.data, "base64"), width: art.head.width, height: art.head.height, center: true, gap: 90 },
    // —— 隔开一行 ——
    { text: "TRANSFER CODE", size: 10, mono: true, center: true, gap: 44, color: [0.55, 0.58, 0.65] },
    { text: hit.transferCode, size: codeSize(hit.transferCode), mono: true, bold: true, center: true, gap: 8 },
    { text: hit.domain, size: domainSize(hit.domain), mono: true, bold: true, center: true, gap: 34 },
    { kind: "image", data: Buffer.from(art.foot.data, "base64"), width: art.foot.width, height: art.foot.height, center: true, gap: 30 },
    { text: hit.period, size: 9, mono: true, center: true, gap: 26, color: [0.6, 0.62, 0.68] },
  ];

  const pdf = buildPdf(blocks, { title: `Pot Monthly Champion ${hit.period}` });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="pot-award-${hit.period}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
