/**
 * 赞助 / 代购的档位定义。
 *
 * 为什么要拆成档位：
 * 收款码是 AlipayHK 的定额码，金额写死在码里。以前全站只有一个 10 HKD，
 * 想收别的金额就得换码。所以把「这笔钱是干什么用的」做成档位，
 * 金额跟档位绑定，站长可以按档位各配一张码。
 *
 * 三档用途：
 * - support：纯赞助，钱直接给站长（生活经费 / 购物基金）
 * - sponsor：赞助站长买域名 —— 站长自己用，付款人不指定
 * - buy：代购域名 —— 付款人指定要哪个域名，站长代买
 *
 * ⚠️ 金额单位统一 HKD：
 * .xyz / .top 的进货价是人民币，赞助档按汇率折算后取整到整数
 * （AlipayHK 扫码付整数最省事），代购档保留你给的原价（含毛票）。
 */

export type SponsorTierId = "support" | "sponsor-xyz" | "sponsor-top" | "buy-xyz" | "buy-top";

export type SponsorTierKind = "support" | "sponsor" | "buy";

export interface SponsorTier {
  id: SponsorTierId;
  /** support=纯赞助 / sponsor=赞助买域名 / buy=代购域名 */
  kind: SponsorTierKind;
  /** 域名档的后缀，纯赞助档为 null */
  tld: string | null;
  amount: number;
  currency: string;
  /** 代购档必须由付款人指定要买哪个域名 */
  requiresDomain: boolean;
  /** 词典键：标题与说明 */
  labelKey: string;
  descKey: string;
}

export const SPONSOR_TIERS: SponsorTier[] = [
  {
    id: "support",
    kind: "support",
    tld: null,
    amount: 10,
    currency: "HKD",
    requiresDomain: false,
    labelKey: "tier.support",
    descKey: "tier.supportDesc",
  },
  {
    id: "sponsor-xyz",
    kind: "sponsor",
    tld: "xyz",
    amount: 7,
    currency: "HKD",
    requiresDomain: false,
    labelKey: "tier.sponsorXyz",
    descKey: "tier.sponsorXyzDesc",
  },
  {
    id: "sponsor-top",
    kind: "sponsor",
    tld: "top",
    amount: 33,
    currency: "HKD",
    requiresDomain: false,
    labelKey: "tier.sponsorTop",
    descKey: "tier.sponsorTopDesc",
  },
  {
    id: "buy-xyz",
    kind: "buy",
    tld: "xyz",
    amount: 6.82,
    currency: "HKD",
    requiresDomain: true,
    labelKey: "tier.buyXyz",
    descKey: "tier.buyXyzDesc",
  },
  {
    id: "buy-top",
    kind: "buy",
    tld: "top",
    amount: 31.78,
    currency: "HKD",
    requiresDomain: true,
    labelKey: "tier.buyTop",
    descKey: "tier.buyTopDesc",
  },
];

/** 纯赞助档：老订单没有 tier 字段时按它处理 */
export const DEFAULT_TIER_ID: SponsorTierId = "support";

export function getTier(id: string | null | undefined): SponsorTier | null {
  if (!id) return null;
  return SPONSOR_TIERS.find((x) => x.id === id) ?? null;
}

/**
 * 档位专属收款码。
 *
 * 不配就共用渠道里第一张码 —— 那样的话付款人需要自己在 App 里改金额，
 * 所以付款页会明确提示「请把金额改为 X」。
 * 想让每档金额固定死，就给每档各配一张定额码：
 * NEXT_PUBLIC_SPONSOR_TIER_QR='{"buy-xyz":"/qr-xyz.png","buy-top":"/qr-top.png"}'
 */
export function tierQr(id: string | null | undefined): string | null {
  if (!id) return null;
  const raw = process.env.NEXT_PUBLIC_SPONSOR_TIER_QR?.trim();
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = (parsed as Record<string, unknown>)[id];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * 域名格式校验。
 *
 * 只做下限判断：像不像一个域名、后缀对不对。
 * 能不能买得到是站长去注册商查的事，这里不该拦。
 *
 * ⚠️ 为什么要求后缀跟档位一致：
 * .xyz 的价买不到 .top，档位和后缀对不上就是一笔说不清的账。
 */
export function validateDomain(value: string, tld: string | null): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  // 去掉可能粘进来的协议头和路径
  const host = v.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  if (host.length < 4 || host.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(host)) {
    return null;
  }
  if (tld && !host.endsWith(`.${tld}`)) return null;
  return host;
}

/** 档位金额展示：整数不带小数，毛票保留两位 */
export function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
