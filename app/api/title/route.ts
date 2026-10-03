import { NextResponse } from "next/server";

import { generateConversationTitle } from "@/lib/title-generator";
import { timeoutSignal } from "@/lib/fetch-timeout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 给会话自动起标题。
 *
 * ⚠️ 这个接口**不鉴权也不限流很严**：它只消耗站点预设 Key 的极少量 token，
 * 且输入只取前 500 字。真被刷的话，预设 Key 本身有额度上限兜着。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { message?: string };
    const message = (body.message ?? "").trim();

    if (!message) {
      return NextResponse.json({ title: null }, { status: 400 });
    }

    const title = await generateConversationTitle(message, timeoutSignal(15_000));
    // 拿不到标题不是错误：前端会退回「首条消息截断」，没必要让用户看到报错
    return NextResponse.json({ title });
  } catch {
    return NextResponse.json({ title: null });
  }
}
