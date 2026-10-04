"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { timeoutSignal } from "@/lib/fetch-timeout";

type Tier = "basic" | "pro" | "ultra";
type Plan = "monthly" | "yearly" | "once";

interface TierPlan {
  tier: string;
  plans: Record<string, number>;
}

interface State {
  tier: Tier | null;
  plan?: Plan;
  expiresAt?: number;
  banned?: boolean;
  banReason?: string;
  tiers: TierPlan[];
}

const TIERS: Tier[] = ["basic", "pro", "ultra"];
const PLANS: Plan[] = ["monthly", "yearly", "once"];

const TIER_KEY: Record<Tier, string> = {
  basic: "membership.tier.basic",
  pro: "membership.tier.pro",
  ultra: "membership.tier.ultra",
};
const PLAN_KEY: Record<Plan, string> = {
  monthly: "membership.plan.monthly",
  yearly: "membership.plan.yearly",
  once: "membership.plan.once",
};
const PERK_KEY: Record<Tier, string> = {
  basic: "membership.perk.basic",
  pro: "membership.perk.pro",
  ultra: "membership.perk.ultra",
};

function fmt(ms?: number) {
  if (!ms) return "";
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function MembershipCard({ user }: { user: { id: string } | null }) {
  const { t } = useI18n();
  const [state, setState] = React.useState<State | null>(null);
  const [tier, setTier] = React.useState<Tier>("basic");
  const [plan, setPlan] = React.useState<Plan>("once");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/membership", {
        cache: "no-store",
        signal: timeoutSignal(15000),
      });
      if (!res.ok) return;
      setState((await res.json()) as State);
    } catch {
      /* 静默：会员卡片挂掉不该影响整个设置页 */
    }
  }, [user]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 档位切换时，若该档位没有当前购买方式就自动换成它支持的第一个
  React.useEffect(() => {
    if (state?.tiers) {
      const p = state.tiers.find((o) => o.tier === tier)?.plans;
      if (p && !p[plan]) setPlan((PLANS.find((x) => p[x]) ?? "once") as Plan);
    }
  }, [tier, plan, state]);

  if (!user) return null;

  const priceOf = (x: Tier, p: Plan) =>
    state?.tiers?.find((o) => o.tier === x)?.plans?.[p];
  const amount = priceOf(tier, plan);

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeoutSignal(15000),
        body: JSON.stringify({ tier, plan }),
      });
      const j = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        toast.error(j.error ?? t("membership.unknownAction"));
        return;
      }
      toast.success(
        `${t("membership.code")} ${j.code} · ${t("membership.pendingNote")}`,
        { duration: 12000 },
      );
      await load();
    } catch {
      toast.error(t("account.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("membership.title")}</CardTitle>
        <CardDescription>{t("membership.myStatus")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state?.banned ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t("membership.banned")}
            {state.banReason ? `（${state.banReason}）` : ""}
          </p>
        ) : null}

        {state?.tier ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge>{t(TIER_KEY[state.tier])}</Badge>
            <span className="text-muted-foreground">
              {state.expiresAt
                ? `${t("membership.expiresAt")}：${fmt(state.expiresAt)}`
                : t("membership.permanent")}
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("membership.notMember")}</p>
        )}

        <div className="space-y-2">
          {TIERS.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setTier(x)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                tier === x ? "border-primary bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{t(TIER_KEY[x])}</span>
                <span className="text-xs text-muted-foreground">
                  {PLANS.filter((p) => priceOf(x, p))
                    .map((p) => `¥${priceOf(x, p)} ${t(PLAN_KEY[p])}`)
                    .join(" / ")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(PERK_KEY[x])}</p>
            </button>
          ))}
        </div>

        {amount != null ? (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <div className="flex flex-wrap gap-2">
              {PLANS.filter((p) => priceOf(tier, p)).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={plan === p ? "default" : "outline"}
                  onClick={() => setPlan(p)}
                >
                  {t(PLAN_KEY[p])} ¥{priceOf(tier, p)}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("membership.codeHint")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("membership.pendingNote")}。{t("membership.overdue")}
            </p>
            <Button size="sm" disabled={busy} onClick={() => void apply()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("membership.apply")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
