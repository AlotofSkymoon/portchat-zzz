"use client";

import Link from "next/link";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Coffee, Github, HeartHandshake, Loader2, Share2 } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { SponsorPayAction } from "@/components/sponsor/sponsor-pay-qr";
import {
  REPO_URL,
  SHOW_SOURCE_LINKS,
  SITE_NAME,
  SPONSOR_CHANNELS,
  sponsorChannelReady,
} from "@/lib/site";
import {
  DEFAULT_TIER_ID,
  SPONSOR_TIERS,
  formatAmount,
  getTier,
  validateDomain,
  type SponsorTierId,
} from "@/lib/sponsor-tiers";
import { DEFAULT_PAY_METHOD, payMethods } from "@/lib/pay-methods";

/**
 * 赞助页的文案主体。
 *
 * ⚠️ 为什么从 page.tsx 抽出来单独做客户端组件：
 * 语言切换是客户端状态，服务端组件读不到 ——
 * 文案留在服务端渲染的话，切了语言标题也不会变。
 * 页面本身保留 metadata（SEO 需要服务端产出），只把文案挪到这里。
 *
 * ⚠️ 为什么整页文字用白色系而不是主题变量：
 * 背景是蓝天白云，深浅两种主题下都要压得住。
 * .on-sky 给文字加了投影，白云飘到字下面也不会糊。
 */

/** 资金去向 —— 写清楚比含糊的「请我喝杯咖啡」更有说服力 */
const USE_KEYS = ["living", "shopping", "motivation"] as const;

