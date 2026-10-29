import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { createOrder } from "@/lib/sponsor-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单笔充值的上下限（元） —— 下限防垃圾单，上限防填错金额 */
export const RECHARGE_MIN = 1;
export const RECHARGE_MAX = 500;

/** 同一用户每小时最多发起多少笔充值 */
const LIMIT_PER_HOUR = 10;

/**
 * POST /api/wallet/recharge —— 发起一笔充值。
 *
 * 走的还是收款码 + 交易号核销那一套（见 lib/sponsor-pay.ts），
 * 只是订单的 purpose 标成 recharge —— 审核通过后钱进本人余额，
 * 而不是变成一笔赞助。
 *
 * ⚠️ 金额为什么限制两位小数：
 * 收款码是人工核对的，出现 12.345 这种金额站长根本没法对账。
 */
export async function POST(request: Request) {
  const t = (k: string) => serverT(request, k);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  let body: { amount?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: t("wallet.amountInvalid") }, { status: 400 });
  }

  const yuan = Number(body?.amount);
  if (!Number.isFinite(yuan) || yuan < RECHARGE_MIN || yuan > RECHARGE_MAX) {
    return NextResponse.json({ error: t("wallet.amountInvalid") }, { status: 400 });
  }
  // 超过两位小数一律拒绝，不四舍五入 —— 让付款人自己填一个干净的数
  if (Math.round(yuan * 100) !== yuan * 100) {
    return NextResponse.json({ error: t("wallet.amountInvalid") }, { status: 400 });
  }

  try {
    const k = `wallet:ratelimit:recharge:${user.id}`;
    const n = await getRedis().incr(k);
    if (n === 1) await getRedis().expire(k, 60 * 60);
    if (n > LIMIT_PER_HOUR) {
      return NextResponse.json({ error: t("wallet.tooMany") }, { status: 429 });
    }
  } catch {
    // 限流失败不拦正常充值
  }

  try {
    const order = await createOrder(null, null, {
      purpose: "recharge",
      userId: user.id,
      // 充值走线下渠道核销；Pot Pay 余额本身就来自这一步，不存在「用余额充余额」
      payMethod: "alipayhk",
      amount: yuan,
    });
    return NextResponse.json({
      id: order.id,
      token: order.token,
      amount: order.amount,
      currency: order.currency,
      purpose: order.purpose,
      path: `/sponsor/pay?o=${order.id}`,
    });
  } catch {
    return NextResponse.json({ error: t("wallet.createFailed") }, { status: 500 });
  }
}
