import { NextResponse } from "next/server";

import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { getRedis, hasRedisConfig,
  storageErrorMessage, hgetAll, KEYS, listUserKeys, readUserRecord } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleError(request: Request, error: unknown) {
  const status = (error as { status?: number }).status;
  if (status === 401) return NextResponse.json({ error: st(request, "err.loginFirst") }, { status: 401 });
  if (status === 403) return NextResponse.json({ error: st(request, "err.adminOnly") }, { status: 403 });
  return NextResponse.json({ error: st(request, "err.serverError") }, { status: 500 });
}

/** GET /api/admin/users —— 用户列表（管理员） */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

    const redis = getRedis();
    const userKeys = await listUserKeys();

    const users = await Promise.all(
      userKeys.map(async (key) => {
        const u = await readUserRecord<Record<string, string>>(key);
        if (!u?.id) return null;
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt,
        };
      }),
    );

    const list = users
      .filter(Boolean)
      .sort((a, b) => String(a!.createdAt).localeCompare(String(b!.createdAt)));

    return NextResponse.json({ users: list });
  } catch (error) {
    return handleError(request, error);
  }
}

/** PATCH /api/admin/users —— 切换角色（管理员） */
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const { userId, role } = (await request.json()) as { userId?: string; role?: string };
    if (!userId || (role !== "admin" && role !== "user")) {
      return NextResponse.json({ error: st(request, "err.badParams") }, { status: 400 });
    }
    if (userId === admin.id && role !== "admin") {
      return NextResponse.json({ error: st(request, "err.cannotRemoveSelfAdmin") }, { status: 400 });
    }

    const redis = getRedis();
    const exists = await redis.exists(KEYS.user(userId));
    if (!exists) return NextResponse.json({ error: st(request, "err.userNotFound") }, { status: 404 });

    await redis.hset(KEYS.user(userId), { role });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(request, error);
  }
}

/** DELETE /api/admin/users?userId=xxx —— 删除用户（管理员） */
export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: st(request, "err.missingUserId") }, { status: 400 });
    if (userId === admin.id) return NextResponse.json({ error: st(request, "err.cannotDeleteSelf") }, { status: 400 });

    const redis = getRedis();
    const user = await hgetAll<{ email?: string }>(KEYS.user(userId));
    if (!user?.email) return NextResponse.json({ error: st(request, "err.userNotFound") }, { status: 404 });

    const pipeline = redis.pipeline();
    if (user.email) pipeline.del(KEYS.userEmail(user.email));
    pipeline.del(KEYS.user(userId));
    pipeline.del(KEYS.chatIndex(userId));
    await pipeline.exec();

    // 清掉该用户所有 session
    await import("@/lib/auth").then((m) => m.destroyAllSessionsOf(userId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(request, error);
  }
}
