import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import {
  CREDITS_ENABLED,
  COST_DEFAULT,
  COST_DEEPSEEK,
  COST_INKSTONE,
  MONTHLY_GRANT,
  POINTS_PER_UNIT,
  readCredits,
} from "@/lib/credits";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 查看自己的积分余额与计费规则 */
export async function GET(request: Request) {
  if (!CREDITS_ENABLED) {
    return NextResponse.json({ enabled: false });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: st(request, "err.loginRequired"), code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }

  const acc = await readCredits(user.id);

  return NextResponse.json({
    enabled: true,
    ...acc,
    rules: {
      monthlyGrant: MONTHLY_GRANT,
      costDefault: COST_DEFAULT,
      costInkstone: COST_INKSTONE,
      costDeepseek: COST_DEEPSEEK,
      pointsPerUnit: POINTS_PER_UNIT,
    },
  });
}
