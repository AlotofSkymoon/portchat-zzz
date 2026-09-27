import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getRedis, hasRedisConfig,
  storageErrorMessage, KEYS, listUserKeys, readUserRecord, getValue } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UserLite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

/** GET /api/admin/stats —— 站点统计（仅管理员） */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }

    const redis = getRedis();
    const users = await Promise.all(
      (await listUserKeys()).map(async (k) => await readUserRecord<UserLite>(k)),
    );
    const list = users.filter((u): u is UserLite => Boolean(u?.id));

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const today = list.filter((u) => now - new Date(u.createdAt).getTime() < day).length;
    const week = list.filter((u) => now - new Date(u.createdAt).getTime() < day * 7).length;

    // 计数器（注册时 INCR 出来的序号，代表历史累计注册数）
    const seqRaw = await getValue<unknown>(KEYS.usersCount);
    const seq = Number(seqRaw ?? list.length) || list.length;

    const messagesRaw = await getValue<unknown>(KEYS.statMessages);
    const messages = Number(messagesRaw ?? 0) || 0;

    return NextResponse.json({
      stats: {
        users: list.length,
        admins: list.filter((u) => u.role === "admin").length,
        registered: seq,
        today,
        week,
        messages,
      },
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) return NextResponse.json({ error: st(request, "err.loginFirst") }, { status: 401 });
    if (status === 403) return NextResponse.json({ error: st(request, "err.adminOnly") }, { status: 403 });
    return NextResponse.json({ error: st(request, "err.serverError") }, { status: 500 });
  }
}
