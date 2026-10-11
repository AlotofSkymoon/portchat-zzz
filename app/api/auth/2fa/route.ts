import { NextResponse } from "next/server";

import { getCurrentUser, readTwoFactor, verifyPassword } from "@/lib/auth";
import { getRedis, hasRedisConfig, storageErrorMessage, KEYS } from "@/lib/redis";
import {
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from "@/lib/totp";
import type { TwoFactorState } from "@/lib/auth";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 两步验证（TOTP）管理。
 *
 *   GET    → 查询状态（是否开启、剩余备份码数）
 *   POST   → action=setup  生成新密钥（不启用，等用户验证后才生效）
 *            action=enable 用验证码确认并启用
 *   DELETE → 关闭（需要验证码或密码）
 *
 * 为什么 setup 和 enable 要分两步：
 * 一生成密钥就写入账号的话，用户扫完码发现验证器没同步上，
 * 账号就带着一个「用不了的 2FA」——人会被锁在外面。
 * 必须等用户真的输对一次验证码，才允许启用。
 *
 * ⚠️ 用户记录在 Redis 里是 hash，所以 twoFactor 存 JSON 字符串（见 lib/auth.ts）。
 */

function t(request: Request) {
  return (k: string, vars?: Record<string, string | number>) => st(request, k, vars);
}

function bad(request: Request, message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const tr = t(request);
  const user = await getCurrentUser();
  if (!user) return bad(request, tr("err.notLoggedIn"), 401);
  if (!hasRedisConfig()) return bad(request, storageErrorMessage(), 500);

  const tf = readTwoFactor(user);
  return NextResponse.json({
    enabled: Boolean(tf?.enabledAt),
    enabledAt: tf?.enabledAt ?? null,
    backupRemaining: tf?.backupCodes?.length ?? 0,
  });
}

export async function POST(request: Request) {
  const tr = t(request);
  const user = await getCurrentUser();
  if (!user) return bad(request, tr("err.notLoggedIn"), 401);
  if (!hasRedisConfig()) return bad(request, storageErrorMessage(), 500);

  let body: { action?: string; secret?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(request, tr("err.badRequest"));
  }

  const redis = getRedis();
  const action = body.action ?? "";

  /* ------------------------- 生成密钥（未启用） ------------------------- */
  if (action === "setup") {
    // 已开启就不给新密钥，避免用户误操作把验证器搞乱
    if (readTwoFactor(user)?.enabledAt) {
      return bad(request, "两步验证已开启，请先关闭再重新绑定");
    }
    const secret = generateTotpSecret();
    return NextResponse.json({
      secret,
      uri: otpauthUri({ secret, account: user.email, issuer: "Pot" }),
    });
  }

  /* --------------------------- 确认并启用 --------------------------- */
  if (action === "enable") {
    const secret = (body.secret ?? "").trim();
    const code = (body.code ?? "").trim();
    if (!secret || !code) return bad(request, "请填写验证码");

    const ok = await verifyTotp(secret, code);
    if (!ok) return bad(request, "验证码不对，请确认手机时间是否准确");

    const plaintext = generateBackupCodes();
    const hashed = await Promise.all(plaintext.map(hashBackupCode));

    const state: TwoFactorState = {
      secret,
      enabledAt: new Date().toISOString(),
      backupCodes: hashed,
    };

    await redis.hset(KEYS.user(user.id), { twoFactor: JSON.stringify(state) });

    return NextResponse.json({
      enabled: true,
      // 明文备份码只在这一次返回，之后只能查到剩余数量
      backupCodes: plaintext,
    });
  }

  return bad(request, tr("err.badRequest"));
}

export async function DELETE(request: Request) {
  const tr = t(request);
  const user = await getCurrentUser();
  if (!user) return bad(request, tr("err.notLoggedIn"), 401);
  if (!hasRedisConfig()) return bad(request, storageErrorMessage(), 500);

  let body: { code?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad(request, tr("err.badRequest"));
  }

  // 关闭 2FA 是降安全性的操作，必须验一次身份
  const code = (body.code ?? "").trim();
  const password = body.password ?? "";
  const tf = readTwoFactor(user);

  let ok = false;
  if (tf) {
    if (code) {
      ok = await verifyTotp(tf.secret, code);
      if (!ok) {
        const digest = await hashBackupCode(normalizeBackupCode(code));
        if (tf.backupCodes.includes(digest)) ok = true;
      }
    }
    if (!ok && password) {
      ok = await verifyPassword(password, user.passwordHash);
    }
  } else if (password) {
    ok = await verifyPassword(password, user.passwordHash);
  }

  if (!ok) return bad(request, "验证码或密码不对", 401);

  // ⚠️ 统一存储接口（Store）没有 HDEL：Upstash 有，但 Cloudflare KV/D1 实现不出来。
  // 写成空串等效于删除 —— readTwoFactor() 对空串直接返回 null（见 lib/auth.ts）。
  await getRedis().hset(KEYS.user(user.id), { twoFactor: "" });

  return NextResponse.json({ enabled: false });
}
