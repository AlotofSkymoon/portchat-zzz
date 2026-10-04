import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import {
  getApply,
  getMembership,
  grantMembership,
  isTier,
  listApplies,
  revokeMembership,
  setMembership,
  updateApply,
} from "@/lib/membership";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/membership —— 待审核申请 + 已开通会员 */
export async function GET(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 403;
    return NextResponse.json(
      { error: serverT(request, status === 401 ? "err.loginRequired" : "err.adminOnly") },
      { status },
    );
  }

  const [pending, handled, all] = await Promise.all([
    listApplies({ status: "pending" }),
    listApplies({ status: "approved" }),
    listApplies(),
  ]);

  // 已开通会员：从申请单里取 userId，再逐个读会员记录
  const ids = Array.from(new Set(all.map((a) => a.userId)));
  const members = [];
  for (const userId of ids) {
    const m = await getMembership(userId);
    if (m) members.push(m);
  }
  members.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

  return NextResponse.json({
    pending,
    approved: handled.slice(0, 50),
    members,
    adminId: admin.id,
  });
}

/**
 * POST /api/admin/membership
 *   { action: "approve", id }            通过并开通
 *   { action: "reject",  id, reason }    驳回
 *   { action: "revoke",  userId }        卸下会员（不封禁）
 *   { action: "ban",     userId, reason }封禁（连带卸下）
 *   { action: "unban",   userId }        解除封禁
 */
export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 403;
    return NextResponse.json(
      { error: serverT(request, status === 401 ? "err.loginRequired" : "err.adminOnly") },
      { status },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    userId?: string;
    reason?: string;
    tier?: string;
    plan?: string;
  };

  /* ---------------- 申请单：通过 / 驳回 ---------------- */
  if (body.action === "approve" || body.action === "reject") {
    if (!body.id) {
      return NextResponse.json(
        { error: serverT(request, "membership.missingId"), code: "MISSING_ID" },
        { status: 400 },
      );
    }

    const apply = await getApply(body.id);
    if (!apply) {
      return NextResponse.json(
        { error: serverT(request, "membership.applyNotFound"), code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    if (apply.status !== "pending") {
      return NextResponse.json(
        { error: serverT(request, "membership.alreadyHandled"), code: "HANDLED" },
        { status: 409 },
      );
    }

    if (body.action === "reject") {
      await updateApply(body.id, {
        status: "rejected",
        handledAt: Date.now(),
        handledBy: admin.id,
        reason: body.reason || "",
      });
      return NextResponse.json({ ok: true });
    }

    // 站长可以在通过时改档位/方式（比如用户多转了钱）
    const tier = isTier(body.tier) ? body.tier : apply.tier;
    const plan =
      body.plan === "monthly" || body.plan === "yearly" || body.plan === "once"
        ? body.plan
        : apply.plan;

    const m = await grantMembership({
      userId: apply.userId,
      email: apply.email,
      tier,
      plan,
    });

    await updateApply(body.id, {
      status: "approved",
      handledAt: Date.now(),
      handledBy: admin.id,
    });

    return NextResponse.json({ ok: true, membership: m });
  }

  /* ---------------- 会员：卸下 / 封禁 / 解封 ---------------- */
  if (body.action === "revoke" || body.action === "ban" || body.action === "unban") {
    const userId = body.userId;
    if (!userId) {
      return NextResponse.json(
        { error: serverT(request, "membership.missingUser"), code: "MISSING_USER" },
        { status: 400 },
      );
    }

    // 不能对自己动手（否则站长可能把自己锁在后台外面）
    if (userId === admin.id) {
      return NextResponse.json(
        { error: serverT(request, "membership.cannotActOnSelf"), code: "SELF" },
        { status: 400 },
      );
    }

    const cur = await getMembership(userId);
    if (!cur) {
      return NextResponse.json(
        { error: serverT(request, "membership.notAMember"), code: "NOT_MEMBER" },
        { status: 404 },
      );
    }

    let next;
    if (body.action === "unban") {
      next = await setMembership({ ...cur, banned: false, banReason: undefined });
    } else {
      next = await revokeMembership(userId, {
        ban: body.action === "ban",
        reason: body.reason || serverT(request, "membership.defaultBanReason"),
      });
    }

    return NextResponse.json({ ok: true, membership: next });
  }

  return NextResponse.json(
    { error: serverT(request, "membership.unknownAction"), code: "UNKNOWN_ACTION" },
    { status: 400 },
  );
}
