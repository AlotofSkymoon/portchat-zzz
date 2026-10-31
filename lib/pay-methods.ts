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
  /**
   * 是否处于测试阶段。true 的会在界面上标「测试版」。
   *
   * ⚠️ 跟 enabled 是两件事：enabled 问的是「这条路接没接通」，
   * beta 问的是「接通了但还在试」。Pot Pay 属于后者 —— 能用，
   * 但余额规则、计费方式随时可能改，得让付款人事先知道。
   */
  beta?: boolean;
  labelKey: string;
  descKey: string;
}

/**
 * 渠道是否可用由站点配置决定，所以做成函数而不是常量数组。
 *
 * ⚠️ AlipayHK 和支付宝是**两个独立体系**，得分别判断：
 * 以前只有一个 hasManualChannel 开关，结果站长配了 AlipayHK 之后
 * 内地支付宝也被点亮，点了却跳到一个没有码的付款页。
 * 现在各自看自己有没有配。
 */
export function payMethods(
  opts: { alipayhkReady?: boolean; alipayReady?: boolean; hasManualChannel?: boolean } = {},
): PayMethod[] {
  // 兼容旧调用：只给了 hasManualChannel 就当它指的是 AlipayHK
  const fallback = opts.hasManualChannel ?? false;
  const hk = opts.alipayhkReady ?? fallback;
  const cn = opts.alipayReady ?? false;
  return [
    {
      id: "alipayhk",
      kind: "manual",
      enabled: hk,
      labelKey: "payMethod.alipayhk",
      descKey: hk ? "payMethod.alipayhkDesc" : "payMethod.alipayhkDescOff",
    },
    {
      id: "alipay",
      kind: "manual",
      /*
       * 内地支付宝与 AlipayHK 不是一个体系，需要站长另配一张内地码。
       * 配了就可用（同样是扫站长的码 + 回填交易号）；
       * 没配就摆出来但禁用，付款人至少知道有这条路。
       */
      enabled: cn,
      labelKey: "payMethod.alipay",
      descKey: cn ? "payMethod.alipayDesc" : "payMethod.alipayDescOff",
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
      beta: true,
      labelKey: "payMethod.potpay",
      descKey: "payMethod.potpayDesc",
    },
  ];
}

export const DEFAULT_PAY_METHOD: PayMethodId = "potpay";

export function getPayMethod(
  id: string | null | undefined,
  opts: { alipayhkReady?: boolean; alipayReady?: boolean; hasManualChannel?: boolean } = {},
): PayMethod | null {
  if (!id) return null;
  // ⚠️ 必须把站点配置传进去 —— 否则查出来的 enabled 恒为 false，
  // 明明能用的渠道会被判成不可用。
  return payMethods(opts).find((x) => x.id === id) ?? null;
}
