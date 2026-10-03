/**
 * 积分制。
 *
 * 为什么要有这东西：站点的预设 Key 是站长自己的额度，
 * 不设上限的话任何人都能无限刷。积分是「本月可用额度」的计量单位。
 *
 * ── 规则 ──────────────────────────────────────────────
 *   · 每月自动发放 500 分（不累积到下月）
 *   · 每次对话扣分：普通 5 分 / 书生自研 10 分 / 名字含 deepseek 的 2 分
 *   · 充值买来的积分永久有效，不随月份清零
 *   · 扣分时先花本月额度，本月花完再动充值余额
 * ─────────────────────────────────────────────────────
 *
 * ⚠️ 两个必须知道的边界：
 *   1. 未登录用户不参与积分（见 CREDITS_ANONYMOUS）。这是有意留的口子，
 *      免登录是本站的卖点；要堵上就设 NEXT_PUBLIC_REQUIRE_LOGIN=true。
 *   2. 扣的是「请求发起前」的预估分，不按实际 token 算 ——
 *      按 token 算要等流式结束后才知道，中途断线就收不到钱了。
 */

import { getJsonValue, getRedis } from "@/lib/redis";

/* ------------------------------------------------------------------ *
 * 配置
 * ------------------------------------------------------------------ */

/** 是否启用积分制。默认开。 */
export const CREDITS_ENABLED =
  process.env.NEXT_PUBLIC_CREDITS_ENABLED?.trim() !== "false";

