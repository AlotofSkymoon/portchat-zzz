/**
 * 会员制。
 *
 * 为什么从积分制改成会员制：按次扣分对用户来说是「用一次少一次」的焦虑感，
 * 而站点的实际成本主要来自少数重度用户。改成包时段后，
 * 轻度用户随便用，重度用户付一笔就够，站长也不用天天审充值单。
 *
 * ── 三档 ──────────────────────────────────────────────
 *   basic 初级  ¥0.1/月 或 ¥10 买断
 *              无限用：Agnes Max/Medium/Low + 名字含 deepseek 的模型
 *   pro   中级  ¥5/年  或 ¥30 买断
 *              无限用：任意模型
 *   ultra 高级  ¥50 买断
 *              任意模型 + 管理员权限（可撤销，违规即卸下并封禁）
 * ─────────────────────────────────────────────────────
 *
 * ⚠️ 三个必须知道的边界：
 *   1. 到期判断按 UTC+8（面向中文用户，按北京时间切日更直觉）。
 *   2. 封禁（banned）优先于一切 —— 封了就当没有会员，且不能提交申请。
 *   3. ultra 的「管理员」是**叠加**在原有角色上的：
 *      真正的角色判定在 resolveEffectiveRole() 里，
 *      卸下会员或封禁后权限立刻消失，不用等重新登录。
 */

import { getJsonValue, getRedis } from "@/lib/redis";

/* ------------------------------------------------------------------ *
 * 档位
 * ------------------------------------------------------------------ */

export type Tier = "basic" | "pro" | "ultra";

export interface TierSpec {
  id: Tier;
  /** 展示名 */
  nameKey: string;
  /** 月付价（元），0 表示不支持月付 */
  monthly: number;
  /** 买断价（元），0 表示不支持买断 */
  once: number;
  /** 年付价（元），0 表示不支持年付 */
  yearly: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  basic: {
    id: "basic",
    nameKey: "membership.tier.basic",
    monthly: 0.1,
    once: 10,
    yearly: 0,
  },
  pro: {
    id: "pro",
    nameKey: "membership.tier.pro",
    monthly: 0,
    once: 30,
    yearly: 5,
  },
  ultra: {
    id: "ultra",
    nameKey: "membership.tier.ultra",
    monthly: 0,
    once: 50,
    yearly: 0,
  },
};

export const TIER_ORDER: Tier[] = ["basic", "pro", "ultra"];

export function isTier(v: unknown): v is Tier {
  return v === "basic" || v === "pro" || v === "ultra";
}

/** 买断/年付的时长。null 表示永久。 */
export function durationOf(plan: "monthly" | "yearly" | "once"): number | null {
  if (plan === "monthly") return 30 * 24 * 60 * 60 * 1000;
  if (plan === "yearly") return 365 * 24 * 60 * 60 * 1000;
  return null;
}

export function priceOf(tier: Tier, plan: "monthly" | "yearly" | "once"): number {
  const spec = TIERS[tier];
  if (plan === "monthly") return spec.monthly;
  if (plan === "yearly") return spec.yearly;
  return spec.once;
}

/** 该档位是否支持这个购买方式 */
export function supportsPlan(tier: Tier, plan: "monthly" | "yearly" | "once"): boolean {
  return priceOf(tier, plan) > 0;
}

/* ------------------------------------------------------------------ *
 * 会员记录
 * ------------------------------------------------------------------ */

export interface Membership {
  userId: string;
  email: string;
  tier: Tier;
  /** 到期时间戳；null = 永久（买断） */
  expiresAt: number | null;
  /** 购买方式 */
  plan: "monthly" | "yearly" | "once";
  /** 被封禁（违规操作） */
  banned: boolean;
  /** 封禁原因 */
  banReason?: string;
  createdAt: number;
  updatedAt: number;
}

const memberKey = (userId: string) => `member:${userId}`;