export function SponsorContent() {
  const { t } = useI18n();

  /*
   * 档位：默认纯赞助。
   * 换档位时二维码要重建 —— 金额写在订单里，
   * 沿用上一个档位的码会出现「选了 .top 却按 .xyz 的金额付」。
   */
  const [tierId, setTierId] = React.useState<SponsorTierId>(DEFAULT_TIER_ID);
  const [domain, setDomain] = React.useState("");
  const [tierErr, setTierErr] = React.useState<string | null>(null);
  const tier = getTier(tierId) ?? getTier(DEFAULT_TIER_ID)!;

  /*
   * 支付方式。
   * 默认 Pot Pay —— 它是唯一能即时到账的；线下渠道要等人工核销。
   */
  const router = useRouter();
  /*
   * AlipayHK 与支付宝分开判断 —— 配了哪个哪个才能选。
   * 以前共用一个开关，配了 AlipayHK 就把内地支付宝也点亮，
   * 选了却跳到一个没有码的付款页。
   */
  const methods = React.useMemo(
    () =>
      payMethods({
        alipayhkReady: sponsorChannelReady(SPONSOR_CHANNELS.find((c) => c.id === "alipayhk")),
        alipayReady: sponsorChannelReady(SPONSOR_CHANNELS.find((c) => c.id === "alipay")),
      }),
    [],
  );
  const [methodId, setMethodId] = React.useState<string>(DEFAULT_PAY_METHOD);
  const [paying, setPaying] = React.useState(false);
  const [paid, setPaid] = React.useState(false);
  const method = methods.find((x) => x.id === methodId) ?? methods[methods.length - 1]!;

  const domainValue = validateDomain(domain, tier.tld);
  const domainReady = !tier.requiresDomain || domainValue !== null;

  async function payWithWallet() {
    setPaying(true);
    setTierErr(null);
    try {
      const res = await fetch("/api/sponsor/pay-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tier.id, domain: domainValue }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401) {
        // 余额跟账号绑定，没登录就先去登录，回来还在赞助页
        router.push("/login?redirect=/sponsor");
        return;
      }
      if (!res.ok) {
        setTierErr(data.error ?? "支付失败，请稍后再试");
        return;
      }
      setPaid(true);
    } catch {
      setTierErr("支付失败，请稍后再试");
    } finally {
      setPaying(false);
    }
  }

  /*
   * Star / 提 Issue 都指向仓库地址 —— 与页脚同理，默认不暴露。
   * 关掉后只剩「分享给朋友」这条不依赖外链的方式。
   */
  const otherWays = [
    ...(SHOW_SOURCE_LINKS
      ? [
          {
            icon: Github,
            titleKey: "sponsor.way.star",
            descKey: "sponsor.way.starDesc",
            href: REPO_URL,
            ctaKey: "sponsor.way.goRepo",
          },
        ]
      : []),
    {
      icon: Share2,
      titleKey: "sponsor.way.share",
      descKey: "sponsor.way.shareDesc",
      href: null,
      ctaKey: null,
    },
    ...(SHOW_SOURCE_LINKS
      ? [
          {
            icon: HeartHandshake,
            titleKey: "sponsor.way.feedback",
            descKey: "sponsor.way.feedbackDesc",
            href: `${REPO_URL}/issues`,
            ctaKey: "sponsor.way.submit",
          },
        ]
      : []),
  ];

  return (
    <div className="on-sky relative mx-auto max-w-3xl px-4 py-10 sm:py-14">
      {/* 返回聊天 */}
      <Link
        href="/chat"
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-white/85 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("sponsor.back")}
      </Link>

      {/* 标题 */}
      <header className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#082a63]/50 text-white backdrop-blur-sm">
          <Coffee className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("sponsor.support")} {SITE_NAME}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/90">
          {t("sponsor.free")}
          <br />
          {t("sponsor.note")}
        </p>
      </header>

      {/* 选档位 —— 金额跟档位绑定，选完下面的码才对得上 */}
      <section className="mx-auto mb-6 max-w-[560px]">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SPONSOR_TIERS.map((x) => {
            const active = x.id === tierId;
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => {
                  setTierId(x.id);
                  setTierErr(null);
                }}
                aria-pressed={active}
                className={`rounded-[var(--radius-card)] border px-3.5 py-3 text-left transition-[border-color,background-color] [transition-duration:var(--motion-fast)] ${
                  active
                    ? "border-white/70 bg-[#082a63]/70"
                    : "border-white/25 bg-[#082a63]/45 hover:border-white/45 hover:bg-[#082a63]/60"
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-white">{t(x.labelKey)}</span>
                  <span className="shrink-0 text-sm font-semibold text-white">
                    {formatAmount(x.amount)} {x.currency}
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-white/80">
                  {t(x.descKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 代购档：指定要买哪个域名 */}
      {tier.requiresDomain ? (
        <div className="mx-auto mb-6 max-w-[360px]">
          <label className="block text-xs text-white/85" htmlFor="sponsor-domain">
            {t("tier.domainLabel")}
          </label>
          <input
            id="sponsor-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={t("tier.domainPlaceholder", { tld: tier.tld ?? "" })}
            className="mt-1.5 w-full rounded-[var(--radius-ctrl)] border border-white/30 bg-white/15 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/50 focus:border-white/60"
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/70">
            {t("tier.domainHint", { tld: tier.tld ?? "" })}
          </p>
          {domain.trim() && !domainReady ? (
            <p className="mt-1 text-[11px] text-red-200">{t("tier.domainInvalid")}</p>
          ) : null}
        </div>
      ) : null}

      {/* 选支付方式 —— 只有真正接得上的才让选，其余标「即将支持」 */}
      <section className="mx-auto mb-6 max-w-[560px]">
        <p className="mb-2 text-center text-xs text-white/85">
          {t("sponsor.payMethod")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {methods.map((m) => {
            const active = m.id === method.id;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!m.enabled}
                onClick={() => {
                  setMethodId(m.id);
                  setTierErr(null);
                  setPaid(false);
                }}
                aria-pressed={active}
                className={`rounded-[var(--radius-card)] border px-3.5 py-2.5 text-left transition-[border-color,background-color] [transition-duration:var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-45 ${
                  active
                    ? "border-white/70 bg-[#082a63]/70"
                    : "border-white/25 bg-[#082a63]/45 hover:border-white/45 hover:bg-[#082a63]/60"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">{t(m.labelKey)}</span>
                  {m.enabled ? null : (
                    <span className="shrink-0 rounded-full border border-white/30 px-1.5 py-0.5 text-[10px] text-white/80">
                      {t("sponsor.comingSoon")}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-white/80">
                  {t(m.descKey)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 付款动作 —— 余额即时扣，线下渠道跳付款页扫站长的码 */}
      <div className="mx-auto max-w-[320px] rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl">
        {paid ? (
          <p className="flex items-center justify-center gap-2 py-4 text-sm font-medium text-white">
            <Check className="h-4 w-4" />
            {t("sponsor.paidByWallet")}
          </p>
        ) : method.kind === "wallet" ? (
          <button
            type="button"
            onClick={() => void payWithWallet()}
            disabled={paying || !domainReady}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-ctrl)] bg-white px-4 py-2.5 text-sm font-semibold text-[#082a63] transition-[transition-duration:var(--motion-fast)] hover:bg-white/90 disabled:opacity-60"
          >
            {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("sponsor.payByWallet", { amount: formatAmount(tier.amount) })}
          </button>
        ) : domainReady ? (
          <SponsorPayAction
            tier={tier.id}
            domain={domainValue}
            channel={method.id}
            onError={setTierErr}
          />
        ) : (
          <p className="py-8 text-center text-sm text-white/80">
            {t("tier.needDomain")}
          </p>
        )}
        <p className="mt-3 text-center text-[11px] leading-relaxed text-white/70">
          {tier.requiresDomain
            ? t("tier.payHintDomain", { amount: formatAmount(tier.amount) })
            : method.kind === "wallet"
              ? t("sponsor.walletHint")
              : t("sponsor.pick")}
        </p>
        {tierErr ? (
          <p className="mt-1.5 text-center text-[11px] text-red-200">{tierErr}</p>
        ) : null}
      </div>

      {/* 资金去向 */}
      <section className="mt-10">
        <h2 className="mb-4 text-center text-sm font-medium text-white/85">
          {t("sponsor.where")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {USE_KEYS.map((k) => (
            <div
              key={k}
              className="rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl"
            >
              <p className="text-sm font-medium text-white">
                {t(`sponsor.use.${k}`)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/80">
                {t(`sponsor.use.${k}Desc`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 其他支持方式 */}
      <section className="mt-10">
        <h2 className="mb-4 text-center text-sm font-medium text-white/85">
          {t("sponsor.other")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {otherWays.map((w) => {
            const Icon = w.icon;
            const body = (
              <>
                <Icon className="mb-2.5 h-4 w-4 text-white" />
                <p className="text-sm font-medium text-white">{t(w.titleKey)}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/80">
                  {t(w.descKey)}
                </p>
                {w.ctaKey ? (
                  <span className="mt-2.5 inline-block text-xs font-medium text-white">
                    {t(w.ctaKey)} →
                  </span>
                ) : null}
              </>
            );
            /* 原来是 hover:scale-[1.02] —— 无差别缩放弹跳是廉价感来源之一。
               改成「描边变亮 + 底色加深」，反馈真实、不靠假动作。 */
            return w.href ? (
              <Link
                key={w.titleKey}
                href={w.href}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl transition-[border-color,background-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--motion-ease-out)] hover:border-white/45 hover:bg-[#082a63]/60"
              >
                {body}
              </Link>
            ) : (
              <div
                key={w.titleKey}
                className="rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl"
              >
                {body}
              </div>
            );
          })}
        </div>
      </section>

      {/* 说明 */}
      <p className="mt-10 text-center text-xs leading-relaxed text-white/75">
        {t("sponsor.voluntary")}
      </p>

      {SHOW_SOURCE_LINKS ? (
        <div className="mt-8 flex justify-center">
          <Link
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-white/60 underline decoration-dotted underline-offset-2 hover:text-white"
          >
            {t("sponsor.homepage")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
