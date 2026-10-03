"use client";

import React from "react";
import { Coins, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/i18n-provider";

interface CreditData {
  enabled: boolean;
  available?: number;
  purchased?: number;
  monthlyGranted?: number;
  monthlyLeft?: number;
  totalSpent?: number;
  cycle?: string;
  rules?: {
    monthlyGrant: number;
    costDefault: number;
    costInkstone: number;
    costDeepseek: number;
    pointsPerUnit: number;
  };
}

/**
 * 积分卡片。
 *
 * 显示余额 + 计费规则 + 充值入口。
 * 充值不是在线支付 —— 收款码收的钱不会回调站点，
 * 所以只能「用户转账填备注 → 提交申请 → 站长核对 → 后台通过」。
 */
export function CreditsCard({ user }: { user: { email: string } | null }) {
  const { t } = useI18n();
  const [data, setData] = React.useState<CreditData | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/credits");
      const d = (await res.json().catch(() => null)) as CreditData | null;
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  if (!user) return null;
  if (data && data.enabled === false) return null;

  async function submit() {
    setMsg(null);
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setMsg({ ok: false, text: t("credits.badAmount") });
      return;
    }
    if (!note.trim()) {
      setMsg({ ok: false, text: t("credits.noteRequired") });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/credits/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, note: note.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setMsg({ ok: false, text: d.error ?? t("credits.submitFailed") });
      } else {
        setMsg({ ok: true, text: t("credits.submitted") });
        setAmount("");
        setNote("");
        void load();
      }
    } catch {
      setMsg({ ok: false, text: t("credits.submitFailed") });
    } finally {
      setSubmitting(false);
    }
  }

  const points = Number(amount) > 0 && data?.rules
    ? Math.floor(Number(amount) * data.rules.pointsPerUnit)
    : 0;

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/40 p-3">
      <div className="flex items-center gap-2">
        <Coins className="h-4 w-4" />
        <span className="text-sm font-medium">{t("credits.title")}</span>
        <span className="ml-auto flex items-center gap-1.5 text-sm font-semibold">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {data?.available ?? "—"}
        </span>
      </div>

      {data?.rules ? (
        <div className="space-y-1 text-[11px] text-fg-tertiary">
          <p>
            {t("credits.monthly", { n: data.rules.monthlyGrant })}
            {data.monthlyLeft !== undefined ? ` · ${t("credits.left", { n: data.monthlyLeft })}` : ""}
          </p>
          <p>
            {t("credits.costRule", {
              d: data.rules.costDefault,
              i: data.rules.costInkstone,
              s: data.rules.costDeepseek,
            })}
          </p>
          {data.purchased ? <p>{t("credits.purchased", { n: data.purchased })}</p> : null}
        </div>
      ) : null}

      <details className="rounded-lg border border-border/60 px-2.5 py-2">
        <summary className="cursor-pointer text-xs font-medium">{t("credits.topup")}</summary>
        <div className="mt-2.5 space-y-2">
          <p className="text-[11px] leading-relaxed text-fg-tertiary">
            {t("credits.topupHint")}
          </p>
          <Input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("credits.amountPh")}
            className="h-8 text-xs"
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("credits.notePh")}
            className="h-8 text-xs"
            maxLength={120}
          />
          {points > 0 ? (
            <p className="text-[11px] text-primary">{t("credits.willGet", { n: points })}</p>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={submitting}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("credits.submit")}
          </Button>
          {msg ? (
            <p className={msg.ok ? "text-[11px] text-primary" : "text-[11px] text-destructive"}>
              {msg.text}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
