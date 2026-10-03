import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  CREDITS_ENABLED,
  POINTS_PER_UNIT,
  getTopup,
  grantCredits,
  listTopups,
  updateTopup,
} from "@/lib/credits";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出全部充值申请 */
export async function GET(request: Request) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "admin") {
    return NextResponse.json(
      { error: st(request, "err.adminOnly"), code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  const items = await listTopups();
  return NextResponse.json({ enabled: CREDITS_ENABLED, items, pointsPerUnit: POINTS_PER_UNIT });
}

/**
 * 审核充值申请。
 *
 * 站长在 AlipayHK / 支付宝 App 里核对到账后点通过。
 * points 可以手动改 —— 有时用户多转了一点，或者站长想送一点。
 */
export async function POST(request: Request) {
  const admin = await getCurrentUser();
  if (!admin || admin.role !== "admin") {
    return NextResponse.json(
      { error: st(request, "err.adminOnly"), code: "FORBIDDEN" },
      { status: 403 },
    );
  }

  let body: { id?: string; action?: "approve" | "reject"; points?: number; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: st(request, "err.badRequest"), code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const id = String(body.id ?? "").trim();
  const action = body.action;

  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { error: st(request, "err.badRequest"), code: "BAD_REQUEST" },
      { status: 400 },
    );
  }

  const req = await getTopup(id);
  if (!req) {
    return NextResponse.json(
      { error: st(request, "credits.notFound"), code: "NOT_FOUND" },
      { status: 404 },
    );
  }
  if (req.status !== "pending") {
    return NextResponse.json(
      { error: st(request, "credits.alreadyHandled"), code: "ALREADY_HANDLED" },
      { status: 409 },
    );
  }

  if (action === "reject") {
    const updated = await updateTopup(id, {
      status: "rejected",
      handledAt: Date.now(),
      handledBy: admin.email ?? admin.id,
      reason: String(body.reason ?? "").slice(0, 200),
    });
    return NextResponse.json({ ok: true, request: updated });
  }

  const points = Number.isFinite(body.points)
    ? Math.max(0, Math.floor(Number(body.points)))
    : req.points;

  const account = await grantCredits(req.userId, points);
  const updated = await updateTopup(id, {
    status: "approved",
    handledAt: Date.now(),
    handledBy: admin.email ?? admin.id,
    points,
  });

  return NextResponse.json({ ok: true, request: updated, account });
}
