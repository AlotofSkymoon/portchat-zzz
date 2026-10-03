"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 重发倒计时（秒），与服务端冷却保持一致 */
const COOLDOWN = 60;

export function VerifyForm() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();

  /*
   * 邮箱优先从 query 带过来（注册成功后跳转会带上）。
   * 没有的话让用户手填 —— 直接刷新这个页面时不该把人挡在门外。
   */
  const [email, setEmail] = React.useState(() => searchParams.get("email") ?? "");
  const [code, setCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [resending, setResending] = React.useState(false);
  const [left, setLeft] = React.useState(0);

  React.useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (code.trim().length !== 6) {
      toast.error(t("auth.enterCode"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), action: "verify" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("auth.verifyFailed"));
        return;
      }
      toast.success(t("auth.verifyOk"));
      router.push("/chat");
      router.refresh();
    } catch {
      toast.error(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    if (resending || left > 0) return;
    if (!email.trim()) {
      toast.error(t("auth.fillEmailFirst"));
      return;
    }
    setResending(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), action: "resend" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("auth.resendFailed"));
        return;
      }
      toast.success(t("auth.codeResent"));
      setLeft(COOLDOWN);
    } catch {
      toast.error(t("common.retryLater"));
    } finally {
      setResending(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-2xl brand-gradient shadow-xl shadow-primary/30">
          <MailCheck className="h-6 w-6 text-primary-foreground" />
        </div>
        <CardTitle className="text-2xl">{t("auth.verifyTitle")}</CardTitle>
        <CardDescription>
          {t("auth.verifyDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">{t("auth.verifyCode")}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t("auth.codePlaceholder")}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center text-lg tracking-[0.4em]"
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("auth.submitVerify")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={resend}
            disabled={resending || left > 0}
          >
            {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {left > 0 ? `${t("auth.resendCode")}（${left}s）` : t("auth.resendCode")}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {t("verify.noCode")}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mx-1 font-medium text-primary hover:underline"
            >
              {t("verify.refreshPage")}
            </button>
            {t("verify.again")}
          </p>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t("verify.backToLogin")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
