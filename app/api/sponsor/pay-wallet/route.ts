import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { createOrder, saveOrder } from "@/lib/sponsor-pay";
import { getTier, validateDomain } from "@/lib/sponsor-tiers";
import { debit, getBalanceFen, yuanToFen } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sponsor/pay-wallet —— 用 Pot Pay 余额付一笔赞助/代购。
 *
 * 与线下渠道（/api/sponsor/order）的区别：
 * 余额是本站在自己账本里已经确认收到的钱，所以**即时到账、无需核销**，
 * 订单直接置为 approved，不用再等 AI 审或站长点确认。
 *
 * ⚠️ 顺序是「先查余额 → 再建单 → 再扣款」：
 * 建单在前是为了让扣款流水能挂上订单号，
 * 而扣款前就要知道余额够不够 —— 不够的话不该凭空生成一笔待付款订单。
 */
export async function POST(request: Request) {
  const t = (k: string) => serverT(request, k);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  let body: { tier?: string; domain?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: t("wallet.payFailed") }, { status: 400 });
  }

  const tier = getTier(body.tier);
  if (!tier) return NextResponse.json({ error: t("wallet.payFailed") }, { status: 400 });

  let domain: string | null = null;
  if (tier.requiresDomain) {
    domain = validateDomain(body.domain ?? "", tier.tld);
    if (!domain) {
      return NextResponse.json({ error: t("tier.needDomain") }, { status: 400 });
    }
  }

  const fen = yuanToFen(tier.amount);
  const balance = await getBalanceFen(user.id).catch(() => 0);
  if (balance < fen) {
    return NextResponse.json(
      { error: t("wallet.insufficient"), balanceFen: balance, needFen: fen },
      { status: 402 },
    );
  }

  try {
    const order = await createOrder(tier.id, domain, {
      purpose: "sponsor",
      userId: user.id,
      payMethod: "potpay",
    });
    await debit(user.id, fen, { orderId: order.id, note: tier.labelKey });

    order.status = "approved";
    order.claimedAt = Date.now();
    order.tradeNo = `potpay:${order.id}`;
    order.adminNote = "Pot Pay 余额支付";
    order.reviewedAt = Date.now();
    await saveOrder(order);

    const left = await getBalanceFen(user.id).catch(() => 0);
    return NextResponse.json({ ok: true, orderId: order.id, balanceFen: left });
  } catch {
    return NextResponse.json({ error: t("wallet.payFailed") }, { status: 500 });
  }
}
