"use client";

import * as React from "react";
import { ArrowLeft, Check, Copy, Crown, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { SPONSOR_CHANNELS } from "@/lib/site";

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

type Tier = "basic" | "pro" | "ultra";
type Plan = "monthly" | "yearly" | "once";

interface TierPlan {
  tier: string;
  plans: Record<string, number>;
}

interface ApplyRow {
  id: string;
  code: string;
  tier: string;
  plan: string;
  amount: number;
  status: string;
  createdAt: number;
  reason?: string;
}

interface State {
  isMember: boolean;
  tier: Tier | null;
  expiresAt: number | null;
  banned: boolean;
  banReason?: string;
  tiers: TierPlan[];
  applies: ApplyRow[];
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
/** 价格后缀：月付要写「每月」，买断只写「一次性」 */
const PLAN_SUFFIX: Record<Plan, string> = {
  monthly: "membership.perMonth",
  yearly: "membership.perYear",
  once: "membership.oneTime",
};
const STATUS_KEY: Record<string, string> = {
  pending: "membership.pending",
  approved: "membership.approved",
  rejected: "membership.rejected",
};

/** 到期时间按 UTC+8 展示 —— 服务端判定也是 UTC+8，两边必须一致 */
function fmtDate(ms?: number | null) {
  if (!ms) return "";
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * 页面
 * ------------------------------------------------------------------ */

export function MembershipPage() {
  const { t } = useI18n();
  const [state, setState] = React.useState<State | null>(null);
  const [loggedIn, setLoggedIn] = React.useState(true);
  const [loading, setLoading] = React.useState(true);

  const [tier, setTier] = React.useState<Tier>("basic");
  const [plan, setPlan] = React.useState<Plan>("once");
  const [busy, setBusy] = React.useState(false);
  /** 提交成功后拿到的会员号，用于在付款区展示 */
  const [code, setCode] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/membership", {
        cache: "no-store",
        signal: timeoutSignal(15000),
      });
      if (res.status === 401) {
        setLoggedIn(false);
        return;
      }
      if (!res.ok) return;
      setState((await res.json()) as State);
    } catch {
      /* 静默：页面已经渲染出骨架，不额外报错 */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // 切档位后，如果当前购买方式不被支持就自动换一个
  React.useEffect(() => {
    const p = state?.tiers?.find((o) => o.tier === tier)?.plans;
    if (p && !p[plan]) setPlan((PLANS.find((x) => p[x]) ?? "once") as Plan);
  }, [tier, plan, state]);

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
      setCode(j.code ?? null);
      toast.success(t("membership.pendingNote"), { duration: 12000 });
      await load();
    } catch {
      toast.error(t("account.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("membership.copyCode"));
    } catch {
      /* 剪贴板在非 HTTPS 下不可用，会员号本身就显示在页面上，不阻断 */
    }
  }

  const channels = (SPONSOR_CHANNELS ?? []).filter((c) => c && c.qr);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-16">
      {/* 返回聊天 */}
      <a
        href="/chat"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("route.chat")}
      </a>

      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("membership.title")}
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("membership.subtitle")}
        </p>
      </header>

      {/* 未登录：会员状态与个人申请都拿不到，只保留档位介绍 */}
      {!loggedIn ? (
        <div className="mb-8 rounded-xl border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
          {t("membership.loginToApply")}
          <a href="/login?redirect=/membership" className="ml-2 text-primary underline underline-offset-4">
            {t("membership.goLogin")}
          </a>
        </div>
      ) : null}

      {/* 当前状态 */}
      {loggedIn && state ? (
        <section className="mb-8">
          {state.banned ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {t("membership.banned")}
              {state.banReason ? `（${state.banReason}）` : ""}
            </div>
          ) : state.tier ? (
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <Crown className="h-4 w-4 text-primary" />
              <span className="text-muted-foreground">{t("membership.current")}</span>
              <Badge>{t(TIER_KEY[state.tier])}</Badge>
              <span className="text-muted-foreground">
                {state.expiresAt
                  ? `${t("membership.expiresAt")}：${fmtDate(state.expiresAt)}`
                  : t("membership.permanent")}
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-center text-sm text-muted-foreground">
              {t("membership.notMember")}
            </div>
          )}
        </section>
      ) : null}

      {/* 档位选择 */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          {t("membership.choose")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {TIERS.map((x) => {
            const selected = tier === x;
            const isCurrent = state?.tier === x;
            return (
              <button
                key={x}
                type="button"
                onClick={() => setTier(x)}
                className={`relative rounded-2xl border p-4 text-left transition-all ${
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                    : "border-border hover:border-primary/40 hover:bg-muted/40"
                }`}
              >
                {isCurrent ? (
                  <span className="absolute right-3 top-3">
                    <Check className="h-4 w-4 text-primary" />
                  </span>
                ) : null}
                <div className="font-semibold">{t(TIER_KEY[x])}</div>
                <div className="mt-1 text-2xl font-semibold tracking-tight">
                  {PLANS.filter((p) => priceOf(x, p)).map((p) => (
                    <div key={p} className="text-base font-normal text-muted-foreground">
                      ¥{priceOf(x, p)}{" "}
                      <span className="text-xs">{t(PLAN_SUFFIX[p])}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {t(PERK_KEY[x])}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* 申请 / 付款 */}
      {loggedIn ? (
        <section className="mb-10 rounded-2xl border border-border p-5">
          <div className="flex flex-wrap items-center gap-2">
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

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button disabled={busy || amount == null} onClick={() => void apply()}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("membership.apply")
              )}
            </Button>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {t("membership.pendingNote")}。{t("membership.overdue")}
            </span>
          </div>

          {/* 提交后才出现：会员号 + 收款码 */}
          {code ? (
            <div className="mt-6 rounded-xl bg-muted/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{t("membership.yourCode")}</span>
                <code className="rounded bg-background px-2 py-1 font-mono text-sm tracking-wider">
                  {code}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copyCode()}>
                  <Copy className="h-3.5 w-3.5" />
                  {t("membership.copyCode")}
                </Button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("membership.payNote")}
              </p>

              {channels.length > 0 ? (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <QrCode className="h-3.5 w-3.5" />
                    {t("membership.payTo")}
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {channels.map((c) => (
                      <div key={c.id} className="w-[160px]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={c.qr}
                          alt={c.name}
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full rounded-xl bg-white object-contain"
                        />
                        <p className="mt-1.5 text-center text-xs text-muted-foreground">
                          {c.name}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* 申请记录 */}
      {loggedIn && state?.applies?.length ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            {t("membership.myApplies")}
          </h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("membership.code")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("membership.title")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("membership.amount")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("membership.appliedAt")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("membership.status")}</th>
                </tr>
              </thead>
              <tbody>
                {state.applies.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                    <td className="px-3 py-2">
                      {t(TIER_KEY[a.tier as Tier] ?? "membership.tier.basic")}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {t(PLAN_KEY[a.plan as Plan] ?? "membership.plan.once")}
                      </span>
                    </td>
                    <td className="px-3 py-2">¥{a.amount}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {fmtDate(a.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={a.status === "approved" ? "default" : "secondary"}>
                        {t(STATUS_KEY[a.status] ?? a.status)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : loggedIn && state && !loading ? (
        <p className="text-sm text-muted-foreground">{t("membership.noApplies")}</p>
      ) : null}
    </div>
  );
}
