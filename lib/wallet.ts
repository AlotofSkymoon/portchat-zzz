/**
 * Pot Pay —— 站内余额钱包。
 *
 * 为什么需要它：
 * 站点的收款码是 AlipayHK（香港钱包），第三方在线支付通道接不进来
 * （见 lib/sponsor-pay.ts 的说明）。所以站内消费不能走「边付边扣」，
 * 只能先充值成余额，再用余额付。
 *
 * 流程：
 *   1) 账户页充值 → 生成一笔 purpose=recharge 的订单（走收款码 + 交易号）
 *   2) AI 初审通过 / 站长在后台确认 → 入账到余额
 *   3) 余额可用于站内消费（付费模型按次扣）
 *
 * ⚠️ 金额一律用「分」存整数：
 * 0.05 这类小数在浮点里是 0.05000000000000000277，
 * 扣几次就对不上账了。整数分永远是准的，只在展示时才除 100。
 *
 * ⚠️ 入账必须幂等：
 * AI 通过和管理员手动确认可能先后触发两次，
 * 所以调用方要传 orderId，已入过账的订单不再重复加钱（见 creditForOrder）。
 */

import { randomBytes } from "crypto";

import { getRedis } from "@/lib/redis";

/** 流水类型 */
export type LedgerKind = "recharge" | "spend" | "refund" | "adjust";

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  /** 正=入账，负=出账。单位：分 */
  deltaFen: number;
  /** 变动后的余额。单位：分 */
  balanceFen: number;
  /** 关联的订单 id（充值/消费），手工调整为 null */
  orderId: string | null;
  /** 人可读的说明 */
  note: string | null;
  at: number;
}

/** 流水最多保留多少条 —— 再多也只是吃存储，页面也翻不完 */
export const LEDGER_LIMIT = 100;

const balanceKey = (userId: string) => `wallet:balance:${userId}`;
const ledgerKey = (userId: string) => `wallet:ledger:${userId}`;
/** 已入账的订单 id → 1，用于幂等（Set） */
const creditedKey = (userId: string) => `wallet:credited:${userId}`;

function newId(): string {
  return randomBytes(8).toString("base64url");
}

/** 读余额。没开过钱包就是 0，不存在的用户也返回 0（不该因此崩页面） */
export async function getBalanceFen(userId: string): Promise<number> {
  const raw = await getRedis().get<unknown>(balanceKey(userId)).catch(() => null);
  const n =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 读流水，新的在前 */
export async function listLedger(userId: string): Promise<LedgerEntry[]> {
  const raw = await getRedis().get<unknown>(ledgerKey(userId)).catch(() => null);
  let list: LedgerEntry[] = [];
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed as LedgerEntry[];
    } catch {
      list = [];
    }
  } else if (Array.isArray(raw)) {
    list = raw as LedgerEntry[];
  }
  return list.filter((x) => x && typeof x.at === "number").slice(0, LEDGER_LIMIT);
}

async function pushLedger(userId: string, entry: LedgerEntry): Promise<void> {
  const list = await listLedger(userId);
  const next = [entry, ...list].slice(0, LEDGER_LIMIT);
  // 流水跟用户同寿命，不设 TTL —— 少了它对不上账
  await getRedis().set(ledgerKey(userId), JSON.stringify(next));
}

interface MoveInput {
  kind: LedgerKind;
  /** 正数入账、负数出账 */
  deltaFen: number;
  orderId?: string | null;
  note?: string | null;
}

/**
 * 余额变动。
 *
 * ⚠️ 不是原子的：读-改-写在两个请求并发时会互相覆盖。
 * 但本站的入账都经 orderId 幂等保护，扣费都在一次对话里串行发生，
 * 所以这个取舍是可接受的 —— 引入 Lua / 分布式锁的复杂度不划算。
 */
async function move(userId: string, input: MoveInput): Promise<number> {
  const delta = Math.trunc(input.deltaFen);
  if (!delta) return getBalanceFen(userId);
  const cur = await getBalanceFen(userId);
  const next = Math.max(0, cur + delta);
  await getRedis().set(balanceKey(userId), String(next));
  await pushLedger(userId, {
    id: newId(),
    kind: input.kind,
    deltaFen: delta,
    balanceFen: next,
    orderId: input.orderId ?? null,
    note: input.note ?? null,
    at: Date.now(),
  });
  return next;
}

/** 入账（充值 / 退款 / 手工补） */
export function credit(
  userId: string,
  fen: number,
  opts?: { orderId?: string | null; note?: string | null; kind?: LedgerKind },
): Promise<number> {
  return move(userId, {
    kind: opts?.kind ?? "recharge",
    deltaFen: Math.abs(Math.trunc(fen)),
    orderId: opts?.orderId ?? null,
    note: opts?.note ?? null,
  });
}

/** 出账（消费 / 手工扣） */
export function debit(
  userId: string,
  fen: number,
  opts?: { orderId?: string | null; note?: string | null },
): Promise<number> {
  return move(userId, {
    kind: "spend",
    deltaFen: -Math.abs(Math.trunc(fen)),
    orderId: opts?.orderId ?? null,
    note: opts?.note ?? null,
  });
}

/** 判断某笔订单是否已经入过账 */
export async function hasCredited(userId: string, orderId: string): Promise<boolean> {
  const members = await getRedis().smembers(creditedKey(userId)).catch(() => []);
  return Array.isArray(members) ? members.includes(orderId) : false;
}

/**
 * 给订单入账，带幂等。
 *
 * 同一笔订单重复调用只会加一次钱 —— AI 通过之后站长又手动确认一遍，
 * 是最容易撞上的场景。
 */
export async function creditForOrder(
  userId: string,
  orderId: string,
  fen: number,
  note?: string | null,
): Promise<boolean> {
  if (!userId || fen <= 0) return false;
  if (await hasCredited(userId, orderId)) return false;
  await credit(userId, fen, { orderId, note: note ?? null });
  await getRedis().sadd(creditedKey(userId), orderId);
  return true;
}

/** 分 → 展示字符串，保留两位 */
export function formatFen(fen: number): string {
  const n = Number.isFinite(fen) ? fen : 0;
  return (n / 100).toFixed(2);
}

/** 元 → 分，四舍五入到整数分 */
export function yuanToFen(yuan: number): number {
  return Math.round((Number.isFinite(yuan) ? yuan : 0) * 100);
}
