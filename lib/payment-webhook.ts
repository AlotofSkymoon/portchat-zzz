/**
 * 支付回调（AlipayHK / 通用）核心逻辑。
 *
 * ⚠️ 先说清楚一个现实限制：
 * AlipayHK 官方的异步通知（notifyURL）只对**签约商户**开放 —— 需要 partner ID、
 * RSA 密钥、还得线下报备回调地址。个人静态收款码**没有**官方 webhook。
 *
 * 所以这里做成「通用接收端 + 可对接官方」：
 * 1. HMAC-SHA256 共享密钥（默认）：任何能发 HTTP 的中间层都能推，包括
 *    你自己写的流水监控脚本、第三方转发服务、或者手动 curl。
 * 2. Alipay legacy RSA 验签（可选）：真拿到商户资格后开启。
 * 3. Antom / Alipay+ header RSA 验签（可选）：同上。
 *
 * 无论走哪条，最终都落到同一件事：**从备注里提取会员号 PC-XXXXXX → 开通会员**。
 */

import type { Tier } from "@/lib/membership";
import { priceOf, type Tier as TierType } from "@/lib/membership";

export type Plan = "monthly" | "yearly" | "once";

/** 会员号字母表：去掉易混淆的 0/O/1/I，必须与 membership.ts 保持一致 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = new RegExp(`PC-[${CODE_ALPHABET}]{6}`, "i");

// ─────────────────────────────────────────────────────────────
// 解析
// ─────────────────────────────────────────────────────────────

/** 把嵌套对象展平成一层，便于按字段名取值（Alipay 的 amount 常藏在对象里） */
export function flatten(
  obj: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
    out[k] = out[k] ?? v; // 同时保留短名，命中率更高
  }
  return out;
}

