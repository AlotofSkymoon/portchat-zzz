import { NextResponse } from "next/server";

import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { readQrToken } from "@/lib/qr-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 生成二维码的那台设备轮询这个接口，等对方扫完。
 *
 * 返回 pending（还没人扫）/ claimed（已兑换，令牌已销毁）/ expired。
 * 因为令牌兑换后就被删了，读不到记录就等于「已完成」——
 * 不额外存状态字段，省一次写也避免状态不一致。
 */
export async function GET(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }
    const { searchParams } = new URL(request.url);
    const id = (searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ status: "expired" as const });

    const record = await readQrToken(id);
    return NextResponse.json({ status: record ? ("pending" as const) : ("claimed" as const) });
  } catch {
    return NextResponse.json({ status: "expired" as const });
  }
}
