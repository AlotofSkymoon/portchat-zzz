import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { DEFAULT_NAV, type NavCategory } from "@/lib/nav-data";
import { getRedis, hasRedisConfig,
  storageErrorMessage, KEYS, getValue } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(request: Request, error: unknown) {
  const status = (error as { status?: number }).status;
  if (status === 401) return NextResponse.json({ error: st(request, "err.loginFirst") }, { status: 401 });
  if (status === 403) return NextResponse.json({ error: st(request, "err.adminOnly") }, { status: 403 });
  return NextResponse.json({ error: st(request, "err.serverError") }, { status: 500 });
}

async function readNav(): Promise<NavCategory[]> {
  if (!hasRedisConfig()) return DEFAULT_NAV;
  const saved = await getValue<unknown>(KEYS.navData);
  if (saved && Array.isArray(saved) && saved.length) return saved as NavCategory[];
  return DEFAULT_NAV;
}

async function writeNav(data: NavCategory[]) {
  const redis = getRedis();
  await redis.set(KEYS.navData, JSON.stringify(data));
}

/** GET：读取当前导航数据（管理员） */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const categories = await readNav();
    return NextResponse.json({ categories, isCustom: categories !== DEFAULT_NAV });
  } catch (e) {
    return err(request, e);
  }
}

/** PUT：整表保存（前端已编辑好的分类数组） */
export async function PUT(request: Request) {
  try {
    await requireAdmin();
    if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

    const body = (await request.json()) as { categories?: unknown };
    if (!Array.isArray(body.categories)) {
      return NextResponse.json({ error: st(request, "err.badParams") }, { status: 400 });
    }
    const categories = body.categories as NavCategory[];
    // 基础校验
    for (const c of categories) {
      if (!c.id || !c.title || !Array.isArray(c.items)) {
        return NextResponse.json({ error: st(request, "err.incompleteCategory") }, { status: 400 });
      }
      for (const it of c.items) {
        if (!it.id || !it.name || !/^https?:\/\//i.test(it.url ?? "")) {
          return NextResponse.json({ error: st(request, "err.badLink", { name: it.name || it.id }) }, { status: 400 });
        }
      }
    }
    await writeNav(categories);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(request, e);
  }
}

/** DELETE：恢复默认导航 */
export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    if (!hasRedisConfig()) return NextResponse.json({ ok: true });
    const redis = getRedis();
    await redis.del(KEYS.navData);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(request, e);
  }
}
