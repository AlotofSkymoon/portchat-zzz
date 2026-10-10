import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { consumeGrant } from "@/lib/reauth";
import { getRedis, hasRedisConfig, storageErrorMessage } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 云端保存开关（存服务端，不再只放 localStorage）。
 *
 * 规则：**默认开启**；想关掉必须过一次二次认证
 * （密码 / 两步验证 / Passkey / 邮箱验证码，四选一）。
 *
 * ⚠️ 为什么把开关搬到服务端：
 * 只放 localStorage 的话，用户清空浏览器数据就能绕过认证把开关拨回去，
 * 那道认证就成了摆设。开关状态本身在服务端，前端改不了事实。
 *
 * ⚠️ 为什么关才认证、开不认证：
 * 开启是「更安全」的方向，不该给用户添堵；
 * 关闭会停止同步、也让数据更容易丢，属于危险方向，才需要验明正身。
 */
const key = (userId: string) => `cloudsync:${userId}`;

export async function GET(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  try {
    const raw = await getRedis().get<string>(key(user.id));
    // 没记录 = 用默认值（开启）
    return NextResponse.json({ enabled: raw === null ? true : raw === "1" });
  } catch {
    return NextResponse.json({ enabled: true });
  }
}

export async function POST(request: Request) {
  if (!hasRedisConfig()) {
    return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: st(request, "err.notLoggedIn") }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: boolean;
    reauthToken?: string;
  };
  const enabled = !!body.enabled;

  // 关闭需要二次认证凭证
  if (!enabled) {
    const uid = await consumeGrant(body.reauthToken ?? "");
    if (!uid || uid !== user.id) {
      return NextResponse.json(
        { error: st(request, "err.reauthRequired"), needReauth: true },
        { status: 403 },
      );
    }
  }

  try {
    await getRedis().set(key(user.id), enabled ? "1" : "0");
    return NextResponse.json({ ok: true, enabled });
  } catch {
    return NextResponse.json({ error: st(request, "err.saveFailed") }, { status: 500 });
  }
}
