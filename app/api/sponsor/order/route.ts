import { NextResponse } from "next/server";

import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { createOrder } from "@/lib/sponsor-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 同一 IP 每小时最多生成多少个收款码 */
const ORDER_LIMIT_PER_HOUR = 20;
const ORDER_LIMIT_WINDOW = 60 * 60;

/**
 * 新建赞助订单。
 *
 * 返回 id（进 URL）和 token（页面展示）。
 *
 * ⚠️ 为什么必须限流：
 * 每个订单都要往存储里写两条记录并进索引，不设上限的话
 * 一个脚本就能把索引撑到几十万条，管理员列表直接卡死。
 */
export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const redis = getRedis();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  try {
    const k = `sponsor:ratelimit:order:${ip}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, ORDER_LIMIT_WINDOW);
    if (n > ORDER_LIMIT_PER_HOUR) {
      return NextResponse.json({ error: "生成过于频繁，请稍后再试" }, { status: 429 });
    }
  } catch {
    // 限流本身失败不该拦住正常赞助
  }

  try {
    const order = await createOrder();
    return NextResponse.json({
      id: order.id,
      token: order.token,
      amount: order.amount,
      currency: order.currency,
      // 只给路径，由页面拼自己的 origin —— 避免反代下拿到错误的域名
      path: `/sponsor/pay?o=${order.id}`,
    });
  } catch {
    return NextResponse.json({ error: "创建订单失败" }, { status: 500 });
  }
}
