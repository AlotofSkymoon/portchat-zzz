"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, TriangleAlert } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { SPONSOR_CHANNELS, sponsorChannelReady, type SponsorChannel } from "@/lib/site";
import { payMethods } from "@/lib/pay-methods";
import { formatAmount, getTier, tierQr } from "@/lib/sponsor-tiers";

/**
 * 付款页主体。
 *
 * 三块内容：
 *   1) 本笔订单的令牌 —— 付款人要抄进付款备注
 *   2) 真实收款码 —— 照常用 AlipayHK 扫它付款
 *   3) 付款后填交易号
 *
 * ⚠️ 收款码用渠道里的第一张，而不是写死文件名：
 * 站长改了渠道配置（环境变量）之后这里要跟着变，
 * 否则会出现"付款页的码和站长实际用的码不是同一个"。
 */

type OrderView = {
  id: string;
  token: string;
  tier: string;
  amount: number;
  currency: string;
  domain: string | null;
  /** sponsor = 赞助/代购；recharge = 给 Pot Pay 充值 */
  purpose?: string;
  status: string;
  scannedAt: number | null;
  claimedAt: number | null;
  tradeNo: string | null;
};

export function PayClient() {
  const { t } = useI18n();
  const params = useSearchParams();
  const id = (params.get("o") ?? "").trim();

  const [order, setOrder] = React.useState<OrderView | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [tradeNo, setTradeNo] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  /*
   * 付款方式：AlipayHK / 支付宝全都列出来，各自标清能不能用。
   *
   * ⚠️ 为什么不过滤掉没配的：
   * 以前只列「有码或链接」的渠道，站长没配内地支付宝时付款人就
   * 只看到 AlipayHK 一个，既不知道还有别的路，也不知道是没配还是不支持。
   * 现在没配的照列、标「未配置」并禁止点击。
   */
  const channels = React.useMemo(() => SPONSOR_CHANNELS, []);
  // 赞助页选了哪个渠道就默认选中哪个（?c=alipayhk 之类）
  const wantChannel = (params.get("c") ?? "").trim();
  const [channelId, setChannelId] = React.useState<string>(() => {
    const picked = channels.find((c) => c.id === wantChannel && sponsorChannelReady(c));
    return picked?.id ?? channels.find(sponsorChannelReady)?.id ?? channels[0]?.id ?? "";
  });
  const channel: SponsorChannel | null =
    channels.find((c) => c.id === channelId) ?? channels.find(sponsorChannelReady) ?? null;
  const channelOk = sponsorChannelReady(channel);

  /* 付款方式按钮：跟赞助页同一套口径（能不能用 = 站长有没有配对应的码） */
  const manualMethods = React.useMemo(
    () =>
      payMethods({
        alipayhkReady: sponsorChannelReady(channels.find((c) => c.id === "alipayhk")),
        alipayReady: sponsorChannelReady(channels.find((c) => c.id === "alipay")),
      }).filter((m) => m.kind === "manual"),
    [channels],
  );

  /* 用真实支付链接现生成二维码 —— 不依赖 public/ 里有没有那张图 */
  const [qrSvg, setQrSvg] = React.useState<{ path: string; size: number } | null>(null);
  React.useEffect(() => {
    const url = channel?.payUrl?.trim();
    if (!url) {
      setQrSvg(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { qrMatrix, qrSvgPath, qrViewBox } = await import("@/lib/qr");
        const matrix = qrMatrix(url);
        if (!alive) return;
        setQrSvg({ path: qrSvgPath(matrix), size: qrViewBox(matrix) });
      } catch {
        if (alive) setQrSvg(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [channel?.payUrl]);

  /* 读订单 */
  React.useEffect(() => {
    if (!id) {
      setErr(t("pay.noOrder"));
      setLoading(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/sponsor/order/${encodeURIComponent(id)}`);
        const data = (await res.json().catch(() => ({}))) as OrderView & { error?: string };
        if (!alive) return;
        if (!res.ok) {
          setErr(data.error ?? t("pay.loadFailed"));
        } else {
          setOrder(data);
          setTradeNo(data.tradeNo ?? "");
          if (data.claimedAt) setDone(t("pay.submitted"));
        }
      } catch {
        if (alive) setErr(t("pay.loadFailed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, t]);

  /* 标记已扫码：只有浏览器真的打开这一页才算 */
  React.useEffect(() => {
    if (!id || !order) return;
    void fetch(`/api/sponsor/order/${encodeURIComponent(id)}`, { method: "POST" }).catch(
      () => undefined,
    );
  }, [id, order]);

  async function copyToken() {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板不可用时令牌就摆在页面上，手抄也能完成
    }
  }

  async function submit() {
    if (!order) return;
    const no = tradeNo.trim();
    if (no.length < 8) {
      setErr(t("pay.tradeNoTooShort"));
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/sponsor/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, tradeNo: no, contact: contact.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setErr(data.error ?? t("pay.submitFailed"));
        return;
      }
      setDone(data.message ?? t("pay.submitted"));
    } catch {
      setErr(t("pay.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const isRecharge = order?.purpose === "recharge";
  const backHref = isRecharge ? "/account" : "/sponsor";
  const backLabel = isRecharge ? t("pay.backToAccount") : t("pay.backToSponsor");
  const tier = order ? getTier(order.tier) : null;
  /*
   * 档位有专属码就用专属码（金额写死在码里，最省事）；
   * 没有就共用渠道那张 —— 那时金额对不上，必须提示付款人自己改。
   */
  const tierQrSrc = order ? tierQr(order.tier) : null;
  /*
   * 展示用的码图：档位专属码 → 渠道码图。
   *
   * ⚠️ 但它只是**兜底**。只要渠道有 payUrl，就优先用 payUrl 现生成的码
   * （见下方 qrSvg）—— 那才是能保证扫得出来的：
   * 图片文件可能没放进 public/，而 payUrl 是实时编码的。
   */
  const qrSrc = tierQrSrc ?? channel?.qr?.trim() ?? null;
  const needManualAmount = !tierQrSrc;
  const payUrl = channel?.payUrl?.trim() ?? "";

  if (loading) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-fg-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  if (err && !order) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <TriangleAlert className="h-7 w-7 text-fg-tertiary" />
          <p className="text-sm text-fg-secondary">{err}</p>
          <Link
            href={backHref}
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>
        </div>
      </Shell>
    );
  }

  if (!order) return null;

  return (
    <Shell>
      {/* 充值单：说清楚钱会去哪，别让付款人以为是赞助 */}
      {isRecharge ? (
        <p className="rounded-[--radius-card] border border-primary/30 bg-primary/5 px-4 py-3 text-xs leading-relaxed text-fg-secondary">
          {t("pay.rechargeHint", { amount: formatAmount(order.amount) })}
        </p>
      ) : null}

      {/* ① 令牌 */}
      <section className="rounded-[--radius-card] border border-border bg-bg-surface p-5">
        <h2 className="text-sm font-medium text-fg-secondary">{t("pay.tokenTitle")}</h2>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-[--radius-ctrl] bg-bg-subtle px-3 py-2.5 font-mono text-base font-semibold tracking-wide text-fg-primary">
            {order.token}
          </code>
          <button
            type="button"
            onClick={copyToken}
            aria-label={t("pay.copyToken")}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-ctrl] border border-border bg-bg-surface text-fg-secondary transition-[transition-duration:var(--motion-fast)] hover:bg-bg-subtle"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-fg-tertiary">
          {t("pay.tokenHint")}
        </p>
      </section>

      {/* ② 收款码 */}
      <section className="rounded-[--radius-card] border border-border bg-bg-surface p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-fg-secondary">
            {isRecharge
              ? t("wallet.rechargeFor")
              : tier
                ? t(tier.labelKey)
                : t("pay.amountTitle")}
            {/*
              充值单就是 Pot Pay 的入口 —— 账记在站内余额里，
              不是付给站长的赞助款，所以测试版标记要在这里也出现一次，
              免得付款人以为自己在走一条成熟流程。
            */}
            {isRecharge ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                {t("pay.betaBadge")}
              </span>
            ) : null}
          </h2>
          <span className="text-lg font-semibold text-fg-primary">
            {formatAmount(order.amount)} {order.currency}
          </span>
        </div>
        {tier?.descKey ? (
          <p className="mt-1 text-xs leading-relaxed text-fg-tertiary">
            {t(tier.descKey)}
          </p>
        ) : null}
        {order.domain ? (
          <p className="mt-2 rounded-[--radius-ctrl] bg-bg-subtle px-3 py-2 text-sm text-fg-primary">
            <span className="text-fg-tertiary">{t("pay.domainLabel")}：</span>
            <span className="font-mono font-semibold">{order.domain}</span>
          </p>
        ) : null}
        {/*
          选付款方式：AlipayHK 还是支付宝。
          两个体系各自独立，没配的那个标「未配置」并禁止点击 ——
          不藏起来，付款人至少知道有这条路、也知道是没配而不是不支持。
        */}
        {manualMethods.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-fg-tertiary">{t("pay.pickMethod")}</p>
            <div className="flex flex-wrap gap-1.5">
              {manualMethods.map((m) => {
                const active = m.id === channel?.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!m.enabled}
                    onClick={() => setChannelId(m.id)}
                    aria-pressed={active}
                    className={`rounded-[--radius-ctrl] border px-2.5 py-1 text-xs transition-[transition-duration:var(--motion-fast)] disabled:cursor-not-allowed disabled:opacity-45 ${
                      active
                        ? "border-primary bg-primary/10 text-fg-primary"
                        : "border-border text-fg-tertiary hover:bg-bg-subtle"
                    }`}
                  >
                    {t(m.labelKey)}
                    {m.enabled ? null : (
                      <span className="ml-1 text-[10px] opacity-80">
                        {t("pay.notConfigured")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/*
          ① 优先用 payUrl 现生成的码。
          内容是**真实支付链接**，AlipayHK / 支付宝扫了直接进支付页；
          以前生成的是本站付款页地址，扫码器不认，才报「无法对应」。
        */}
        {qrSvg ? (
          <svg
            viewBox={`0 0 ${qrSvg.size} ${qrSvg.size}`}
            role="img"
            aria-label={t("sponsor.qrAlt", { name: channel?.name ?? "收款码" })}
            className="mx-auto mt-4 aspect-square w-full max-w-[260px] rounded-[--radius-ctrl] bg-white p-2"
          >
            <path d={qrSvg.path} fill="#000" />
          </svg>
        ) : qrSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrSrc}
            alt={t("sponsor.qrAlt", { name: channel?.name ?? "收款码" })}
            width={640}
            height={640}
            className="mx-auto mt-4 aspect-square w-full max-w-[260px] rounded-[--radius-ctrl] bg-white object-contain"
          />
        ) : (
          /*
           * 站长没配这个渠道的码 —— 明确说出来。
           * 以前这里什么都不渲染，付款人看到一片空白，
           * 只会以为站坏了，不知道其实是没配置。
           */
          <p className="mx-auto mt-4 w-full max-w-[260px] rounded-[--radius-ctrl] border border-dashed border-border px-3 py-8 text-center text-xs leading-relaxed text-fg-tertiary">
            {t("pay.channelNotReady", { name: channel?.name ?? "" })}
          </p>
        )}

        {/* ② 不用扫码的那条路：直接打开支付页 */}
        {payUrl ? (
          <a
            href={payUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-[--radius-ctrl] bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg"
          >
            <ExternalLink className="h-4 w-4" />
            {t("pay.openPayPage", { name: channel?.name ?? "" })}
          </a>
        ) : null}

        <p className="mt-3 text-center text-xs leading-relaxed text-fg-tertiary">
          {needManualAmount
            ? t("pay.amountHint", { amount: formatAmount(order.amount) })
            : (channel?.note ?? t("pay.scanHint"))}
        </p>
        {payUrl ? (
          <p className="mt-1.5 text-center text-[11px] leading-relaxed text-fg-quaternary">
            {t("pay.payUrlHint")}
          </p>
        ) : null}
      </section>

      {/* ③ 已付款确认 */}
      <section className="rounded-[--radius-card] border border-border bg-bg-surface p-5">
        <h2 className="text-sm font-medium text-fg-secondary">{t("pay.confirmTitle")}</h2>

        {done ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-fg-primary">
            <Check className="h-4 w-4" />
            {done}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2.5">
            <input
              value={tradeNo}
              onChange={(e) => setTradeNo(e.target.value)}
              placeholder={t("pay.tradeNoPlaceholder")}
              className="w-full rounded-[--radius-ctrl] border border-border bg-bg-base px-3 py-2.5 text-sm text-fg-primary outline-none placeholder:text-fg-quaternary focus:border-primary"
            />
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("pay.contactPlaceholder")}
              className="w-full rounded-[--radius-ctrl] border border-border bg-bg-base px-3 py-2.5 text-sm text-fg-primary outline-none placeholder:text-fg-quaternary focus:border-primary"
            />
            <p className="text-xs leading-relaxed text-fg-tertiary">
              {t("pay.tradeNoHint")}
            </p>
            {err ? <p className="text-xs text-red-500">{err}</p> : null}
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-[--radius-ctrl] bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("pay.submit")}
            </button>
          </div>
        )}
      </section>

      <Link
        href={backHref}
        className="mt-1 inline-flex items-center gap-1.5 self-center text-sm text-fg-tertiary hover:text-fg-secondary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <header className="mb-1">
        <h1 className="text-xl font-semibold text-fg-primary">{t("pay.title")}</h1>
        <p className="mt-1 text-sm leading-relaxed text-fg-tertiary">
          {t("pay.subtitle")}
        </p>
      </header>
      {children}
    </div>
  );
}