function normalize(raw: Partial<Membership> | null): Membership | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.userId !== "string" || !raw.userId) return null;
  if (!isTier(raw.tier)) return null;

  return {
    userId: raw.userId,
    email: typeof raw.email === "string" ? raw.email : "",
    tier: raw.tier,
    // expiresAt 可能是 null（永久），也可能是数字；undefined 一律按永久处理
    expiresAt:
      typeof raw.expiresAt === "number" && raw.expiresAt > 0 ? raw.expiresAt : null,
    plan:
      raw.plan === "monthly" || raw.plan === "yearly" || raw.plan === "once"
        ? raw.plan
        : "once",
    banned: raw.banned === true,
    banReason: typeof raw.banReason === "string" ? raw.banReason : undefined,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export async function getMembership(userId: string): Promise<Membership | null> {
  const raw = await getJsonValue<Partial<Membership>>(memberKey(userId));
  return normalize(raw);
}

/** 有效会员（未封禁且未过期）；无效返回 null */
export async function getActiveMembership(userId: string): Promise<Membership | null> {
  const m = await getMembership(userId);
  if (!m) return null;
  if (m.banned) return null;
  if (m.expiresAt !== null && m.expiresAt <= Date.now()) return null;
  return m;
}

export async function setMembership(m: Membership): Promise<Membership> {
  const next: Membership = { ...m, updatedAt: Date.now() };
  await getRedis().set(memberKey(m.userId), next);
  return next;
}

/** 开通/续期。已存在则叠加时长（月付、年付按剩余时间续）。 */
export async function grantMembership(opts: {
  userId: string;
  email: string;
  tier: Tier;
  plan: "monthly" | "yearly" | "once";
}): Promise<Membership> {
  const now = Date.now();
  const existing = await getMembership(opts.userId);
  const span = durationOf(opts.plan);

  let expiresAt: number | null;
  if (span === null) {
    expiresAt = null; // 买断 = 永久
  } else {
    // 续期：从「当前到期时间」往后加，已过期的就从现在开始算
    const base =
      existing && !existing.banned && existing.expiresAt && existing.expiresAt > now
        ? existing.expiresAt
        : now;
    expiresAt = base + span;
  }

  // 降档保护：如果已有的档位更高，不因为买了低档而降下来
  let tier = opts.tier;
  if (existing && !existing.banned) {
    const cur = TIER_ORDER.indexOf(existing.tier);
    const next = TIER_ORDER.indexOf(opts.tier);
    if (cur > next) tier = existing.tier;
  }

  return setMembership({
    userId: opts.userId,
    email: opts.email,
    tier,
    expiresAt,
    plan: opts.plan,
    banned: false,
    banReason: undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/** 卸下会员（违规时调用）。banned=true 会连带封禁。 */
export async function revokeMembership(
  userId: string,
  opts?: { ban?: boolean; reason?: string },
): Promise<Membership | null> {
  const cur = await getMembership(userId);
  if (!cur) return null;

  return setMembership({
    ...cur,
    banned: opts?.ban === true,
    banReason: opts?.ban === true ? opts.reason || "违规操作" : undefined,
    tier: opts?.ban === true ? cur.tier : "basic",
    expiresAt: opts?.ban === true ? cur.expiresAt : 0,
  });
}

/* ------------------------------------------------------------------ *
 * 权限判定
 * ------------------------------------------------------------------ */

/**
 * 这个模型在该档位下能不能无限用。
 *
 * 初级：Agnes 三档（provider = agnes）+ 名字里含 deepseek 的
 * 中级/高级：任意模型
 */
export function tierAllowsModel(tier: Tier, modelId: string, providerId: string): boolean {
  if (tier === "pro" || tier === "ultra") return true;
  const id = (modelId || "").toLowerCase();
  if (id.includes("deepseek")) return true;
  return providerId === "agnes";
}

/** 该档位是否附带管理员权限 */
export function tierGrantsAdmin(tier: Tier): boolean {
  return tier === "ultra";
}

export interface EffectiveAccess {
  /** 是否会员（未封禁未过期） */
  isMember: boolean;
  tier: Tier | null;
  /** 会员期内可无限用这个模型 */
  unlimitedForModel: boolean;
  /** 是否因为会员而获得管理员 */
  adminByMembership: boolean;
  /** 被封禁 */
  banned: boolean;
  expiresAt: number | null;
}

/**
 * 站长预设档位。
 *
 * 管理员不需要给自己买会员 —— 站点额度本来就是站长提供的，
 * 让站长被自己定的规则挡住没有意义，也会导致无法验收改动。
 *
 * 这里走的是「解析时叠加」而不是「写一条 ultra 记录」：
 *   · 立刻生效，不用迁移历史数据
 *   · 不污染数据库，卸下会员也不会误伤真正的站长
 */
export const ADMIN_PRESET_TIER: Tier = "ultra";

export async function resolveAccess(
  userId: string | null,
  modelId: string,
  providerId: string,
  baseRole?: string,
): Promise<EffectiveAccess> {
  const empty: EffectiveAccess = {
    isMember: false,
    tier: null,
    unlimitedForModel: false,
    adminByMembership: false,
    banned: false,
    expiresAt: null,
  };
  if (!userId) return empty;

  // 管理员预设：直接按最高档处理，忽略库里的会员记录
  if (baseRole === "admin") {
    return {
      isMember: true,
      tier: ADMIN_PRESET_TIER,
      unlimitedForModel: true,
      adminByMembership: true,
      banned: false,
      expiresAt: null,
    };
  }

  const raw = await getMembership(userId);
  if (!raw) return empty;

  if (raw.banned) {
    return { ...empty, banned: true };
  }

  if (raw.expiresAt !== null && raw.expiresAt <= Date.now()) {
    return empty; // 过期
  }

  return {
    isMember: true,
    tier: raw.tier,
    unlimitedForModel: tierAllowsModel(raw.tier, modelId, providerId),
    adminByMembership: tierGrantsAdmin(raw.tier),
    banned: false,
    expiresAt: raw.expiresAt,
  };
}

/**
 * 叠加会员后的有效角色。
 *
 * 在需要 admin 判权的地方用这个替代原来的 `user.role`，
 * 这样「卸下会员」能立刻生效，不用等 token 过期。
 */
export function resolveEffectiveRole(baseRole: string | undefined, access: EffectiveAccess): string {
  if (access.adminByMembership) return "admin";
  return baseRole || "user";
}

/* ------------------------------------------------------------------ *
 * 开通申请单
 *
 * 收款码是静态的，钱到账不会通知站点，所以只能：
 *   用户填会员号提交 → 站长去 App 看流水核对 → 后台点通过
 * 这是目前唯一能闭环的方式。
 * ------------------------------------------------------------------ */

export type ApplyStatus = "pending" | "approved" | "rejected";

export interface MemberApply {
  id: string;
  /** 会员号：要求用户转账时填在备注里，否则站长在流水里认不出是谁 */
  code: string;
  userId: string;
  email: string;
  tier: Tier;
  plan: "monthly" | "yearly" | "once";
  amount: number;
  status: ApplyStatus;
  createdAt: number;
  handledAt?: number;
  handledBy?: string;
  reason?: string;
}

const APPLY_INDEX = "member:apply:index";
const applyKey = (id: string) => `member:apply:${id}`;

export function newApplyId(): string {
  return `ma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 会员号：PC-XXXXXX，去掉易混淆的 0/O/1/I */
export function newMemberCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `PC-${out}`;
}

export async function createApply(a: MemberApply): Promise<void> {
  const store = getRedis();
  await store.set(applyKey(a.id), a);
  await store.sadd(APPLY_INDEX, a.id);
}

export async function listApplies(opts?: {
  userId?: string;
  status?: ApplyStatus;
}): Promise<MemberApply[]> {
  const store = getRedis();
  const ids = await store.smembers(APPLY_INDEX);
  const out: MemberApply[] = [];

  for (const id of ids) {
    const raw = await getJsonValue<MemberApply>(applyKey(id));
    if (!raw || typeof raw !== "object" || !raw.id) continue;
    if (opts?.userId && raw.userId !== opts.userId) continue;
    if (opts?.status && raw.status !== opts.status) continue;
    out.push(raw);
  }

  out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return out;
}

export async function getApply(id: string): Promise<MemberApply | null> {
  const raw = await getJsonValue<MemberApply>(applyKey(id));
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  return raw;
}

export async function updateApply(
  id: string,
  patch: Partial<MemberApply>,
): Promise<MemberApply | null> {
  const cur = await getApply(id);
  if (!cur) return null;
  const next: MemberApply = { ...cur, ...patch, id: cur.id };
  await getRedis().set(applyKey(id), next);
  return next;
}

export const MEMBERSHIP_KEYS = {
  member: memberKey,
  applyIndex: APPLY_INDEX,
  apply: applyKey,
} as const;
