"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";

/**
 * 赞助页的「去付款」。
 *
 * ⚠️ 为什么不再生成二维码让人扫：
 * 二维码的内容是本站付款页的网址，而 AlipayHK 只认自己的付款码，
 * 扫一个网址会直接报「该二维码对应服务无法支持」。
 * 所以在**这台设备**上直接打开付款页才是走得通的路 ——
 * 付款页上放的是站长的真实收款码，用支付 App 扫那张码才有效。
 *
 * 也正因为如此，进页面不会自动建单：
 * 只有真的点了「去付款」才生成订单，避免堆一堆没人付的空单。
 */

export function SponsorPayAction({
  tier,
  domain,
  onError,
}: {
  /** 当前选中的档位；不传按纯赞助档处理 */
  tier?: string;
  /** 代购档指定的域名 */
  domain?: string | null;
  /** 建单失败时把原因告诉外层（比如域名没填） */
  onError?: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  async function go() {
    if (busy) return;
    setBusy(true);
    onErrorRef.current?.(null);
    try {
      const res = await fetch("/api/sponsor/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: tier ?? null, domain: domain ?? null }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        path?: string;
      };
      if (!res.ok || !data.path) {
        onErrorRef.current?.(data.error ?? t("pay.qrFailed"));
        return;
      }
      router.push(data.path);
    } catch {
      onErrorRef.current?.(t("pay.qrFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void go()}
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-[--radius-ctrl] bg-white px-4 py-2.5 text-sm font-semibold text-[#082a63] transition-[transition-duration:var(--motion-fast)] hover:bg-white/90 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {t("sponsor.goPay")}
      {busy ? null : <ArrowUpRight className="h-4 w-4" />}
    </button>
  );
}
