import { getRedis, KEYS } from "@/lib/redis";
import type { UserRecord } from "@/lib/auth";

/**
 * 注销账号（宽限期制）。
 *
 * 需求：注销要过 **密码 + 两步验证 + GitHub 认证** 三道，
 * 通过之后不是立刻删，而是进入 **100 分钟宽限期**：
 * 期间后悔了，登入再做一次两步验证就能取消。
 *
 * ⚠️ 为什么要有宽限期：
 * 删了就没了。而"确认"这个动作本身可能被误触、或被拿到密码的人恶意执行。
 * 留一段可反悔的窗口，是唯一能兜住误操作的办法。
 *
 * ⚠️ 为什么注销比改密码/改邮箱多一道 GitHub：
 * 这是全站唯一不可逆的操作，多一道独立身份源，代价（跳一次 OAuth）可以接受。
 *
 * ⚠️ 关于「到期自动删」：
 * 站点没有常驻进程 / 定时任务，做不到到点精确执行。
 * 实际做法是**惰性执行**：宽限期过了之后，该账号下一次请求（登录 / 拉用户信息）
 * 会触发真正的删除。也就是说不回来的账号，数据会一直留着直到有人访问它。
 */

/** 宽限期：100 分钟 */
export const DELETION_GRACE_MINUTES = 100;
export const DELETION_GRACE_SECONDS = DELETION_GRACE_MINUTES * 60;

export interface DeletionRecord {
  /** 申请注销的时间戳（毫秒） */
  requestedAt: number;
  /** 到这个时间点彻底删除（毫秒） */
  deleteAt: number;
  /** 当时用哪个 GitHub 账号完成的认证（留档，便于事后追溯） */
  githubLogin?: string | null;
}

/** 用户在存储里是 hash，嵌套对象存不进去，所以这个字段是 JSON 字符串 */
export function readDeletion(user: UserRecord | null | undefined): DeletionRecord | null {
  const raw = (user as (UserRecord & { deletion?: unknown }) | null | undefined)?.deletion;
  if (!raw) return null;
  if (typeof raw === "object") return raw as DeletionRecord;
  try {
    return JSON.parse(String(raw)) as DeletionRecord;
  } catch {
    return null;
  }
}

export function isDeletionPending(user: UserRecord | null | undefined): boolean {
  return !!readDeletion(user);
}

/** 宽限期是否已过（过了就该真删了） */
export function isDeletionDue(user: UserRecord | null | undefined): boolean {
  const rec = readDeletion(user);
  if (!rec) return false;
  return Date.now() >= rec.deleteAt;
}

export async function scheduleDeletion(
  userId: string,
  githubLogin: string | null,
): Promise<DeletionRecord> {
  const now = Date.now();
  const rec: DeletionRecord = {
    requestedAt: now,
    deleteAt: now + DELETION_GRACE_SECONDS,
    githubLogin,
  };
  await getRedis().hset(KEYS.user(userId), { deletion: JSON.stringify(rec) });
  return rec;
}

export async function cancelDeletion(userId: string): Promise<void> {
  /*
   * 存储接口没有 hdel（Cloudflare KV 后端不支持删单个字段），
   * 所以写空串 —— 空串在 readDeletion 里被当成"没申请过"，效果等同删除。
   */
  await getRedis().hset(KEYS.user(userId), { deletion: "" });
}

/* -------------------------------------------------------------------------- */
/*                        GitHub 认证（注销三要素之一）                        */
/* -------------------------------------------------------------------------- */

/**
 * GitHub 认证结果存在服务端，不放前端。
 *
 * 为什么不发一个 token 给前端、让前端带着来提交：
 * 那等于把"我已通过 GitHub 认证"这件事交给客户端声明，
 * 前端伪造一个字段就能跳过这道验证。
 */
const GITHUB_TTL_SECONDS = 10 * 60;
const ghKey = (userId: string) => `delreq:gh:${userId}`;

export async function markGithubVerified(userId: string, login: string): Promise<void> {
  await getRedis().set(ghKey(userId), login, { ex: GITHUB_TTL_SECONDS });
}

/** 读取 GitHub 认证结果。**不消费** —— 用户可能点回来再确认一次 */
export async function githubVerifiedLogin(userId: string): Promise<string | null> {
  try {
    return (await getRedis().get<string>(ghKey(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function clearGithubVerified(userId: string): Promise<void> {
  await getRedis().del(ghKey(userId));
}

/* -------------------------------------------------------------------------- */
/*                                  真删除                                    */
/* -------------------------------------------------------------------------- */

/**
 * 抹掉一个账号的全部数据。
 *
 * 逐个删而不是只删 user 记录：那些聊天会话、创作记录会变成孤儿数据，
 * 永远占着存储、也永远能被按 key 直接读出来 —— 等于没删干净。
 */
export async function eraseAccount(user: UserRecord): Promise<void> {
  const redis = getRedis();
  const id = user.id;

  const chatIds = await redis.smembers(KEYS.chatIndex(id)).catch(() => [] as string[]);
  const creationIds = await redis.smembers(KEYS.creationIndex(id)).catch(() => [] as string[]);
  const sessionIds = await redis.smembers(KEYS.userSessions(id)).catch(() => [] as string[]);

  const pipe = redis.pipeline();
  for (const cid of chatIds) pipe.del(KEYS.chat(id, cid));
  for (const cid of creationIds) pipe.del(KEYS.creation(id, cid));
  for (const sid of sessionIds) pipe.del(KEYS.session(sid));
  pipe.del(KEYS.chatIndex(id));
  pipe.del(KEYS.creationIndex(id));
  pipe.del(KEYS.userSessions(id));
  pipe.del(KEYS.user(id));
  pipe.del(KEYS.userEmail(user.email));
  pipe.del(KEYS.userSettings(id));
  pipe.del(`cloudsync:${id}`);
  pipe.del(`passkeys:${id}`);
  pipe.del(ghKey(id));

  // GitHub 索引只在仍指向本人时才删：并发下可能已被别人占用
  const ghId = typeof user.oauth === "string" ? null : user.oauth?.github?.id;
  if (ghId) {
    const owner = await redis.get<string>(KEYS.githubId(ghId)).catch(() => null);
    if (owner === id) pipe.del(KEYS.githubId(ghId));
  }

  await pipe.exec().catch(() => undefined);

  /*
   * ⚠️ 注册用户数（users:count）**没有回退**：存储接口只有 incr 没有 decr，
   * 而它是一个自增序列号兼计数器，减回去反而会让新用户 id 撞号。
   * 后台统计里的"注册用户数"因此会比实际存活账号偏大。
   */
}
