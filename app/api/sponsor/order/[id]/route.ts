import { NextResponse } from "next/server";

import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { getOrder, markScanned } from "@/lib/sponsor-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 付款页读订单。
 *
 * ⚠️ 公开接口，但要**知道 id 才能读到** —— id 是 8 字节随机数，不可枚举。
 *
 * ⚠️ 只回传付款页需要展示的字段，不外泄审核结论与管理员备注：
 * 付款人不该提前知道自己这笔被判可疑（否则会反复换号重试）。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const order = await getOrder(id).catch(() => null);
  if (!order) {
    return NextResponse.json({ error: "订单不存在或已过期" }, { status: 404 });
  }

  return NextResponse.json({
    id: order.id,
    token: order.token,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    scannedAt: order.scannedAt,
    claimedAt: order.claimedAt,
    // 已提交过就回显，付款人刷新页面不会以为没提交成功
    tradeNo: order.tradeNo,
  });
}

/**
 * 标记「已扫码」。
 *
 * 放在 POST 而不是 GET 里标记：GET 会被预取、爬虫、预览机器人触发，
 * 那样扫码时间就失去意义了。由付款页在浏览器里真正打开时才打这一下。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  try {
    const redis = getRedis();
    // 同一订单只记一次，重复刷新不写
    const k = `sponsor:scanned:${id}`;
    const n = await redis.incr(k);
    if (n === 1) {
      await redis.expire(k, 24 * 60 * 60);
      await markScanned(id);
    }
    return NextResponse.json({ ok: true });
  } catch {
    // 扫码标记失败不影响付款流程，只影响管理员看到的统计
    return NextResponse.json({ ok: false });
  }
}
