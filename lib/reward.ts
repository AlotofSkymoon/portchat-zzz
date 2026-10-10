/**
 * 每月聊天次数榜的奖励（第一名赠送二级域名）。
 *
 * 规则（按需求）：
 * - 每月 1 日 00:00（Asia/Shanghai）重置，周期键是 YYYY-MM，旧周期自然过期
 * - 榜首赠送一个二级域名；**管理员不算**，由第二名递补
 * - 有人登顶时，管理员面板会出现「待发奖」，管理员填域名转移码后生成 PDF
 * - PDF 由获奖者自行下载，内含转移码
 *
 * ⚠️ 为什么奖励记录按 period 存一份：
 * 每月只有一个名额，key 设计成 `reward:<period>` 天然幂等，
 * 重复提交是覆盖而不是追加，不会出现一个周期两份奖品。
 */
import {
  chatLeaderboard,
  currentPeriod,
  previousPeriod,
  type RankRow,
} from "@/lib/stats";
import { getRedis } from "@/lib/redis";

export type RewardRecord = {
  period: string;
  /** 获奖者 userId */
  userId: string;
  label: string;
  count: number;
  /** 域名转移码（管理员填） */
  transferCode: string;
  /** 域名本体，如 xxxx.dnshe.com */
  domain: string;
  /** 附言 */
  note: string;
  /** 管理员附的图片地址，可空 */
  imageUrl: string;
  createdAt: number;
};

const key = (period: string) => `reward:${period}`;

export async function getReward(period: string): Promise<RewardRecord | null> {
  try {
    const raw = await getRedis().get<string>(key(period));
    if (!raw) return null;
    return JSON.parse(raw) as RewardRecord;
  } catch {
    return null;
  }
}

export async function saveReward(record: RewardRecord): Promise<void> {
  await getRedis().set(key(record.period), JSON.stringify(record));
}

/**
 * 计算某个周期的**待发奖**对象。
 *
 * 管理员被跳过：榜单里 isAdmin 的人不入围，取后面第一个非管理员。
 * 已经发过奖的周期返回 null（前端就不用再提示管理员）。
 */
export async function pendingCandidate(
  period = currentPeriod(),
): Promise<RankRow | null> {
  const existing = await getReward(period);
  if (existing) return null;

  const rows = await chatLeaderboard(period, 10);
  for (const row of rows) {
    if (row.isAdmin) continue;
    if (!row.subject) continue;
    return row;
  }
  return null;
}

/** 管理员面板一次看两个周期：本月 + 上月（上月防止漏发）。 */
export async function pendingList(): Promise<
  { period: string; candidate: RankRow | null; reward: RewardRecord | null }[]
> {
  const periods = [currentPeriod(), previousPeriod()];
  const seen = new Set<string>();
  const out: { period: string; candidate: RankRow | null; reward: RewardRecord | null }[] = [];
  for (const p of periods) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push({
      period: p,
      candidate: await pendingCandidate(p),
      reward: await getReward(p),
    });
  }
  return out;
}
