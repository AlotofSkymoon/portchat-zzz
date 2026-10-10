import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { readPasskeys, syncIndexes, writePasskeys } from "@/lib/passkey";
import { hasRedisConfig, storageErrorMessage } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出当前用户绑定的 Passkey（不给前端任何私钥材料，只有元信息） */
export async function GET() {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    return NextResponse.json({
      passkeys: readPasskeys(user).map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        synced: c.backupEligible,
      })),
    });
  } catch {
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }
}

/**
 * 解绑一个 Passkey。
 *
 * ⚠️ 和 GitHub 解绑同一条规则：**没设密码的账号不让解**。
 * Passkey 可能是他唯一的登录方式，解掉就再也进不来了。
 */
export async function DELETE(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json({ error: storageErrorMessage() }, { status: 500 });
    }
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    if (!user.passwordHash) {
      return NextResponse.json(
        { error: "请先在设置里设置密码，再解绑 Passkey" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id") ?? "";
    const list = readPasskeys(user);
    const rest = list.filter((c) => c.id !== id);

    if (rest.length === list.length) {
      return NextResponse.json({ error: "没找到这个 Passkey" }, { status: 404 });
    }

    // writePasskeys 内部会写回用户记录，这里不必再调一次 updateUser
    await syncIndexes(user.id, list, rest);
    await writePasskeys(user.id, rest);

    return NextResponse.json({
      ok: true,
      passkeys: rest.map((c) => ({
        id: c.id,
        label: c.label,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        synced: c.backupEligible,
      })),
    });
  } catch {
    return NextResponse.json({ error: "解绑失败" }, { status: 500 });
  }
}
