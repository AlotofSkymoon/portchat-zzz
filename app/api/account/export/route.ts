import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getJsonValue, getRedis, hasRedisConfig, setMembers, storageErrorMessage, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";
import type { CreationRecord } from "@/lib/creations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/account/export —— 导出自己的聊天记录（JSON 文件下载）
 *
 * 注销流程里「可以选择汇出聊天记录」走这里。
 *
 * ⚠️ 只导出**云端**记录：
 * 没开云端同步的话，会话只存在这台设备的浏览器里，服务端根本没有，
 * 想留底请在注销前于本地导出。响应里的 `cloudNote` 会说明这一点。
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });

  const redis = getRedis();
  const id = user.id;

  const chatIds = await setMembers(KEYS.chatIndex(id));
  const chats = await Promise.all(
    chatIds.map(async (cid) => {
      const parsed = await getJsonValue<{
        updatedAt?: number;
        model?: string;
        title?: string;
        messages?: unknown;
      }>(KEYS.chat(id, cid));
      if (!parsed) return null;
      return {
        conversationId: cid,
        title: typeof parsed.title === "string" ? parsed.title : "",
        model: parsed.model ?? "",
        updatedAt: parsed.updatedAt ?? 0,
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      };
    }),
  );

  const creationIds = await setMembers(KEYS.creationIndex(id));
  const creations = await Promise.all(
    creationIds.map(async (cid) => await getJsonValue<CreationRecord>(KEYS.creation(id, cid))),
  );

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { email: user.email, nickname: user.nickname ?? null },
    cloudNote:
      chatIds.length === 0
        ? "云端没有记录：未开启云端同步时，会话只保存在本机浏览器里。"
        : undefined,
    conversations: chats
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    creations: creations.filter((x): x is CreationRecord => Boolean(x && x.id)),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="pot-chat-export-${stamp}.json"`,
    },
  });
}
