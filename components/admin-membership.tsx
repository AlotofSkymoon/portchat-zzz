"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { SiteFooter } from "@/components/site-footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeoutSignal } from "@/lib/fetch-timeout";

interface Apply {
  id: string;
  userId: string;
  email: string;
  tier: string;
  plan: string;
  amount: number;
  code: string;
  status: string;
  createdAt: number;
  handledAt?: number;
  rejectReason?: string;
}

interface Member {
  userId: string;
  email: string;
  tier: string;
  plan?: string;
  expiresAt?: number;
  banned?: boolean;
  banReason?: string;
  updatedAt?: number;
}

type Data = {
  pending: Apply[];
  approved: Apply[];
  members: Member[];
  adminId: string;
};

const TIER_LABEL: Record<string, string> = {
  basic: "membership.tier.basic",
  pro: "membership.tier.pro",
  ultra: "membership.tier.ultra",
};
const PLAN_LABEL: Record<string, string> = {
  monthly: "membership.plan.monthly",
  yearly: "membership.plan.yearly",
  once: "membership.plan.once",
};

function fmtTime(ms?: number) {
  if (!ms) return "—";
  // 统一按 UTC+8 展示，跟服务端到期判定口径一致
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") + " (UTC+8)";
}

export function AdminMembership() {
  const { t } = useI18n();
  const [data, setData] = React.useState<Data | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/membership", {
        cache: "no-store",
        signal: timeoutSignal(15000),
      });
      const j = (await res.json()) as Data & { error?: string };
      if (!res.ok) {
        toast.error(j.error ?? t("membership.unknownAction"));
        return;
      }
      setData(j);
    } catch {
      toast.error(t("account.networkError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, id: string, extra?: Record<string, string>) {
    setBusy(action + id);
    try {
      const res = await fetch("/api/admin/membership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeoutSignal(15000),
        body: JSON.stringify({ action, id, ...extra }),
      });
      const j = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        toast.error(j.error ?? t("membership.unknownAction"));
        return;
      }
      toast.success(t("admin.saved"));
      setReason((p) => ({ ...p, [id]: "" }));
      await load();
    } catch {
      toast.error(t("account.networkError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link
        href="/admin"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("admin.title")}
      </Link>

      <h1 className="mb-1 text-2xl font-bold">{t("membership.title")}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t("membership.pendingNote")}</p>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("membership.adminPending")}</CardTitle>
          <CardDescription>{t("membership.codeHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("membership.adminEmpty")}</p>
          ) : null}

          {data?.pending.map((a) => (
            <div key={a.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{t(TIER_LABEL[a.tier] ?? a.tier)}</Badge>
                <Badge variant="secondary">{t(PLAN_LABEL[a.plan] ?? a.plan)}</Badge>
                <span className="font-semibold">
                  {t("membership.amount")} ¥{a.amount}
                </span>
              </div>
              <p className="mt-2 text-sm">
                <span className="text-muted-foreground">{t("membership.code")}：</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{a.code}</code>
              </p>
              <p className="text-sm text-muted-foreground">{a.email}</p>
              <p className="text-xs text-muted-foreground">{fmtTime(a.createdAt)}</p>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void act("approve", a.id)}
                >
                  {busy === "approve" + a.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("membership.approve")
                  )}
                </Button>
                <div className="flex items-end gap-2">
                  <div>
                    <Label className="text-xs">{t("membership.rejectReason")}</Label>
                    <Input
                      className="h-8 w-40"
                      value={reason[a.id] ?? ""}
                      onChange={(e) =>
                        setReason((p) => ({ ...p, [a.id]: e.target.value }))
                      }
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      void act("reject", a.id, { reason: reason[a.id] ?? "" })
                    }
                  >
                    {t("membership.reject")}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("membership.adminMembers")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data?.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("membership.adminMemberEmpty")}</p>
          ) : null}

          {data?.members.map((m) => (
            <div key={m.userId} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{t(TIER_LABEL[m.tier] ?? m.tier)}</Badge>
                {m.banned ? (
                  <Badge variant="destructive">{t("membership.ban")}</Badge>
                ) : null}
                <span className="text-sm">{m.email}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {m.expiresAt ? t("membership.expiresAt") + "：" + fmtTime(m.expiresAt) : t("membership.permanent")}
              </p>
              {m.banReason ? (
                <p className="text-xs text-destructive">
                  {t("membership.banReason")}：{m.banReason}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {m.banned ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void act("unban", m.userId)}
                  >
                    {t("membership.unban")}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void act("revoke", m.userId)}
                    >
                      {t("membership.revoke")}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() => void act("ban", m.userId)}
                    >
                      {t("membership.ban")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="mt-8">
        <SiteFooter />
      </div>
    </div>
  );
}
