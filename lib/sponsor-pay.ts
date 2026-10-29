/**
 * 赞助订单 —— 自建的轻量收款核销系统。
 *
 * 为什么不用官方支付接口：
 * 本站收款码是 AlipayHK（香港钱包），支付宝 AI 付只接受**内地实名账号**签约，
 * 两个体系不通。所以在收款码外层自建一层订单号确认，人工核销。
 *
 * 流程：
 *   1) 赞助页由服务端生成一个二维码，内容是本站付款页链接
 *   2) 链接形如 /sponsor/pay?o=<id> —— **不含令牌**
 *   3) 付款页上显示令牌 pay_xxxxxxxx（付款人把它填进付款备注）
 *   4) 落地页加载即记一次「已扫码」，管理员能看到这个码被扫过
 *   5) 付款人点「我已付款」，填平台订单里的交易号
 *   6) 管理员后台弹出订单 → AI 审核合理性 → 通过 / 可疑转人工
 *
 * ⚠️ 令牌为什么不放进 URL：
 * URL 会被浏览器历史、分享卡片、Referer 一路带走；
 * 令牌只显示在页面上，由付款人手动抄进备注，才构成「付款凭证 ↔ 订单」的对应。
 */

import { randomBytes } from "crypto";

import { getRedis } from "@/lib/redis";

/** 固定金额：收款码是 10 HKD 的定额码，改这里同时也要换收款码 */
export const SPONSOR_AMOUNT_HKD = 10;

/** 订单有效期：扫了不付的码不该无限占着列表 */
export const ORDER_TTL_SECONDS = 72 * 60 * 60;

/** 已核销（已付/已审）的订单保留更久，便于对账 */
export const ORDER_KEEP_SECONDS = 180 * 24 * 60 * 60;

export type OrderStatus = "pending" | "claimed" | "approved" | "rejected";

export type AiVerdict = "pass" | "suspicious";

export interface SponsorOrder {
  /** 不透明短 id，出现在付款页 URL 里 */
  id: string;
  /** 页面展示的令牌，形如 pay_xxxxxxxxxxxx */
  token: string;
  amount: number;
  currency: string;
  status: OrderStatus;
  createdAt: number;
  /** 首次打开付款页的时间 —— 用来确认「这个码被扫过了」 */
  scannedAt: number | null;
  /** 提交交易号的时间 */
  claimedAt: number | null;
  /** 付款人填的平台交易号 */
  tradeNo: string | null;
  /** 付款人可选的联系方式（用于发奖/致谢，可空） */
  contact: string | null;
  /** AI 审核结论 */
  aiVerdict: AiVerdict | null;
  aiReason: string | null;
  aiModel: string | null;
  reviewedAt: number | null;
  /** 管理员人工处理时的备注 */
  adminNote: string | null;
}

const orderKey = (id: string) => `sponsor:order:${id}`;
/** 令牌 → 订单 id 的反查索引 */
const tokenKey = (token: string) => `sponsor:token:${token}`;
/** 全部订单 id */
const indexKey = "sponsor:orders";

function newId(): string {
  return randomBytes(8).toString("base64url");
}

/**
 * 生成展示用令牌。
 *
 * 用 base32 风格的小写字母数字：付款人要把它抄进付款备注，
 * 混了大小写和 `-_` 这种符号极易抄错（0/O、1/l/I 更难分）。
 * 所以从 base64url 里把易混字符剔掉。
 */
function newToken(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `pay_${out}`;
}

export async function createOrder(): Promise<SponsorOrder> {
  const redis = getRedis();
  const id = newId();
  const token = newToken();
  const order: SponsorOrder = {
    id,
    token,
    amount: SPONSOR_AMOUNT_HKD,
    currency: "HKD",
    status: "pending",
    createdAt: Date.now(),
    scannedAt: null,
    claimedAt: null,
    tradeNo: null,
    contact: null,
    aiVerdict: null,
    aiReason: null,
    aiModel: null,
    reviewedAt: null,
    adminNote: null,
  };
  const p = redis.pipeline();
  p.set(orderKey(id), JSON.stringify(order), { ex: ORDER_TTL_SECONDS });
  p.set(tokenKey(token), id, { ex: ORDER_TTL_SECONDS });
  p.sadd(indexKey, id);
  await p.exec();
  return order;
}

export async function getOrder(id: string): Promise<SponsorOrder | null> {
  const raw = await getRedis().get<unknown>(orderKey(id));
  if (!raw) return null;
  if (typeof raw !== "string") return raw as SponsorOrder;
  try {
    return JSON.parse(raw) as SponsorOrder;
  } catch {
    return null;
  }
}

export async function getOrderByToken(token: string): Promise<SponsorOrder | null> {
  const id = await getRedis().get<string>(tokenKey(token));
  if (!id || typeof id !== "string") return null;
  return getOrder(id);
}

/** 写回订单。已核销的延长保留期，未核销的维持原 TTL */
export async function saveOrder(order: SponsorOrder): Promise<void> {
  const keep = order.status === "pending" ? ORDER_TTL_SECONDS : ORDER_KEEP_SECONDS;
  await getRedis().set(orderKey(order.id), JSON.stringify(order), { ex: keep });
}

/**
 * 标记「已扫码」。
 *
 * 只记第一次 —— 付款页刷新不该把时间刷成最新，
 * 否则管理员看到的"扫码时间"失去意义。
 */
export async function markScanned(id: string): Promise<SponsorOrder | null> {
  const order = await getOrder(id);
  if (!order) return null;
  if (order.scannedAt) return order;
  order.scannedAt = Date.now();
  await saveOrder(order);
  return order;
}

/** 列出全部订单，按创建时间倒序 */
export async function listOrders(): Promise<SponsorOrder[]> {
  const ids = await getRedis().smembers(indexKey);
  if (!ids || ids.length === 0) return [];
  const out: SponsorOrder[] = [];
  for (const id of ids) {
    const o = await getOrder(id);
    // 过期的订单读出来是 null，顺手从索引里摘掉，避免列表越积越长
    if (!o) {
      // Store 接口没有独立的 srem，只有 pipeline 上有
      await getRedis()
        .pipeline()
        .srem(indexKey, id)
        .exec()
        .catch(() => undefined);
      continue;
    }
    out.push(o);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/**
 * 交易号的宽松格式校验。
 *
 * 各家平台的交易号形态不同（纯数字 20+ 位、或带字母前缀），
 * 这里只做「像不像一个交易号」的下限判断：长度够、字符集干净。
 * 真正的合理性判断交给 AI，写死规则反而会误杀正常订单。
 */
export function looksLikeTradeNo(value: string): boolean {
  const v = (value ?? "").trim();
  if (v.length < 8 || v.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(v);
}
