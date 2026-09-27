import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getRedis, getValue, hasRedisConfig,
  storageErrorMessage, KEYS, setMembers } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/conversations —— 列出当前用户云端会话（仅本人）
 *
 * ⚠️ 之前这个接口虽然存在，但**前端从来没调用过**，
 * 而且只返回 id / updatedAt / model，不含标题和消息。
 * 结果就是：聊天记录能写进云端，却永远读不回来 ——
 * 换个浏览器（或换台设备）登录后，历史对话全都不见了。
 *
 * 现在支持 ?full=1 返回完整内容（标题 + 消息），
 * 供登录后把云端记录拉取合并到本地。
 *
 * 为什么用 query 而不是默认全返回：
 * 会话列表接口也会被管理类用途调用，带上全部消息体量会很大。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

  const full = new URL(request.url).searchParams.get("full") === "1";

  const ids = await setMembers(KEYS.chatIndex(user.id));
  const items = await Promise.all(
    ids.map(async (id) => {
      const raw = await getValue<string>(KEYS.chat(user.id, id));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as {
          updatedAt?: number;
          model?: string;
          title?: string;
          messages?: unknown;
        };
        if (!full) {
          return {
            conversationId: id,
            updatedAt: parsed.updatedAt ?? 0,
            model: parsed.model ?? "",
          };
        }
        return {
          conversationId: id,
          updatedAt: parsed.updatedAt ?? 0,
          model: parsed.model ?? "",
          title: typeof parsed.title === "string" ? parsed.title : "",
          messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        };
      } catch {
        return null;
      }
    }),
  );

  return NextResponse.json({
    conversations: items
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  });
}

/** DELETE /api/conversations —— 清空当前用户全部云端聊天记录 */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

  const redis = getRedis();
  const ids = await setMembers(KEYS.chatIndex(user.id));
  const pipeline = redis.pipeline();
  for (const id of ids) pipeline.del(KEYS.chat(user.id, id));
  pipeline.del(KEYS.chatIndex(user.id));
  await pipeline.exec();

  return NextResponse.json({ ok: true, deleted: ids.length });
}
