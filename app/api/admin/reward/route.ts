import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getReward, pendingList, saveReward } from "@/lib/reward";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 管理员发奖。
 *
 * GET  列出「待发奖」：本月 + 上月各一条，含榜首是谁、发了没。
 * POST 提交域名转移码 → 写奖励记录 → 获奖者那边立刻能下载 PDF。
 *
 * ⚠️ 管理员不参与获奖（pendingCandidate 里已经跳过 isAdmin），
 * 所以管理员自己刷榜也不会把域名发给管理员。
 */
export async function GET() {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  try {
    return NextResponse.json({ list: await pendingList() });
  } catch {
    return NextResponse.json({ error: "读取待发奖失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "需要管理员权限" }, { status: 403 });

  let body: {
    period?: string;
    transferCode?: string;
    domain?: string;
    note?: string;
    imageUrl?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const period = (body.period ?? "").slice(0, 7);
  const transferCode = (body.transferCode ?? "").trim();
  const domain = (body.domain ?? "").trim();
  const imageUrl = (body.imageUrl ?? "").trim();
  const note = (body.note ?? "").trim();

  if (!period) return NextResponse.json({ error: "缺少周期" }, { status: 400 });
  if (!transferCode) {
    return NextResponse.json({ error: "请填写域名转移码" }, { status: 400 });
  }

  // 不能重复发奖：已发过就拒绝，避免手滑把转移码改掉
  const existing = await getReward(period);
  if (existing) {
    return NextResponse.json({ error: "该周期已发过奖" }, { status: 409 });
  }

  const list = await pendingList();
  const entry = list.find((x) => x.period === period);
  const candidate = entry?.candidate;
  if (!candidate) {
    return NextResponse.json({ error: "该周期没有可发奖的对象" }, { status: 400 });
  }

  try {
    await saveReward({
      period,
      userId: candidate.subject,
      label: candidate.label ?? candidate.subject,
      count: candidate.count,
      transferCode,
      domain: domain || "（待管理员填写域名）",
      note,
      imageUrl,
      createdAt: Date.now(),
    });
    return NextResponse.json({
      ok: true,
      period,
      label: candidate.label ?? candidate.subject,
    });
  } catch {
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
