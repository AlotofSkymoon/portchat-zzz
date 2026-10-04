import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getRedis, getJsonValue, hasRedisConfig, storageErrorMessage, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";
import { CREATION_LIMIT, type CreationRecord } from "@/lib/creations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 创作记录（生图 / 生影片）云端存储。
 *
 * ⚠️ 为什么不用 chat:* 那套：聊天记录一条会话里塞了全部消息，
 * 而创作记录一次生成可能有 1~4 个产物，且要单独删除、单独分页。
 * 混在一起会让删除一条创作变成"重写整条会话"，风险大得多。
 *
 * 只存元数据 + 产物 URL，不存图片本体：
 * 图片是上游返回的链接，落库只是记个地址，体量可以忽略。
 */

/** 逐条读并按时间倒序。索引里可能有已失效的 id，读不到就跳过。 */
async function readAll(userId: string): Promise<CreationRecord[]> {
  const redis = getRedis();
  const ids = (await redis.smembers(KEYS.creationIndex(userId))) ?? [];
  const items = await Promise.all(
    ids.map((id) => getJsonValue<CreationRecord>(KEYS.creation(userId, id))),
  );
  return items
    .filter((x): x is CreationRecord => Boolean(x && x.id))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** GET /api/creations —— 列出当前用户的创作记录 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

  return NextResponse.json({ creations: await readAll(user.id) });
}

/** POST /api/creations —— 保存一条创作记录 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

  let body: { record?: unknown };
  try {
    body = (await request.json()) as { record?: unknown };
  } catch {
    return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });
  }

  const rec = body.record as Partial<CreationRecord> | undefined;
  if (!rec || typeof rec.id !== "string" || !Array.isArray(rec.urls) || rec.urls.length === 0) {
    return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });
  }

  // 只保留白名单字段：客户端传什么就存什么会把 KV 撑爆（比如参考图 base64）
  const clean: CreationRecord = {
    id: rec.id,
    kind: rec.kind === "video" ? "video" : "image",
    prompt: typeof rec.prompt === "string" ? rec.prompt.slice(0, 2000) : "",
    model: typeof rec.model === "string" ? rec.model.slice(0, 100) : "",
    urls: rec.urls.filter((u) => typeof u === "string").slice(0, 4),
    ratio: typeof rec.ratio === "string" ? rec.ratio : undefined,
    size: typeof rec.size === "string" ? rec.size : undefined,
    seconds: typeof rec.seconds === "string" ? rec.seconds : undefined,
    createdAt: Number.isFinite(rec.createdAt) ? Number(rec.createdAt) : Date.now(),
  };
  if (clean.urls.length === 0) {
    return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });
  }

  const redis = getRedis();
  await redis.set(KEYS.creation(user.id, clean.id), JSON.stringify(clean));
  await redis.sadd(KEYS.creationIndex(user.id), clean.id);

  // 超上限淘汰最旧的：不淘汰的话，长期用户每次生成都往索引里塞一条，
  // 列表接口会把几百条内容全读出来，页面会越来越慢。
  const all = await readAll(user.id);
  if (all.length > CREATION_LIMIT) {
    const pipeline = redis.pipeline();
    for (const old of all.slice(CREATION_LIMIT)) {
      pipeline.del(KEYS.creation(user.id, old.id));
      pipeline.srem(KEYS.creationIndex(user.id), old.id);
    }
    await pipeline.exec();
  }

  return NextResponse.json({ ok: true, record: clean });
}

/**
 * DELETE /api/creations
 *   ?id=xxx 删除单条
 *   ?all=1  清空全部
 */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

  const qs = new URL(request.url).searchParams;
  const redis = getRedis();

  if (qs.get("all") === "1") {
    const ids = (await redis.smembers(KEYS.creationIndex(user.id))) ?? [];
    const pipeline = redis.pipeline();
    for (const id of ids) pipeline.del(KEYS.creation(user.id, id));
    pipeline.del(KEYS.creationIndex(user.id));
    await pipeline.exec();
    return NextResponse.json({ ok: true, removed: ids.length });
  }

  const id = qs.get("id");
  if (!id) return NextResponse.json({ error: st(request, "err.badRequest") }, { status: 400 });

  const pipeline = redis.pipeline();
  pipeline.del(KEYS.creation(user.id, id));
  pipeline.srem(KEYS.creationIndex(user.id), id);
  await pipeline.exec();
  return NextResponse.json({ ok: true });
}