function firstString(
  flat: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const n of names) {
    const v = flat[n];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

/** 从备注 / 标题 / 描述里找会员号 */
export function extractCode(payload: unknown): string | undefined {
  const flat = flatten(payload);
  // 先看明确的备注字段，最后再全文搜，避免误命中
  const candidates = [
    firstString(flat, [
      "remark",
      "memo",
      "note",
      "description",
      "subject",
      "body",
      "reference",
      "out_trade_no",
      "merchantTransId",
    ]),
    ...Object.values(flat).filter((v): v is string => typeof v === "string"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const m = c.match(CODE_RE);
    if (m) return m[0].toUpperCase();
  }
  return undefined;
}

export function extractAmount(payload: unknown): number | undefined {
  const flat = flatten(payload);
  const s = firstString(flat, [
    "total_amount",
    "totalAmount",
    "total_fee",
    "totalFee",
    "orderAmount.value",
    "amount",
    "money",
    "value",
  ]);
  if (s === undefined) return undefined;
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function extractTxId(payload: unknown): string | undefined {
  const flat = flatten(payload);
  return firstString(flat, [
    "trade_no",
    "tradeNo",
    "transaction_id",
    "transactionId",
    "acquirementId",
    "notify_id",
    "notifyId",
    "id",
    "out_trade_no",
  ]);
}

export function extractEmail(payload: unknown): string | undefined {
  const flat = flatten(payload);
  const s = firstString(flat, [
    "buyer_email",
    "buyerEmail",
    "payerEmail",
    "email",
    "buyer_logon_id",
  ]);
  return s ? s.toLowerCase() : undefined;
}

/**
 * 按金额反推档位与购买方式。
 * 只对得上精确档位价才认（容差 ±0.01），认不出来返回 null —— 宁可进待审核，
 * 也不能把 ¥0.1 的转账判成高级会员。
 */
export function inferTierPlan(amount: number): {
  tier: TierType;
  plan: Plan;
} | null {
  const table: Array<{ tier: TierType; plan: Plan }> = [
    { tier: "basic", plan: "monthly" },
    { tier: "basic", plan: "once" },
    { tier: "pro", plan: "yearly" },
    { tier: "pro", plan: "once" },
    { tier: "ultra", plan: "once" },
  ];
  for (const c of table) {
    if (Math.abs(amount - priceOf(c.tier, c.plan)) <= 0.011) return c;
  }
  return null;
}

export function isPlan(v: unknown): v is Plan {
  return v === "monthly" || v === "yearly" || v === "once";
}

// ─────────────────────────────────────────────────────────────
// 验签
// ─────────────────────────────────────────────────────────────

function bufEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** HMAC-SHA256：默认方案。签名放在请求头里，对 raw body 计算 */
export async function verifyHmac(
  rawBody: string,
  headerSignature: string | null,
  secret: string,
): Promise<boolean> {
  if (!headerSignature) return false;
  const { createHmac } = await import("node:crypto");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const got = headerSignature.trim().replace(/^sha256=/i, "");
  try {
    return bufEqual(Buffer.from(expected, "utf8"), Buffer.from(got, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Alipay legacy 验签：去掉 sign / sign_type，其余字段按 A-Z 排序用 & 连接。
 * 仅在设置了 ALIPAY_PUB_KEY 时启用。
 */
export async function verifyAlipayLegacy(
  params: Record<string, string>,
  sign: string,
  pubKeyPem: string,
): Promise<boolean> {
  const { createVerify } = await import("node:crypto");
  const body = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "sign_type")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  try {
    const v = createVerify("RSA-SHA256");
    v.update(body, "utf8");
    return v.verify(pubKeyPem, Buffer.from(sign, "base64"));
  } catch {
    return false;
  }
}

/**
 * Antom / Alipay+ 头部验签：
 * 待签内容为 `POST {path}\n{clientId}.{requestTime}.{rawBody}`
 */
export async function verifyAntom(opts: {
  path: string;
  clientId: string;
  requestTime: string;
  signature: string;
  rawBody: string;
  pubKeyPem: string;
}): Promise<boolean> {
  const { createVerify } = await import("node:crypto");
  const content = `POST ${opts.path}\n${opts.clientId}.${opts.requestTime}.${opts.rawBody}`;
  try {
    const v = createVerify("RSA-SHA256");
    v.update(content, "utf8");
    return v.verify(opts.pubKeyPem, Buffer.from(opts.signature, "base64"));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 幂等 + 事件日志
// ─────────────────────────────────────────────────────────────

const TX_PREFIX = "webhook:tx:";
const EVENT_PREFIX = "webhook:event:";
const EVENT_INDEX = "webhook:event:index";
const EVENT_MAX = 100;
const TX_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface WebhookEvent {
  id: string;
  at: number;
  source: string;
  ok: boolean;
  code?: string;
  amount?: number;
  txId?: string;
  matched: "apply" | "email" | "none";
  userId?: string;
  tier?: Tier;
  plan?: Plan;
  underpaid?: boolean;
  note?: string;
}

/**
 * 幂等：同一笔交易重复推送只处理一次。
 * ⚠️ 官方回调失败会重发最多 8 次（25 小时内），不去重会导致会员被反复续期。
 */
export async function claimTx(txId: string): Promise<boolean> {
  const { getRedis } = await import("@/lib/redis");
  const store = getRedis();
  const key = `${TX_PREFIX}${txId}`;
  const seen = await store.exists(key);
  if (seen) return false;
  await store.set(key, { at: Date.now() }, { ex: TX_TTL_SECONDS });
  return true;
}

export async function recordEvent(e: Omit<WebhookEvent, "id" | "at">): Promise<void> {
  const { getRedis } = await import("@/lib/redis");
  const store = getRedis();
  const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const full: WebhookEvent = { ...e, id, at: Date.now() };
  await store.set(`${EVENT_PREFIX}${id}`, full);
  await store.sadd(EVENT_INDEX, id);

  // 只留最近 EVENT_MAX 条，避免无限增长
  const ids = await store.smembers(EVENT_INDEX);
  if (ids.length > EVENT_MAX) {
    const sorted = [...ids].sort(); // id 前缀是时间戳的 36 进制，字典序 == 时间序
    const drop = sorted.slice(0, ids.length - EVENT_MAX);
    for (const d of drop) {
      await store.del(`${EVENT_PREFIX}${d}`);
      // 无 srem 语义时退化为重建索引
    }
    const keep = sorted.slice(ids.length - EVENT_MAX);
    await store.del(EVENT_INDEX);
    if (keep.length) await store.sadd(EVENT_INDEX, ...keep);
  }
}

export async function listEvents(): Promise<WebhookEvent[]> {
  const { getRedis, getJsonValue } = await import("@/lib/redis");
  const store = getRedis();
  const ids = await store.smembers(EVENT_INDEX);
  const out: WebhookEvent[] = [];
  for (const id of ids) {
    const e = await getJsonValue<WebhookEvent>(`${EVENT_PREFIX}${id}`);
    if (e && typeof e === "object" && e.id) out.push(e);
  }
  out.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return out;
}