/** 每月免费额度 */
export const MONTHLY_GRANT = (() => {
  const n = Number(process.env.CREDITS_MONTHLY_GRANT?.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
})();

/** 默认单次扣分（Portchat 自带模型） */
export const COST_DEFAULT = (() => {
  const n = Number(process.env.CREDITS_COST_DEFAULT?.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
})();

/** 书生·端砚自研模型单次扣分 */
export const COST_INKSTONE = (() => {
  const n = Number(process.env.CREDITS_COST_INKSTONE?.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
})();

/** 名字里带 deepseek 的模型单次扣分 */
export const COST_DEEPSEEK = (() => {
  const n = Number(process.env.CREDITS_COST_DEEPSEEK?.trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
})();

/**
 * 未登录访客怎么处理。
 *   allow（默认）→ 不扣不限，保持免登录体验
 *   block        → 直接 401，必须登录
 */
export const CREDITS_ANONYMOUS: "allow" | "block" =
  process.env.CREDITS_ANONYMOUS?.trim() === "block" ? "block" : "allow";

/**
 * 管理员是否免积分。默认**免**。
 *
 * 理由：管理员就是站点 Key 的提供者，被自己定的规则锁住没有意义；
 * 而且要验收改动、复现用户反馈，都得能随时发消息。
 * 想让管理员也按分计费就设 CREDITS_ADMIN_BYPASS=false。
 */
export const CREDITS_ADMIN_BYPASS =
  process.env.CREDITS_ADMIN_BYPASS?.trim() !== "false";

/** 充值换算：1 元 = 多少积分。后台确认时可手改，这只是默认值。 */
export const POINTS_PER_UNIT = (() => {
  const n = Number(process.env.CREDITS_POINTS_PER_UNIT?.trim());
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

/* ------------------------------------------------------------------ *
 * 扣分表
 * ------------------------------------------------------------------ */

/**
 * 算一次对话要多少分。
 *
 * ⚠️ 判定顺序有讲究：先按**模型名**判 deepseek，再按**供应商**判书生。
 * 因为书生·端砚平台上也托管着 deepseek-v4-* 那几款，
 * 它们名字里带 deepseek，按站长定的规则算 2 分，不是书生的 10 分。
 */
export function costOfModel(modelId: string, providerId: string): number {
  const id = (modelId || "").toLowerCase();
  if (id.includes("deepseek")) return COST_DEEPSEEK;
  if (providerId === "inkstone") return COST_INKSTONE;
  return COST_DEFAULT;
}

/* ------------------------------------------------------------------ *
 * 账号额度
 * ------------------------------------------------------------------ */

export interface CreditAccount {
  /** 充值所得，永久有效 */
  purchased: number;
  /** 本月已发放的免费额度 */
  monthlyGranted: number;
  /** 本月已用掉的免费额度 */
  monthlyUsed: number;
  /** 所属月份，跨月自动重置 */
  cycle: string;
  /** 累计消耗（只做展示） */
  totalSpent: number;
  updatedAt: number;
}

/** 当前月份，按 UTC+8 算 —— 站点面向中文用户，按北京时间切月更直觉 */
export function currentCycle(now = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function creditKey(userId: string): string {
  return `credit:${userId}`;
}

function freshAccount(cycle: string): CreditAccount {
  return {
    purchased: 0,
    monthlyGranted: MONTHLY_GRANT,
    monthlyUsed: 0,
    cycle,
    totalSpent: 0,
    updatedAt: Date.now(),
  };
}

function normalize(raw: Partial<CreditAccount> | null, cycle: string): CreditAccount {
  const base = freshAccount(cycle);
  if (!raw) return base;

  // 跨月：免费额度重置，充值余额保留
  if (raw.cycle !== cycle) {
    return {
      ...base,
      purchased: Number(raw.purchased) || 0,
      totalSpent: Number(raw.totalSpent) || 0,
    };
  }

  const granted = Number(raw.monthlyGranted) || base.monthlyGranted;
  return {
    purchased: Math.max(0, Number(raw.purchased) || 0),
    monthlyGranted: Math.max(0, granted),
    monthlyUsed: Math.max(0, Number(raw.monthlyUsed) || 0),
    cycle,
    totalSpent: Math.max(0, Number(raw.totalSpent) || 0),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

/** 可用余额 = 充值余额 + 本月剩余免费额度 */
export function availableOf(a: CreditAccount): number {
  return a.purchased + Math.max(0, a.monthlyGranted - a.monthlyUsed);
}

export interface CreditSnapshot extends CreditAccount {
  available: number;
  monthlyLeft: number;
}

/** 读额度（跨月时顺手重置并写回） */
export async function readCredits(userId: string): Promise<CreditSnapshot> {
  const cycle = currentCycle();
  const raw = await getJsonValue<Partial<CreditAccount>>(creditKey(userId));
  const account = normalize(raw, cycle);

  // 跨月或首次：落盘，避免每次读都重算
  if (!raw || raw.cycle !== cycle) {
    try {
      await getRedis().set(creditKey(userId), account);
    } catch {
      /* 写失败不影响本次读取 */
    }
  }

  return {
    ...account,
    available: availableOf(account),
    monthlyLeft: Math.max(0, account.monthlyGranted - account.monthlyUsed),
  };
}

/**
 * 扣一次分。
 *
 * 返回 null 表示余额不足（调用方应拦下请求）。
 * ⚠️ 这里不是原子操作 —— KV / Upstash 都没有跨 key 事务，
 *    并发高时可能超扣一点。对一个免费站来说这个精度够了，
 *    真要严格得上 Lua 脚本或 D1 事务，代价不划算。
 */
export async function spendCredits(
  userId: string,
  cost: number,
): Promise<CreditSnapshot | null> {
  if (cost <= 0) return readCredits(userId);

  const current = await readCredits(userId);
  if (availableOf(current) < cost) return null;

  let fromMonthly = Math.min(cost, Math.max(0, current.monthlyGranted - current.monthlyUsed));
  let fromPurchased = cost - fromMonthly;

  const next: CreditAccount = {
    purchased: Math.max(0, current.purchased - fromPurchased),
    monthlyGranted: current.monthlyGranted,
    monthlyUsed: current.monthlyUsed + fromMonthly,
    cycle: current.cycle,
    totalSpent: current.totalSpent + cost,
    updatedAt: Date.now(),
  };

  await getRedis().set(creditKey(userId), next);
  return {
    ...next,
    available: availableOf(next),
    monthlyLeft: Math.max(0, next.monthlyGranted - next.monthlyUsed),
  };
}

/** 后台给用户加积分（充值审核通过时调用） */
export async function grantCredits(
  userId: string,
  points: number,
): Promise<CreditSnapshot> {
  const current = await readCredits(userId);
  const next: CreditAccount = {
    ...current,
    purchased: current.purchased + Math.max(0, Math.floor(points)),
    updatedAt: Date.now(),
  };
  await getRedis().set(creditKey(userId), next);
  return {
    ...next,
    available: availableOf(next),
    monthlyLeft: Math.max(0, next.monthlyGranted - next.monthlyUsed),
  };
}

/* ------------------------------------------------------------------ *
 * 充值申请单
 *
 * 收款码收的钱不会自动通知站点 —— AlipayHK 没有回调。
 * 所以只能「用户提交申请 → 站长去 App 里核对 → 后台点确认」。
 * 这是唯一能闭环的办法，代价是站长要手动点一下。
 * ------------------------------------------------------------------ */

export type TopupStatus = "pending" | "approved" | "rejected";

export interface TopupRequest {
  id: string;
  userId: string;
  email: string;
  /** 付款金额 */
  amount: number;
  /** 期望获得积分（提交时按汇率算好，站长可改） */
  points: number;
  /** 付款备注：用户在转账时填的留言，方便站长在流水里对上号 */
  note: string;
  status: TopupStatus;
  createdAt: number;
  handledAt?: number;
  handledBy?: string;
  /** 站长驳回时填的原因 */
  reason?: string;
}

const TOPUP_INDEX = "credit:topup:index";
const topupKey = (id: string) => `credit:topup:${id}`;

export function newTopupId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTopup(req: TopupRequest): Promise<void> {
  const store = getRedis();
  await store.set(topupKey(req.id), req);
  await store.sadd(TOPUP_INDEX, req.id);
}

export async function listTopups(opts?: {
  userId?: string;
  status?: TopupStatus;
}): Promise<TopupRequest[]> {
  const store = getRedis();
  const ids = await store.smembers(TOPUP_INDEX);
  const out: TopupRequest[] = [];

  for (const id of ids) {
    const raw = await getJsonValue<TopupRequest>(topupKey(id));
    if (!raw || typeof raw !== "object") continue;
    if (opts?.userId && raw.userId !== opts.userId) continue;
    if (opts?.status && raw.status !== opts.status) continue;
    out.push(raw);
  }

  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return out;
}

export async function getTopup(id: string): Promise<TopupRequest | null> {
  const raw = await getJsonValue<TopupRequest>(topupKey(id));
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  return raw;
}

export async function updateTopup(
  id: string,
  patch: Partial<TopupRequest>,
): Promise<TopupRequest | null> {
  const cur = await getTopup(id);
  if (!cur) return null;
  const next: TopupRequest = { ...cur, ...patch, id: cur.id };
  await getRedis().set(topupKey(id), next);
  return next;
}

/* ------------------------------------------------------------------ *
 * 降级策略
 * ------------------------------------------------------------------ */

/** 积分见底后仍可使用的模型（Portchat Low） */
export const LOW_CREDIT_MODEL = "agnes-2.0-flash";

/**
 * 余额为 0 时的限制：
 *   · 书生模型全部禁用
 *   · Portchat 只能用 Low，且思考功能关闭
 *   · 用户自带 Key 的模型不在限制内（花的是用户自己的钱）
 */
export interface CreditGate {
  allowed: boolean;
  /** 余额不足 */
  insufficient: boolean;
  /** 被降级策略拦下（模型不允许） */
  restricted: boolean;
  cost: number;
  available: number;
  /** 给用户看的说明 */
  reason?: string;
}

export const CREDIT_KEYS = {
  account: creditKey,
  topupIndex: TOPUP_INDEX,
  topup: topupKey,
} as const;
