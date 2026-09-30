import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { checkIp, clientIpFromHeaders, ipGuardStatus } from "@/lib/ip-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ip-guard —— 自检接口：报告当前访问者会被判定成什么。
 *
 * ⚠️ 它只"报告"，不拦截 —— 真正的拦截在 middleware.ts 里完成
 * （代理直接返回 403，绕过不了）。这个接口存在的意义是：
 * 被 403 拦住时人看不到原因，而这里能看出是没配 token、
 * 接口失败、还是真的被判成代理。
 *
 * `signals` 字段是排查「为什么没拦住」的关键：
 * 逐条列出每个信号命中与否、得了几分、以及没生效的原因。
 * 常见情况举例：
 *   - 所有信号 ok:false     → 一个数据源都没配，检测压根没跑
 *   - points=1 threshold=2  → 只命中一条，按设计不拦截
 *   - tor ok:false          → 出口名单没拉到
 *
 * 字段刻意收敛：不下发完整风险画像（付费数据），只给判定结论与少量依据。
 * IP 会回显，因为排查时需要知道被识别成了哪个地址。
 */
export async function GET(request: Request) {
  const ip = clientIpFromHeaders(request.headers);

  // 管理员不拦：站长若自己开着代理，不该把自己锁在门外
  let isAdmin = false;
  try {
    const user = await getCurrentUser();
    isAdmin = user?.role === "admin";
  } catch {
    isAdmin = false;
  }

  const verdict = await checkIp(ip, isAdmin, request.headers);

  return NextResponse.json(
    {
      allowed: verdict.allowed,
      reason: verdict.reason,
      ip: verdict.ip,
      relay: verdict.relay,
      score: verdict.score,
      behaviors: verdict.behaviors,
      usageType: verdict.usageType,
      // 打分明细
      points: verdict.points,
      threshold: verdict.threshold,
      activeSignals: verdict.activeSignals,
      signals: verdict.signals.map((s) => ({
        name: s.name,
        hit: s.hit,
        points: s.points,
        detail: s.detail,
        // 信号源是否真的给出了结论；false 表示未配置 / 超时 / 报错
        ok: s.ok,
        note: s.note,
      })),
      // 没真检测 = 没配数据源，此时一切访问都会放行
      status: ipGuardStatus(),
      cached: verdict.cached,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
