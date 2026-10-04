/**
 * 支付回调接收端。
 *
 * 三种来源自动识别：
 *  - Antom / Alipay+：请求头带 signature / client-id / request-time
 *  - Alipay legacy：body 里带 sign + sign_type
 *  - 通用 HMAC（默认）：请求头 x-payment-signature 或 x-signature
 *
 * ⚠️ 未设置 PAYMENT_WEBHOOK_SECRET 时 POST 一律 503 ——
 * 宁可不开，也不能让任何人都能 POST 一下就给自己开会员。
 */

import { NextResponse } from "next/server";

import {
  claimTx,
  extractAmount,
  extractCode,
  extractEmail,
  extractTxId,
  flatten,
  inferTierPlan,
  isPlan,
  recordEvent,
  verifyAlipayLegacy,
  verifyAntom,
  verifyHmac,
} from "@/lib/payment-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function secret(): string {
  return (process.env.PAYMENT_WEBHOOK_SECRET ?? "").trim();
}

/** GET：健康检查，便于确认配置是否读到（不会泄露密钥本身） */
export async function GET() {
  const s = secret();
  const pub = (process.env.ALIPAY_PUB_KEY ?? "").trim();
  return NextResponse.json({
    ok: true,
    configured: s.length > 0,
    modes: {
      hmac: s.length > 0,
      alipayLegacy: pub.length > 0,
      antom: pub.length > 0,
    },
    hint: s.length
      ? "用 HMAC-SHA256 对 raw body 签名，放进 x-payment-signature 头"
      : "未设置 PAYMENT_WEBHOOK_SECRET，回调不可用",
  });
}

export async function POST(request: Request) {
  const s = secret();
  if (!s) {
    return NextResponse.json(
      { ok: false, error: "PAYMENT_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const raw = await request.text();
  const h = (n: string) => request.headers.get(n);
  const pubKey = (process.env.ALIPAY_PUB_KEY ?? "").trim();

  // body 可能是 JSON，也可能是 form-urlencoded（Alipay legacy 是后者）
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    const form: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(raw)) form[k] = v;
    payload = form;
  }
  const flat = flatten(payload ?? {});

  // ── 验签：三种来源自动识别 ─────────────────────────────
  let verified = false;
  let source = "hmac";

  const antomSig = h("signature");
  const antomClient = h("client-id");
  const antomTime = h("request-time");
  const legacySign = typeof flat.sign === "string" ? flat.sign : null;

  if (antomSig && antomClient && antomTime && pubKey) {
    source = "antom";
    verified = await verifyAntom({
      path: "/api/webhook/payment",
      clientId: antomClient,
      requestTime: antomTime,
      signature: antomSig,
      rawBody: raw,
      pubKeyPem: pubKey,
    });
  } else if (legacySign && pubKey) {
    source = "alipay-legacy";
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(flat)) {
      if (typeof v === "string") params[k] = v;
    }
    verified = await verifyAlipayLegacy(params, legacySign, pubKey);
  } else {
    verified = await verifyHmac(raw, h("x-payment-signature") ?? h("x-signature"), s);
  }

  if (!verified) {
    await recordEvent({
      source,
      ok: false,
      matched: "none",
      note: "signature verification failed",
    });
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  return await handle(payload, source);
}

async function handle(parsed: unknown, source: string) {
  const { isTier, grantMembership, listApplies, updateApply } = await import(
    "@/lib/membership"
  );
  const { getValue, KEYS } = await import("@/lib/redis");

  const txId = extractTxId(parsed) ?? `${source}_${Date.now()}`;
  const code = extractCode(parsed);
  const amount = extractAmount(parsed);
  const email = extractEmail(parsed);

  // 幂等：官方回调失败会重发 8 次，不去重会员会被反复续期
  const fresh = await claimTx(txId);
  if (!fresh) {
    await recordEvent({
      source,
      ok: true,
      txId,
      code,
      amount,
      matched: "none",
      note: "duplicate transaction, ignored",
    });
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const flat = flatten(parsed ?? {});
  const wantTier = isTier(flat.tier) ? flat.tier : undefined;
  const wantPlan = isPlan(flat.plan) ? flat.plan : undefined;

  // ── 1. 优先按会员号匹配待审申请单 ──────────────────────
  if (code) {
    const applies = await listApplies({ status: "pending" });
    const hit = applies.find((a) => a.code.toUpperCase() === code.toUpperCase());
    if (hit) {
      const tier = wantTier ?? hit.tier;
      const plan = wantPlan ?? hit.plan;
      const underpaid =
        amount !== undefined && amount + 0.01 < Number(hit.amount ?? 0);

      if (underpaid) {
        await recordEvent({
          source,
          ok: true,
          txId,
          code,
          amount,
          matched: "apply",
          userId: hit.userId,
          underpaid: true,
          note: `金额不足：收到 ${amount} 应收 ${hit.amount}`,
        });
        return NextResponse.json({ ok: true, underpaid: true, code, amount });
      }

      await grantMembership({ userId: hit.userId, email: hit.email, tier, plan });
      await updateApply(hit.id, {
        status: "approved",
        handledAt: Date.now(),
        handledBy: "webhook",
        reason: `webhook ${txId}`,
      });
      await recordEvent({
        source,
        ok: true,
        txId,
        code,
        amount,
        matched: "apply",
        userId: hit.userId,
        tier,
        plan,
      });
      return NextResponse.json({ ok: true, matched: "apply", code, tier, plan });
    }
  }

  // ── 2. 退而按邮箱反查用户 ──────────────────────────────
  if (email) {
    const uid = await getValue<string>(KEYS.userEmail(email));
    if (uid) {
      const guess = amount !== undefined ? inferTierPlan(amount) : null;
      const tier = wantTier ?? guess?.tier;
      const plan = wantPlan ?? guess?.plan;
      if (tier && plan) {
        await grantMembership({ userId: uid, email, tier, plan });
        await recordEvent({
          source,
          ok: true,
          txId,
          amount,
          matched: "email",
          userId: uid,
          tier,
          plan,
          note: code ? `会员号 ${code} 未匹配到待审单` : undefined,
        });
        return NextResponse.json({ ok: true, matched: "email", tier, plan });
      }
      await recordEvent({
        source,
        ok: true,
        txId,
        amount,
        matched: "none",
        userId: uid,
        note: "无法从金额推断档位，需人工处理",
      });
      return NextResponse.json({
        ok: true,
        matched: "none",
        reason: "cannot infer tier from amount",
      });
    }
  }

  // ── 3. 都没匹配上：仍然返回 200 ────────────────────────
  // 返回非 2xx 会触发官方重发 8 次，只会把日志刷爆。
  await recordEvent({
    source,
    ok: true,
    txId,
    code,
    amount,
    matched: "none",
    note: "未匹配到会员号或邮箱，需人工核对流水",
  });
  return NextResponse.json({ ok: true, matched: "none", code, amount });
}
