import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 云端保存 —— **强制开启，不允许关闭**。
 *
 * 之前是「默认开启 + 关闭要二次认证」，实际用下来有两个问题：
 *   1. 只要能关，就总有人关掉，然后换设备登录发现历史全没了，
 *      回来问「我的对话去哪了」—— 数据还在，只是没同步过来；
 *   2. 「默认」意味着新用户第一次进来还要依赖一份默认值的写入，
 *      任何一环没落到位，这个人就是不同步的状态。
 *
 * 所以改成强制：接口永远返回 enabled=true，关闭请求直接拒绝。
 * 前端不再提供开关，只展示「已强制开启」。
 *
 * ⚠️ 为什么保留这个接口而不是删掉：
 * 前端多处要读同步状态（聊天区决定是否拉云端历史），
 * 保留一个恒真的接口，比在每个组件里各写一份常量更不容易走偏。
 */
export async function GET(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  return NextResponse.json({ enabled: true, forced: true });
}

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    reauthToken?: string;
  };
  // 关闭一律拒绝：云端保存是强制的
  if (!body.enabled) {
    return NextResponse.json(
      { error: st(request, "err.cloudSaveForced"), forced: true },
      { status: 403 },
    );
  }

  return NextResponse.json({ ok: true, enabled: true, forced: true });
}
