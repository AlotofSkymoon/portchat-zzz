import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { configValue } from "@/lib/runtime-config";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/preset-key
 * 只有 role=admin 能拿到站点内置 Key 的完整值；其余情况一律 403。
 */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const key = configValue("PRESET_AGNES_API_KEY");
    return NextResponse.json({
      configured: Boolean(key),
      apiKey: key,
      masked: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : "",
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) return NextResponse.json({ error: st(request, "err.loginFirst") }, { status: 401 });
    if (status === 403) return NextResponse.json({ error: st(request, "err.adminOnlyView") }, { status: 403 });
    return NextResponse.json({ error: st(request, "err.serverError") }, { status: 500 });
  }
}
