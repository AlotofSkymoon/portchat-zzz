import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { formatFen, getBalanceFen, listLedger } from "@/lib/wallet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wallet —— 读取本人的 Pot Pay 余额与流水。
 *
 * ⚠️ 只返回本人的：userId 一律取自会话，不接受客户端传参，
 * 否则任何人都能查别人的余额。
 */
export async function GET(request: Request) {
  const t = (k: string) => serverT(request, k);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const [balanceFen, ledger] = await Promise.all([
    getBalanceFen(user.id).catch(() => 0),
    listLedger(user.id).catch(() => []),
  ]);

  return NextResponse.json({
    balanceFen,
    balance: formatFen(balanceFen),
    ledger,
  });
}
