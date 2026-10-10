import { NextResponse } from "next/server";

import { getCurrentSafeUser } from "@/lib/auth";
import { buildPdf } from "@/lib/pdf";
import { getReward } from "@/lib/reward";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { currentPeriod, previousPeriod } from "@/lib/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 获奖者查看/下载自己的奖励。
 *
 * GET            → JSON（域名、附言、图片）
 * GET ?format=pdf → 恭喜函 PDF
 *
 * ⚠️ 只认当前登录者本人：转移码是敏感凭证，绝不能按 userId 参数下发，
 * 否则任何人改一下查询串就能拿到别人的域名。
 */
export async function GET(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const user = await getCurrentSafeUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const wantPdf = new URL(request.url).searchParams.get("format") === "pdf";

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
      note: hit.note,
      imageUrl: hit.imageUrl,
      count: hit.count,
    });
  }

  const pdf = buildPdf(
    [
      { text: "Portchat Monthly Champion", size: 22, bold: true, gap: 40 },
      { text: "", size: 8, gap: 6 },
      { text: `Congratulations! You ranked #1 for ${hit.period}.`, size: 13, gap: 10 },
      { text: `Messages sent: ${hit.count}`, size: 13 },
      { text: "", size: 8, gap: 10 },
      { text: "Prize: a free second-level domain", size: 13, bold: true, gap: 8 },
      { text: `Domain: ${hit.domain}`, size: 14, bold: true },
      { text: `Transfer code: ${hit.transferCode}`, size: 14, bold: true },
      ...(hit.note ? [{ text: `Note: ${hit.note}`, size: 11 }] : []),
      ...(hit.imageUrl ? [{ text: `Image: ${hit.imageUrl}`, size: 11 }] : []),
      { text: "", size: 8, gap: 16 },
      { text: "Redeem it at your domain registrar. Enjoy!", size: 11 },
    ],
    { title: `Portchat Monthly Champion ${hit.period}` },
  );

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="portchat-award-${hit.period}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
