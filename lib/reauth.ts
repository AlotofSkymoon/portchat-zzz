import { getRedis } from "@/lib/redis";

/**
 * 二次认证凭证（reauth grant）。
 *
 * 为什么存在：reauth（证明「是本人」）和真正要做的敏感操作是两个请求，
 * 中间必须有个凭据把两者串起来，否则前端跳过 reauth 直接调目标接口就绕过了。
 *
 * 设计取舍：
 * - 10 分钟有效：够填完表单，又不至于长期有效
 * - **用后即焚**：一个凭证只能完成一次操作，防重放
 * - 只记 userId，不记「要做什么」：职责单一，多个敏感操作可共用
 */
const GRANT_TTL_SECONDS = 600;

const grantKey = (token: string) => `reauth:${token}`;

export async function issueGrant(userId: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, "");
  await getRedis().set(grantKey(token), userId, { ex: GRANT_TTL_SECONDS });
  return token;
}

/** 校验并消费一张凭证；无效返回 null。 */
export async function consumeGrant(token: string): Promise<string | null> {
  const t = (token ?? "").trim();
  if (!t) return null;
  try {
    const raw = await getRedis().get<string>(grantKey(t));
    if (!raw) return null;
    await getRedis().del(grantKey(t));
    return raw;
  } catch {
    return null;
  }
}

export const REAUTH_TTL_SECONDS = GRANT_TTL_SECONDS;
