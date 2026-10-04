import { KEYS, getRedis, hasRedisConfig } from "@/lib/redis";

/**
 * 竞技场频率限制。
 *
 * 与聊天限流分开计数，且额度更宽松：一局辩论/狼人杀会连续调用几十次模型，
 * 若共用聊天那个 30 次/分钟的窗口，开局没几轮就把自己限死了，
 * 表现是「跑到一半突然全线 429」，非常难排查。
 */
export const ARENA_RATE_LIMIT_PER_MINUTE = 120;

const WINDOW_SECONDS = 60;

export interface ArenaRateResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  degraded: boolean;
}

/** 存储不可用时一律放行（fail-open），理由同聊天限流 */
export async function hitArenaRateLimit(subject: string): Promise<ArenaRateResult> {
  if (!hasRedisConfig()) {
    return {
      allowed: true,
      remaining: ARENA_RATE_LIMIT_PER_MINUTE,
      retryAfter: 0,
      degraded: true,
    };
  }

  try {
    const redis = getRedis();
    const used = await redis.incr(KEYS.ratelimitArena(subject));
    if (used === 1) await redis.expire(KEYS.ratelimitArena(subject), WINDOW_SECONDS);

    const allowed = used <= ARENA_RATE_LIMIT_PER_MINUTE;
    return {
      allowed,
      remaining: Math.max(0, ARENA_RATE_LIMIT_PER_MINUTE - used),
      retryAfter: allowed ? 0 : WINDOW_SECONDS,
      degraded: false,
    };
  } catch {
    return {
      allowed: true,
      remaining: ARENA_RATE_LIMIT_PER_MINUTE,
      retryAfter: 0,
      degraded: true,
    };
  }
}
