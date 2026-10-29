"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { formatFen } from "@/lib/wallet";

/**
 * Pot Pay 钱包卡片（账户页）。
 *
 * 三块：余额 → 充值 → 流水。
 *
 * ⚠️ 充值为什么要跳去付款页：
 * 站点没有在线支付通道，收款靠站长的 AlipayHK 收款码 + 交易号核销，
 * 所以充值和赞助走的是同一条路 —— 生成订单 → 付款页显示令牌和收款码 →
 * 付款人回填交易号 → 审核通过入账。差别只在订单的 purpose。
 */

/** 快捷充值档（元） —— 也可以自己填 1–500 之间的任意整数 */
const QUICK_AMOUNTS = [10, 30, 50, 100] as const;

type LedgerView = {
  id: string;
  kind: string;
  deltaFen: number;
  balanceFen: number;
  orderId: string | null;
  note: string | null;
  at: number;
};

export function WalletCard() {
  const { t } = useI18n();
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [balanceFen, setBalanceFen] = React.useState(0);
  const [ledger, setLedger] = React.useState<LedgerView[]>([]);
  const [amount, setAmount] = React.useState("10");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/wallet");
      const data = (await res.json().catch(() => ({}))) as {
        balanceFen?: number;
        ledger?: LedgerView[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "");
      setBalanceFen(typeof data.balanceFen === "number" ? data.balanceFen : 0);
      setLedger(Array.isArray(data.ledger) ? data.ledger : []);
    } catch {
      // 读不到就保持上一次的值，不让整页崩掉
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function recharge() {
    const yuan = Number(amount);
    if (!Number.isFinite(yuan) || yuan < 1 || yuan > 500) {
      toast.error(t("wallet.amountInvalid"));
      return;
    }
    if (Math.round(yuan * 100) !== yuan * 100) {
      toast.error(t("wallet.amountInvalid"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/recharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: yuan }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        path?: string;
        amount?: number;
      };
      if (!res.ok || !data.path) {
        toast.error(data.error ?? t("wallet.createFailed"));
        return;
      }
      // 跳付款页：同一台设备上直接打开，不用扫自己的屏幕
      router.push(data.path);
    } catch {
      toast.error(t("wallet.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pr-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {t("wallet.title")}
            <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {t("wallet.potpay")}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">{t("wallet.desc")}</p>
        </div>
        <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {/* 余额 */}
      <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-3">
        <p className="text-[11px] text-muted-foreground">{t("wallet.balance")}</p>
        <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums">
          {loading ? "—" : `HK$ ${formatFen(balanceFen)}`}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t("wallet.usage", { price: "0.01" })}</p>
      </div>

      {/* 充值 */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              aria-pressed={amount === String(v)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                amount === String(v)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:border-primary/50"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="10"
            aria-label={t("wallet.amountLabel")}
            className="w-24 rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void recharge()}
            className="flex-1"
          >
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {t("wallet.recharge")}
            <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t("wallet.rechargeHint")}
        </p>
      </div>

      {/* 流水 */}
      {ledger.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground">
            {t("wallet.ledger")}
          </p>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {ledger.map((x) => (
              <li
                key={x.id}
                className="flex items-baseline justify-between gap-2 rounded-lg border border-border/50 px-2.5 py-1.5 text-[11px]"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  {x.kind === "recharge"
                    ? t("wallet.kindRecharge")
                    : x.kind === "spend"
                      ? t("wallet.kindSpend")
                      : t("wallet.kindAdjust")}
                  {x.note ? ` · ${x.note}` : ""}
                </span>
                <span
                  className={`shrink-0 font-mono tabular-nums ${
                    x.deltaFen >= 0 ? "text-green-600 dark:text-green-400" : "text-fg-secondary"
                  }`}
                >
                  {x.deltaFen >= 0 ? "+" : "−"}
                  {formatFen(Math.abs(x.deltaFen))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
