import { hasRedisConfig, getRedis, getValue, KEYS,
  getJsonValue} from "@/lib/redis";
import { FALLBACK_TLDS_NORMALIZED, normalizeTlds } from "@/lib/tld-fallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IANA_URL = "https://data.iana.org/TLD/tlds-alpha-by-domain.txt";
const CACHE_TTL = 60 * 60 * 24; // 24 小时

/**
 * GET /api/tlds —— 全球域名后缀列表
 * 来源优先级：Redis 缓存 → IANA 官方 → 内置兜底列表
 */
export async function GET() {
  // 1) Redis 缓存
  try {
    if (hasRedisConfig()) {
      const cached = await getJsonValue<{ list: string[]; at: number }>(KEYS.tlds);
      if (cached?.list?.length) {
        return Response.json({
          tlds: cached.list,
          count: cached.list.length,
          source: "cache",
          updatedAt: cached.at,
        });
      }
    }
  } catch {
    /* 忽略 */
  }

  // 2) IANA 官方
  try {
    const res = await fetch(IANA_URL, {
      headers: { "User-Agent": "agnes-chat/1.0" },
    });
    if (res.ok) {
      const text = await res.text();
      const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"));
      const list = normalizeTlds(lines);
      if (list.length > 200) {
        try {
          if (hasRedisConfig()) {
            const redis = getRedis();
            await redis.set(KEYS.tlds, JSON.stringify({ list, at: Date.now() }), { ex: CACHE_TTL });
          }
        } catch {
          /* 缓存失败不影响返回 */
        }
        return Response.json({ tlds: list, count: list.length, source: "iana", updatedAt: Date.now() });
      }
    }
  } catch {
    /* 网络失败则用兜底 */
  }

  // 3) 内置兜底
  return Response.json({
    tlds: FALLBACK_TLDS_NORMALIZED,
    count: FALLBACK_TLDS_NORMALIZED.length,
    source: "fallback",
    updatedAt: 0,
  });
}
