import { NextResponse } from "next/server";

import { getRedis, hasRedisConfig,
  storageErrorMessage, KEYS, getValue,
  getJsonValue} from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface Announcement {
  text: string;
  enabled: boolean;
  updatedAt: number;
}

/** GET /api/announcement —— 公开读取站点公告（首页展示） */
export async function GET(request: Request) {
  try {
    if (hasRedisConfig()) {
      const data = await getJsonValue<Announcement>(KEYS.announcement);
      if (data && data.enabled && data.text) {
        return NextResponse.json({ announcement: data });
      }
    }
  } catch {
    /* 忽略 */
  }
  return NextResponse.json({ announcement: null });
}

/** POST /api/announcement —— 设置公告（仅管理员） */
export async function POST(request: Request) {
  try {
    const { requireAdmin } = await import("@/lib/auth");
    await requireAdmin();
    if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

    const body = (await request.json()) as { text?: string; enabled?: boolean };
    const payload: Announcement = {
      text: (body.text ?? "").slice(0, 200),
      enabled: Boolean(body.enabled),
      updatedAt: Date.now(),
    };
    const redis = getRedis();
    await redis.set(KEYS.announcement, JSON.stringify(payload));
    return NextResponse.json({ ok: true, announcement: payload });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return NextResponse.json({ error: st(request, "err.loginFirst") }, { status: 401 });
    if (status === 403) return NextResponse.json({ error: st(request, "err.adminOnly") }, { status: 403 });
    return NextResponse.json({ error: st(request, "err.serverError") }, { status: 500 });
  }
}
