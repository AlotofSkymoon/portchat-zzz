import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  CREDITS_ENABLED,
  POINTS_PER_UNIT,
  createTopup,
  listTopups,
  newTopupId,
} from "@/lib/credits";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 查看自己提交过的充值申请 */
export async function GET(request: Request) {
  if (!CREDITS_ENABLED) return NextResponse.json({ enabled: false, items: [] });

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: st(request, "err.loginRequired"), code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }

  const items = await listTopups({ userId: user.id });
  return NextResponse.json({ enabled: true, items, pointsPerUnit: POINTS_PER_UNIT });
}

/**
 * 提交充值申请。
 *
 * ⚠️ 站点**不接支付回调** —— 收款码是静态的，AlipayHK 不会通知任何人。
 * 所以流程只能是：用户转账时填备注 → 回来提交申请 → 站长去 App 流水里
 * 核对这笔钱 → 后台点「通过」加分。
 *
 * 这是唯一能闭环的方式，代价是站长要手动点一下。
 */
export async function POST(request: Request) {
  if (!CREDITS_ENABLED) {
    return NextResponse.json(
      { error: st(request, "credits.disabled"), code: "CREDITS_DISABLED" },
      { status: 404 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: st(request, "err.loginRequired"), code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }

  let body: { amount?: number; note?: string };
  try {
    body = (await request.json()) as { amount?: number; note?: string };
  } catch {
    return NextResponse.json(
      { error: st(request, "err.badRequest"), code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    return NextResponse.json(
      { error: st(request, "credits.badAmount"), code: "BAD_AMOUNT" },
      { status: 400 },
    );
  }

  const note = String(body.note ?? "").trim().slice(0, 120);

  /**
   * 备注是**必要**的：站长在流水里要靠它认人。
   * 不填的话一堆无名转账根本对不上号，只能全驳回。
   */
  if (!note) {
    return NextResponse.json(
      { error: st(request, "credits.noteRequired"), code: "NOTE_REQUIRED" },
      { status: 400 },
    );
  }

  // 同一用户 10 分钟内不能重复提交，防手抖刷屏
  const recent = await listTopups({ userId: user.id, status: "pending" });
  if (recent.length >= 3) {
    return NextResponse.json(
      { error: st(request, "credits.tooManyPending"), code: "TOO_MANY_PENDING" },
      { status: 429 },
    );
  }

  const req = {
    id: newTopupId(),
    userId: user.id,
    email: user.email ?? "",
    amount: Math.round(amount * 100) / 100,
    points: Math.floor(amount * POINTS_PER_UNIT),
    note,
    status: "pending" as const,
    createdAt: Date.now(),
  };

  await createTopup(req);

  return NextResponse.json({ ok: true, request: req, pointsPerUnit: POINTS_PER_UNIT });
}
