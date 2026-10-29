"use client";

import * as React from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";

/**
 * 赞助页上的付款二维码。
 *
 * ⚠️ 为什么不再直接贴图：
 * 静态收款码只是一条付款指令，站点这边完全不知道有没有人付、付了多少。
 * 所以改成服务端生成的订单码 —— 扫下去先落到本站付款页，
 * 那一页上有本笔订单的令牌，付款人抄进备注、付完再回填交易号，
 * 后台就能一笔一笔对上。
 *
 * ⚠️ 二维码内容只有付款页链接，不含令牌：
 * URL 会进浏览器历史、分享卡片、Referer；
 * 令牌只显示在付款页上，由付款人手动抄进备注 ——
 * 这一步"人工搬运"正是付款凭证与订单对应的凭据。
 */

type Qr = { d: string; size: number };

export function SponsorPayQr({ fallback }: { fallback?: React.ReactNode }) {
  const { t } = useI18n();
  const [qr, setQr] = React.useState<Qr | null>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [failed, setFailed] = React.useState(false);

  const create = React.useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/sponsor/order", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        id?: string;
        path?: string;
      };
      if (!res.ok || !data.path) {
        setFailed(true);
        return;
      }
      // 用访问时的域名拼绝对地址：反代/多域名下都不能写死
      const url = `${window.location.origin}${data.path}`;
      setLink(url);
      try {
        const { qrMatrix, qrSvgPath, qrViewBox } = await import("@/lib/qr");
        const m = qrMatrix(url);
        setQr({ d: qrSvgPath(m), size: qrViewBox(m) });
      } catch {
        // 画不出码也要留链接：手机上可以直接点开
        setQr(null);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  /* 进页面就生成 —— 访客是来付款的，不该再多点一下 */
  React.useEffect(() => {
    void create();
  }, [create]);

  /*
   * 生成失败（存储没配、限流、网络问题）时退回静态收款码。
   * 这条降级很关键：赞助页唯一的目的是让人能付钱，
   * 订单系统挂了不该把收款入口一起带走。
   */
  if (failed) {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm text-white/80">{t("pay.qrFailed")}</p>
        <button
          type="button"
          onClick={create}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("pay.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-[228px] w-full items-center justify-center rounded-2xl bg-white p-4">
        {busy || !qr ? (
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        ) : (
          <svg
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            className="h-full w-full"
            shapeRendering="crispEdges"
          >
            {/* 白底是必须的：大多数扫码器认不出反色码 */}
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
        )}
      </div>

      {/*
        手机上没法扫自己这块屏幕 —— 所以把付款页地址也直接给出来，点一下就到。
        链接里只有订单 id，没有令牌，点了也不会泄露什么。
      */}
      {link ? (
        <a
          href={link}
          className="mt-3 max-w-full truncate text-xs text-white/70 underline decoration-white/30 underline-offset-2 hover:text-white"
        >
          {t("pay.openOnThisDevice")}
        </a>
      ) : null}

      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-white/55 hover:text-white/85 disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        {t("pay.regen")}
      </button>
    </div>
  );
}
