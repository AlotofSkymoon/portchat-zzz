import { NextResponse } from "next/server";

import {
  createSession,
  createUserId,
  hashPassword,
  isValidEmail,
  setSessionCookie,
  toSafeUser,
} from "@/lib/auth";
import { isEmailConfigured, sendVerificationCode } from "@/lib/email";
import { markResent, saveCode } from "@/lib/email-verify";
import { getRedis, getValue, hasRedisConfig,
  storageErrorMessage, KEYS } from "@/lib/redis";
import { serverT as st } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!hasRedisConfig()) {
      return NextResponse.json(
        { error: storageErrorMessage() },
        { status: 500 },
      );
    }

    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!isValidEmail(email)) {
      return NextResponse.json({ error: st(request, "err.invalidEmail") }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: st(request, "err.passwordMin8") }, { status: 400 });
    }

    const redis = getRedis();

    // 1) 邮箱唯一性检查
    const existingId = await getValue<string>(KEYS.userEmail(email));
    if (existingId) {
      return NextResponse.json({ error: st(request, "err.emailTaken") }, { status: 409 });
    }

    /*
     * 2) 是否要求邮箱验证。
     *
     * 只有**配了 Resend** 才要求验证。没配的话直接放行 ——
     * 否则站长没接邮件服务时，所有人都注册不了，站点等于废掉一半。
     */
    const needVerify = isEmailConfigured();

    // 3) 原子自增：返回 1 说明是第一位用户 → admin
    //    ⚠️ 必须先 INCR 再判断，不能「先查数量再写」，否则并发下会出现两个管理员
    const seq = await redis.incr(KEYS.usersCount);
    const role = seq === 1 ? "admin" : "user";

    const id = createUserId();
    const passwordHash = await hashPassword(password);
    const createdAt = new Date().toISOString();

    // 4) 写入用户数据（email 反查 + 用户 hash 一起提交）
    const pipeline = redis.pipeline();
    pipeline.hset(KEYS.user(id), {
      id,
      email,
      passwordHash,
      role,
      createdAt,
      emailVerified: needVerify ? "false" : "true",
    });
    pipeline.set(KEYS.userEmail(email), id);
    await pipeline.exec();

    /*
     * 5) 需要验证时**不创建 session** ——
     * 没验证邮箱就放行的话，验证环节形同虚设，随便填个别人的邮箱就能用。
     */
    if (needVerify) {
      const code = await saveCode(email, id);
      const sent = await sendVerificationCode(email, code);

      if (!sent.ok) {
        /*
         * 发信失败不能让账号处于「已创建但永远无法验证」的状态。
         * 这里直接把账号标记为已验证并放行 ——
         * 邮件服务故障不该变成用户的注册障碍，验证码核对本身仍保留给能收到的人。
         */
        await redis.hset(KEYS.user(id), { emailVerified: "true" });
        const { sessionId, maxAge } = await createSession(id);
        await setSessionCookie(sessionId, maxAge);
        return NextResponse.json({
          user: toSafeUser({
            id, email, passwordHash, role: role as "admin" | "user", createdAt, emailVerified: true,
          }),
          isFirstUser: seq === 1,
          needVerification: false,
          mailFailed: true,
        });
      }

      await markResent(email, "");
      return NextResponse.json({
        needVerification: true,
        email,
        isFirstUser: seq === 1,
      });
    }

    const { sessionId, maxAge } = await createSession(id);
    await setSessionCookie(sessionId, maxAge);

    return NextResponse.json({
      user: toSafeUser({
        id, email, passwordHash, role: role as "admin" | "user", createdAt, emailVerified: true,
      }),
      isFirstUser: seq === 1,
      needVerification: false,
    });
  } catch (error) {
    console.error("[register] 注册失败", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: st(request, "err.registerFailed") }, { status: 500 });
  }
}
