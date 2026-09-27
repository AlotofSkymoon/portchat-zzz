import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getRedis, getValue, hasRedisConfig, KEYS, storageErrorMessage } from "@/lib/redis";
import { decryptSettings, encryptSettings } from "@/lib/user-settings-crypto";
import { serverT } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 用户个人设置的云端同步。
 *
 * 解决的问题：在 A 站（或 A 浏览器）填的 API Key、Base URL、自定义供应商，
 * 换到 B 站又要重新填一遍 —— 这些配置只存在浏览器 localStorage，
 * 换设备、换浏览器、清缓存就全没了。
 *
 * ⚠️ 安全：API Key 属于敏感信息，服务端用 AES-256-GCM 加密后入库，
 * 明文不落盘。详见 lib/user-settings-crypto.ts。
 */

/** 允许同步的字段白名单 —— 防止把任意东西塞进服务端 */
const SYNC_FIELDS = ["keys", "baseUrls", "customProviders", "model", "s3"] as const;

type SyncField = (typeof SYNC_FIELDS)[number];

function pickSyncable(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of SYNC_FIELDS) {
    if (input[f] !== undefined) out[f] = input[f];
  }
  return out;
}

/** GET /api/user/settings —— 读取本人云端设置 */
export async function GET(request: Request) {
  const t = (k: string) => serverT(request, k);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  const raw = await getValue<string>(KEYS.userSettings(user.id));
  if (!raw) return NextResponse.json({ settings: null });

  const plain = decryptSettings(raw);
  if (!plain) {
    // 解不开（换了服务端密钥 / 数据损坏）当作没有，不要报错
    return NextResponse.json({ settings: null });
  }

  try {
    return NextResponse.json({ settings: JSON.parse(plain) as Record<string, unknown> });
  } catch {
    return NextResponse.json({ settings: null });
  }
}

/** PUT /api/user/settings —— 保存本人云端设置 */
export async function PUT(request: Request) {
  const t = (k: string) => serverT(request, k);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: t("api.badRequest") }, { status: 400 });
  }

  /**
   * 只存白名单字段。
   * 不做这层过滤的话，客户端可以往服务端塞任意结构的数据。
   */
  const payload = pickSyncable(body);

  // 体积兜底：自定义供应商 + Key 再多也不该无限大
  const size = JSON.stringify(payload).length;
  if (size > 64 * 1024) {
    return NextResponse.json({ error: t("api.settingsTooLarge") }, { status: 413 });
  }

  try {
    await getRedis().set(KEYS.userSettings(user.id), encryptSettings(JSON.stringify(payload)));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: t("api.settingsSaveFailed") }, { status: 500 });
  }
}

/** DELETE /api/user/settings —— 清除云端设置 */
export async function DELETE(request: Request) {
  const t = (k: string) => serverT(request, k);

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: t("api.notLoggedIn") }, { status: 401 });
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  await getRedis().del(KEYS.userSettings(user.id));
  return NextResponse.json({ ok: true });
}
