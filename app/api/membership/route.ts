import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import {
  type MemberApply,
  TIERS,
  TIER_ORDER,
  createApply,
  getActiveMembership,
  getMembership,
  isTier,
  listApplies,
  newApplyId,
  newMemberCode,
  priceOf,
  supportsPlan,
} from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 档位价格表（前端展示用，随 GET 一起返回）
 *
 * 注意：不要 export。Next.js 对 route 文件有「只允许导出 handler / 配置常量」的
 * 类型约束，导出额外的具名常量会让 .next/types 里的校验失败（TS2344）。
 */
const TIER_PLANS = TIER_ORDER.map((tier) => ({
  tier,
  nameKey: TIERS[tier].nameKey,
  plans: (["monthly", "yearly", "once"] as const)
    .filter((p) => supportsPlan(tier, p))
    .map((p) => ({ plan: p, price: priceOf(tier, p) })),
}));

/** GET /api/membership —— 查看自己的会员状态与可选档位 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: serverT(request, "err.loginRequired"), code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }

  const raw = await getMembership(user.id);
  const active = await getActiveMembership(user.id);
  const applies = await listApplies({ userId: user.id });

  return NextResponse.json({
    isMember: Boolean(active),
    tier: active?.tier ?? null,
    expiresAt: active?.expiresAt ?? null,
    banned: raw?.banned ?? false,
    banReason: raw?.banned ? raw.banReason ?? "" : undefined,
    tiers: TIER_PLANS,
    applies: applies.slice(0, 10).map((a) => ({
      id: a.id,
      code: a.code,
      tier: a.tier,
      plan: a.plan,
      amount: a.amount,
      status: a.status,
      createdAt: a.createdAt,
      reason: a.reason,
    })),
  });
}

/** POST /api/membership —— 提交开通申请（站长在 App 核对后后台通过） */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: serverT(request, "err.loginRequired"), code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }

  // 封禁用户不能申请
  const raw = await getMembership(user.id);
  if (raw?.banned) {
    return NextResponse.json(
      { error: serverT(request, "membership.banned"), code: "BANNED" },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    tier?: string;
    plan?: string;
  };

  if (!isTier(body.tier)) {
    return NextResponse.json(
      { error: serverT(request, "membership.invalidTier"), code: "INVALID_TIER" },
      { status: 400 },
    );
  }

  const plan =
    body.plan === "monthly" || body.plan === "yearly" || body.plan === "once"
      ? body.plan
      : null;
  if (!plan || !supportsPlan(body.tier, plan)) {
    return NextResponse.json(
      { error: serverT(request, "membership.invalidPlan"), code: "INVALID_PLAN" },
      { status: 400 },
    );
  }

  // 同一用户同一档位同一方式，已有待审核的就不让重复提交
  const pending = await listApplies({ userId: user.id, status: "pending" });
  const dup = pending.find((a) => a.tier === body.tier && a.plan === plan);
  if (dup) {
    return NextResponse.json(
      {
        error: serverT(request, "membership.duplicateApply"),
        code: "DUPLICATE",
        apply: { id: dup.id, code: dup.code },
      },
      { status: 409 },
    );
  }

  const apply: MemberApply = {
    id: newApplyId(),
    code: newMemberCode(),
    userId: user.id,
    email: user.email ?? "",
    tier: body.tier,
    plan,
    amount: priceOf(body.tier, plan),
    status: "pending",
    createdAt: Date.now(),
  };

  await createApply(apply);

  return NextResponse.json({
    ok: true,
    apply: {
      id: apply.id,
      code: apply.code,
      tier: apply.tier,
      plan: apply.plan,
      amount: apply.amount,
      status: apply.status,
    },
  });
}
