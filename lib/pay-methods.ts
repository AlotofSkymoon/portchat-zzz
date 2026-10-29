/**
 * 支付方式。
 *
 * 为什么要单独拆一个文件：
 * 「这笔钱怎么付」和「这笔钱是干什么用的」（档位）是两件事，
 * 混在一起的话每次加渠道都要动档位表。
 *
 * ⚠️ 现实约束 —— 目前只有两种能真正走通：
 *   - manual 类：线下渠道。付款人扫站长的收款码付款，再回来填交易号核销。
 *     能不能用取决于站长有没有配对应的码（见 lib/site.ts 的渠道配置）。
 *   - wallet 类：Pot Pay 站内余额，即时扣款、无需核销。
 *
 * Apple Pay / 银行卡 / 内地支付宝都需要真实商户号与在线支付通道，
 * 站点现在没有，所以标成即将支持 —— 但选项先摆出来，
 * 免得每次都要改前端结构。
 */

export type PayMethodId = "alipayhk" | "alipay" | "applepay" | "bankcard" | "potpay";

export interface PayMethod {
  id: PayMethodId;
  /**
   * manual = 线下渠道，走收款码 + 交易号核销
   * wallet = 站内余额，即时扣款
   */
  kind: "manual" | "wallet";
  /** 是否真的可用。false 的会在界面上标「即将支持」并禁止选择 */
  enabled: boolean;
  labelKey: string;
  descKey: string;
}

/**
 * 渠道是否可用由站点配置决定，所以做成函数而不是常量数组。
 *
 * alipayhk 能不能用 = 站长有没有配收款码；
 * 一张码都没配的话摆出来点了也只是个空页面。
 */
export function payMethods(opts: { hasManualChannel?: boolean } = {}): PayMethod[] {
  const manual = opts.hasManualChannel ?? false;
  return [
    {
      id: "alipayhk",
      kind: "manual",
      enabled: manual,
      labelKey: "payMethod.alipayhk",
      descKey: "payMethod.alipayhkDesc",
    },
    {
      id: "alipay",
      kind: "manual",
      // 内地支付宝需要内地实名商户号，与 AlipayHK 不是一个体系
      enabled: false,
      labelKey: "payMethod.alipay",
      descKey: "payMethod.alipayDesc",
    },
    {
      id: "applepay",
      kind: "manual",
      enabled: false,
      labelKey: "payMethod.applepay",
      descKey: "payMethod.applepayDesc",
    },
    {
      id: "bankcard",
      kind: "manual",
      enabled: false,
      labelKey: "payMethod.bankcard",
      descKey: "payMethod.bankcardDesc",
    },
    {
      id: "potpay",
      kind: "wallet",
      enabled: true,
      labelKey: "payMethod.potpay",
      descKey: "payMethod.potpayDesc",
    },
  ];
}

export const DEFAULT_PAY_METHOD: PayMethodId = "potpay";

export function getPayMethod(id: string | null | undefined): PayMethod | null {
  if (!id) return null;
  return payMethods().find((x) => x.id === id) ?? null;
}
