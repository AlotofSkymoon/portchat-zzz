/**
 * 站点统计：聊天次数、模型调用次数、最垃圾模型投票。
 *
 * 存储层只有 get/set/incr/keys，没有 zset 也没有 hincrby，
 * 所以排行榜的做法是「每个对象一个计数 key + 按前缀枚举」。
 * 规模不大（每月几千个 key）时完全够用，也不引入新的存储依赖。
 *
 * 计数周期按月切分（Asia/Shanghai），每月 1 日自动进入新周期，
 * 旧周期的 key 自然过期、不需要额外清理任务。
 */
import { getRedis } from "@/lib/redis";

/** 统计周期 = 当月，格式 YYYY-MM（UTC+8）。 */
export function currentPeriod(now = Date.now()): string {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 上一个统计周期（用于展示「上月榜单」）。 */
export function previousPeriod(now = Date.now()): string {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  shifted.setUTCMonth(shifted.getUTCMonth() - 1);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 当前时间距离下次重置（下月 1 日 00:00 UTC+8）的毫秒数。 */
export function msUntilReset(now = Date.now()): number {
  const shifted = new Date(now + 8 * 60 * 60 * 1000);
  const next = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1, 0, 0, 0),
  );
  return next.getTime() - (now + 8 * 60 * 60 * 1000);
}

export const STAT_TTL_SECONDS = 60 * 60 * 24 * 200; // 200 天，够跨月回溯又不会永久堆积

const K = {
  chat: (p: string, uid: string) => `stat:chat:${p}:${uid}`,
  chatPrefix: (p: string) => `stat:chat:${p}:*`,
  model: (p: string, id: string) => `stat:model:${p}:${id}`,
  modelPrefix: (p: string) => `stat:model:${p}:*`,
  worst: (p: string, id: string) => `vote:worst:${p}:${id}`,
  worstPrefix: (p: string) => `vote:worst:${p}:*`,
  worstVote: (p: string, uid: string) => `vote:worst:${p}:u:${uid}`,
};

/**
 * 计数 +1。
 *
 * ⚠️ 这是「热路径」：每次对话都会写一次。
 * 失败不能影响主流程，所以全部吞掉异常。
 */
export async function bumpChatCount(userId: string, period = currentPeriod()): Promise<void> {
  try {
    const redis = getRedis();
    const key = K.chat(period, userId);
    await redis.incr(key);
    await redis.expire(key, STAT_TTL_SECONDS);
  } catch {
    /* 统计失败不影响对话 */
  }
}

/** 模型被调用次数 +1。modelId 会做一次清洗，避免塞进奇怪字符污染 key。 */
export async function bumpModelCount(modelId: string, period = currentPeriod()): Promise<void> {
  const id = safeId(modelId);
  if (!id) return;
  try {
    const redis = getRedis();
    const key = K.model(period, id);
    await redis.incr(key);
    await redis.expire(key, STAT_TTL_SECONDS);
  } catch {
    /* 同上 */
  }
}

/** 把 modelId 里可能出现的特殊字符压掉，只保留安全字符。 */
export function safeId(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/[*:\s]/g, "_")
    .slice(0, 120);
}

/**
 * 投票「最垃圾模型」。
 * 每个用户每月只能有一票在生效：改投时把旧票减掉。
 */
export async function voteWorstModel(
  userId: string,
  modelId: string,
  period = currentPeriod(),
): Promise<{ ok: boolean; changed: boolean }> {
  const id = safeId(modelId);
  if (!id) return { ok: false, changed: false };
  const redis = getRedis();
  const mine = K.worstVote(period, userId);
  const prev = await redis.get<string>(mine);
  if (prev && prev === id) return { ok: true, changed: false };
  await redis.set(mine, id);
  await redis.expire(mine, STAT_TTL_SECONDS);
  const cur = K.worst(period, id);
  await redis.incr(cur);
  await redis.expire(cur, STAT_TTL_SECONDS);
  if (prev && prev !== id) {
    const old = K.worst(period, prev);
    const n = Number((await redis.get<string>(old)) ?? "0");
    await redis.set(old, String(Math.max(0, n - 1)));
  }
  return { ok: true, changed: true };
}

export async function myWorstVote(
  userId: string,
  period = currentPeriod(),
): Promise<string | null> {
  try {
    return await getRedis().get<string>(K.worstVote(period, userId));
  } catch {
    return null;
  }
}

/** 枚举某个前缀下的计数，按倒序返回前 N 条。 */
async function topByPrefix(
  prefix: string,
  limit: number,
): Promise<{ subject: string; count: number }[]> {
  const redis = getRedis();
  const keys = (await redis.keys(prefix)) ?? [];
  if (!keys.length) return [];
  const values = await Promise.all(
    keys.map(async (k) => {
      const raw = await redis.get<string>(k);
      return { k, n: Number(raw ?? "0") || 0 };
    }),
  );
  return values
    .filter((v) => v.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((v) => ({
      subject: v.k.slice(prefix.length - 1),
      count: v.n,
    }));
}

export type RankRow = {
  subject: string;
  count: number;
  /** 仅用户榜有：昵称 / 邮箱（脱敏） */
  label?: string;
  isAdmin?: boolean;
};

/** 用户聊天次数榜。 */
export async function chatLeaderboard(
  period = currentPeriod(),
  limit = 10,
): Promise<RankRow[]> {
  const raw = await topByPrefix(K.chatPrefix(period), 50);
  const out: RankRow[] = [];
  for (const row of raw) {
    const uid = row.subject;
    const label = await describeUser(uid);
    out.push({
      subject: uid,
      count: row.count,
      label: label.label,
      isAdmin: label.isAdmin,
    });
  }
  return out.slice(0, limit);
}

/** 模型调用次数榜。 */
export async function modelLeaderboard(
  period = currentPeriod(),
  limit = 20,
): Promise<RankRow[]> {
  const raw = await topByPrefix(K.modelPrefix(period), limit);
  return raw.map((r) => ({ subject: r.subject, count: r.count }));
}

/** 最垃圾模型榜（票数）。 */
export async function worstLeaderboard(
  period = currentPeriod(),
  limit = 20,
): Promise<RankRow[]> {
  const raw = await topByPrefix(K.worstPrefix(period), limit);
  return raw.map((r) => ({ subject: r.subject, count: r.count }));
}

/** 取用户展示名，顺便标出是不是管理员。 */
async function describeUser(
  uid: string,
): Promise<{ label: string; isAdmin: boolean }> {
  try {
    const redis = getRedis();
    const u = (await redis.hgetall(`user:${uid}`)) as
      | Record<string, string>
      | null;
    if (!u) return { label: `${uid.slice(0, 6)}…`, isAdmin: false };
    const isAdmin =
      u.isAdmin === "true" || u.role === "admin" || u.role === "owner";
    const name = (u.nickname || "").trim();
    const email = (u.email || "").trim();
    return {
      label: name || maskEmail(email) || `${uid.slice(0, 6)}…`,
      isAdmin,
    };
  } catch {
    return { label: `${uid.slice(0, 6)}…`, isAdmin: false };
  }
}

/**
 * 邮箱脱敏：a****b@example.com。
 * 榜单是公开的，不能把完整邮箱摆上去。
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "";
  const name = email.slice(0, at);
  const domain = email.slice(at);
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : "";
  return `${head}${"*".repeat(Math.max(2, Math.min(6, name.length - 1)))}${tail}${domain}`;
}
