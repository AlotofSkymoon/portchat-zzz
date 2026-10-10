import { NextResponse } from "next/server";

import { getCurrentSafeUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import {
  chatLeaderboard,
  currentPeriod,
  modelLeaderboard,
  msUntilReset,
  myWorstVote,
  previousPeriod,
  voteWorstModel,
  worstLeaderboard,
} from "@/lib/stats";
import { getReward } from "@/lib/reward";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 统计与榜单。
 *
 * GET  返回本月三张榜：聊天次数 / 模型调用次数 / 最垃圾模型投票，
 *      外加「我投了谁」和距离下月 1 日重置还有多久。
 * POST 投票「最垃圾模型」（每人每月一票，改投自动把旧票减掉）。
 *
 * ⚠️ 为什么不用 zset：存储层只有 get/set/incr/keys。
 * 现规模下（每月几千 key）枚举前缀完全够用，不值得为此引入新依赖。
 */
export async function GET(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const period = (new URL(request.url).searchParams.get("period") || currentPeriod()).slice(0, 7);
  const user = await getCurrentSafeUser();

  try {
    const [chat, model, worst] = await Promise.all([
      chatLeaderboard(period, 10),
      modelLeaderboard(period, 20),
      worstLeaderboard(period, 20),
    ]);

    return NextResponse.json({
      period,
      previousPeriod: previousPeriod(),
      msUntilReset: msUntilReset(),
      chat,
      model,
      worst,
      myWorstVote: user ? await myWorstVote(user.id, period) : null,
      // 获奖信息只给本人看：有域名转移码，不能公开
      myReward: user ? await getRewardFor(user.id, period) : null,
    });
  } catch {
    return NextResponse.json({ error: "读取榜单失败" }, { status: 500 });
  }
}

/** 只回传「这个周期是不是本人获奖」，不含他人信息。 */
async function getRewardFor(userId: string, period: string) {
  try {
    const [cur, prev] = await Promise.all([
      getReward(period),
      getReward(previousPeriod()),
    ]);
    const hit = [cur, prev].find((r) => r && r.userId === userId);
    if (!hit) return null;
    return {
      period: hit.period,
      domain: hit.domain,
      note: hit.note,
      imageUrl: hit.imageUrl,
      count: hit.count,
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const user = await getCurrentSafeUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: { modelId?: string };
  try {
    body = (await request.json()) as { modelId?: string };
  } catch {
    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  }

  const modelId = (body.modelId ?? "").trim();
  if (!modelId) {
    return NextResponse.json({ error: "请选择模型" }, { status: 400 });
  }

  try {
    const res = await voteWorstModel(user.id, modelId);
    if (!res.ok) return NextResponse.json({ error: "投票失败" }, { status: 400 });
    return NextResponse.json({ ok: true, changed: res.changed });
  } catch {
    return NextResponse.json({ error: "投票失败" }, { status: 500 });
  }
}
