import { NextResponse } from "next/server";

import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { createOrder } from "@/lib/sponsor-pay";
import { getTier, validateDomain } from "@/lib/sponsor-tiers";

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

  /*
   * 档位与域名。
   *
   * 不传就按纯赞助档处理（老客户端 / 直接 curl 上来也不会 500）。
   * 代购档必须带上域名，且后缀要与档位一致 ——
   * .xyz 的价买不到 .top，档位和后辍对不上就是一笔说不清的账。
   */
  let body: { tier?: string; domain?: string; payMethod?: string } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    // 空 body 是合法的，按默认档处理
  }

  const tier = getTier(body.tier);
  if (body.tier && !tier) {
    return NextResponse.json({ error: "档位不存在" }, { status: 400 });
  }

  let domain: string | null = null;
  if (tier?.requiresDomain) {
    domain = validateDomain(body.domain ?? "", tier.tld);
    if (!domain) {
      return NextResponse.json({ error: "请填写要代购的域名" }, { status: 400 });
    }
  }

  /*
   * Pot Pay 余额支付不能走这个接口：
   * 余额付款是即时扣款、不需要核销，走的是 /api/sponsor/pay-wallet。
   * 这里只负责线下渠道（建单 → 扫码付款 → 回填交易号）。
   */
  if ((body.payMethod ?? "").trim() === "potpay") {
    return NextResponse.json({ error: "余额支付请改用 /api/sponsor/pay-wallet" }, { status: 400 });
  }

  try {
    const order = await createOrder(tier?.id ?? null, domain, {
      payMethod: (body.payMethod ?? "").trim() || null,
    });
    return NextResponse.json({
      id: order.id,
      token: order.token,
      tier: order.tier,
      amount: order.amount,
      currency: order.currency,
      domain: order.domain,
      // 只给路径，由页面拼自己的 origin —— 避免反代下拿到错误的域名
      path: `/sponsor/pay?o=${order.id}`,
    });
  } catch {
    return NextResponse.json({ error: "创建订单失败" }, { status: 500 });
  }
}
