import { KEYS, getRedis, hasRedisConfig } from "@/lib/redis";

/**
 * 聊天频率限制：普通用户每分钟 N 次。
 *
 * 用固定的「计数 + 过期」窗口而不是滑动窗口：
 *   · 实现简单，一次 incr 即可，不需要存时间戳列表
 *   · 30 次/分钟这种宽松额度下，固定窗口的边界突刺可以接受
 *
 * 会员与管理员不受此限制（由调用方决定是否调用本函数）。
 */

/** 每分钟允许的聊天次数 */
export const CHAT_RATE_LIMIT_PER_MINUTE = 30;

const WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  /** 本窗口剩余次数 */
  remaining: number;
  /** 被拒时建议的重试等待秒数 */
  retryAfter: number;
  /** 存储不可用时的降级放行（fail-open） */
  degraded: boolean;
}

/**
 * 对某个主体（用户 id 或 IP）做一次计数。
 *
 * 存储不可用时一律放行 —— 限流是保护性措施，
 * 不该因为 Redis 抽风就把所有人挡在门外。
 */
export async function hitChatRateLimit(subject: string): Promise<RateLimitResult> {
  if (!hasRedisConfig()) {
    return {
      allowed: true,
      remaining: CHAT_RATE_LIMIT_PER_MINUTE,
      retryAfter: 0,
      degraded: true,
    };
  }

  const key = KEYS.ratelimitChat(subject);

  try {
    const redis = getRedis();
    const used = await redis.incr(key);

    // 第一次计数时设定窗口过期时间；后续命中不再刷新，
    // 这样窗口是「从第一次请求起算的 60 秒」，而不是永久顺延。
    if (used === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }

    const allowed = used <= CHAT_RATE_LIMIT_PER_MINUTE;
    return {
      allowed,
      remaining: Math.max(0, CHAT_RATE_LIMIT_PER_MINUTE - used),
      retryAfter: allowed ? 0 : WINDOW_SECONDS,
      degraded: false,
    };
  } catch {
    // 存储报错：降级放行，不因为限流组件故障而中断聊天
    return {
      allowed: true,
      remaining: CHAT_RATE_LIMIT_PER_MINUTE,
      retryAfter: 0,
      degraded: true,
    };
  }
}
