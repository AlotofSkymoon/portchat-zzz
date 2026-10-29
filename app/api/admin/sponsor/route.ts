import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { getOrder, listOrders, saveOrder } from "@/lib/sponsor-pay";
import { reviewOrder } from "@/lib/sponsor-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 管理员的赞助订单面板。
 *
 * GET  列出全部订单（新在前）
 * POST 人工处理：approve / reject / reset / recheck（重新跑一次 AI 审核）
 *
 * ⚠️ 为什么可疑订单要"弹"在管理员面前：
 * 付款人提交后没人核销的话，这笔赞助等于白付 ——
 * 所以列表默认把「已提交待确认」（claimed）排在最前。
 */
export async function GET() {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  try {
    const list = await listOrders();
    // 待人工（claimed）优先，其次按时间倒序
    list.sort((a, b) => {
      const pa = a.status === "claimed" ? 0 : 1;
      const pb = b.status === "claimed" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });
    return NextResponse.json({ list });
  } catch {
    return NextResponse.json({ error: "读取订单失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  let body: { id?: string; action?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const id = (body.id ?? "").trim();
  const order = await getOrder(id).catch(() => null);
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const note = (body.note ?? "").trim().slice(0, 300) || null;

  switch (body.action) {
    case "approve":
      order.status = "approved";
      order.adminNote = note;
      order.reviewedAt = Date.now();
      break;
    case "reject":
      order.status = "rejected";
      order.adminNote = note;
      order.reviewedAt = Date.now();
      break;
    case "reset":
      // 打回待确认：保留交易号，清掉审核结论
      order.status = "claimed";
      order.adminNote = null;
      order.aiVerdict = null;
      order.aiReason = null;
      order.reviewedAt = null;
      break;
    case "recheck": {
      if (!order.tradeNo) {
        return NextResponse.json({ error: "该订单还没有交易号" }, { status: 400 });
      }
      const result = await reviewOrder(order).catch(() => null);
      if (!result) {
        return NextResponse.json(
          { error: "审核不可用：站点未配置可用的预设 Key，或上游请求失败" },
          { status: 502 },
        );
      }
      order.aiVerdict = result.verdict;
      order.aiReason = result.reason;
      order.aiModel = `${result.provider} · ${result.model}`;
      order.reviewedAt = Date.now();
      // 重新审核判 pass 时才自动通过，判可疑一律留人工
      if (result.verdict === "pass") order.status = "approved";
      break;
    }
    default:
      return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }

  await saveOrder(order);
  return NextResponse.json({ ok: true });
}
