import { NextResponse } from "next/server";

import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { getOrder, looksLikeTradeNo, saveOrder } from "@/lib/sponsor-pay";
import { reviewOrder } from "@/lib/sponsor-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 同一 IP 每小时最多提交多少次交易号 */
const CLAIM_LIMIT_PER_HOUR = 30;

/**
 * 付款人提交交易号。
 *
 * 提交后立刻触发 AI 审核：
 * - 判 pass     → 订单自动置为 approved
 * - 判 suspicious → 留在 claimed，标红等管理员人工确认
 * - 审核不可用（没配 Key / 上游挂了）→ 同样留在 claimed 待人工
 *
 * ⚠️ 绝不因为 AI 判可疑就自动驳回 —— 误杀一笔真付款的代价太大。
 */
export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  let body: { id?: string; tradeNo?: string; contact?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const id = (body.id ?? "").trim();
  const tradeNo = (body.tradeNo ?? "").trim();
  const contact = (body.contact ?? "").trim().slice(0, 200);

  if (!id || id.length > 64) {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }
  if (!looksLikeTradeNo(tradeNo)) {
    return NextResponse.json({ error: "交易号格式不正确" }, { status: 400 });
  }

  const order = await getOrder(id).catch(() => null);
  if (!order) {
    return NextResponse.json({ error: "订单不存在或已过期" }, { status: 404 });
  }
  if (order.status === "approved") {
    return NextResponse.json({ error: "这笔订单已完成核销" }, { status: 409 });
  }

  // 限流：按 IP，防脚本刷单
  try {
    const redis = getRedis();
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "unknown";
    const k = `sponsor:ratelimit:claim:${ip}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, 60 * 60);
    if (n > CLAIM_LIMIT_PER_HOUR) {
      return NextResponse.json({ error: "提交过于频繁，请稍后再试" }, { status: 429 });
    }
  } catch {
    // 同上：限流失败不拦正常提交
  }

  order.tradeNo = tradeNo;
  order.contact = contact || null;
  order.claimedAt = Date.now();
  order.status = "claimed";
  // 换了一个交易号重新提交 → 上一轮的审核结论作废
  order.aiVerdict = null;
  order.aiReason = null;
  order.aiModel = null;
  order.reviewedAt = null;

  const result = await reviewOrder(order).catch(() => null);
  if (result) {
    order.aiVerdict = result.verdict;
    order.aiReason = result.reason;
    order.aiModel = `${result.provider} · ${result.model}`;
    order.reviewedAt = Date.now();
    if (result.verdict === "pass") order.status = "approved";
  }

  await saveOrder(order);

  /**
   * 回传给付款人的信息刻意含糊：
   * 通过就说"已确认"，可疑也说"已收到待确认"——
   * 不能让付款人知道自己的号被判可疑，否则他会反复换号试。
   */
  return NextResponse.json({
    ok: true,
    status: order.status,
    message:
      order.status === "approved" ? "已确认，感谢赞助！" : "已收到，等待站长确认",
  });
}
