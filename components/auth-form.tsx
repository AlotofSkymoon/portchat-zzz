"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  /* ---- 邮箱验证码（注册时用；未配置邮件服务则整块隐藏）---- */
  const [verifyEnabled, setVerifyEnabled] = React.useState(false);
  const [codeSent, setCodeSent] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [left, setLeft] = React.useState(0);

  /*
   * 是否开启邮箱验证由服务端决定（配没配 Resend）。
   * 不查的话，没配邮件服务时也会显示「发送验证码」，点了必然失败。
   */
  React.useEffect(() => {
    if (mode !== "register") return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/verify", { signal: timeoutSignal(8_000) });
        const data = (await res.json().catch(() => ({}))) as { enabled?: boolean };
        if (alive) setVerifyEnabled(!!data.enabled);
      } catch {
        // 查不到就按「没开启」处理：宁可不显示按钮，也不显示一个点了会失败的按钮
        if (alive) setVerifyEnabled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode]);

  React.useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  async function sendCode() {
    if (sending || left > 0) return;
    if (!email.trim()) {
      toast.error(t("auth.fillEmailFirst"));
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
        signal: timeoutSignal(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("auth.resendFailed"));
        return;
      }
      toast.success(t("auth.codeSentToEmail"));
      setCodeSent(true);
      setLeft(60);
    } catch {
      toast.error(t("common.retryLater"));
    } finally {
      setSending(false);
    }
  }

  const isLogin = mode === "login";
  /** 开了邮箱验证就必须先拿到码，否则注册接口会退回「发码 + 跳 /verify」 */
  const needCode = !isLogin && verifyEnabled;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (needCode) {
      if (!codeSent) {
        toast.error(t("auth.sendCodeFirst"));
        return;
      }
      if (code.trim().length !== 6) {
        toast.error(t("auth.enterCode"));
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isLogin ? { email, password } : { email, password, code: needCode ? code.trim() : undefined },
        ),
      });
      const data = (await res.json()) as {
        error?: string;
        isFirstUser?: boolean;
        needVerification?: boolean;
        email?: string;
        mailFailed?: boolean;
      };

      if (!res.ok) {
        /*
         * 登录被"邮箱未验证"拦下时，直接把人送到验证页 ——
         * 否则用户只知道登不进去，不知道该去哪补验证。
         */
        if (data.needVerification && data.email) {
          router.push(`/verify?email=${encodeURIComponent(data.email)}`);
          return;
        }
        toast.error(data.error ?? t("auth.operationFailed"));
        return;
      }

      /*
       * 注册需要验证邮箱：不建 session，先去验证页。
       * 邮件没发出去时（mailFailed）服务端已放行并给了 session，走正常跳转。
       */
      if (!isLogin && data.needVerification) {
        toast.success(t("auth.codeSent"));
        router.push(`/verify?email=${encodeURIComponent(data.email ?? email)}`);
        return;
      }

      if (!isLogin && data.isFirstUser) {
        toast.success(t("auth.firstAdmin"));
      } else if (!isLogin && needCode) {
        // 走「先验证再注册」这条路时，到这里已经是验证通过的账号
        toast.success(t("auth.registerOk"));
      } else if (data.mailFailed) {
        // 邮件服务异常，已放行但让用户知道验证码没发出去
        toast.success(t("auth.registerOkNoMail"));
      } else {
        toast.success(isLogin ? t("auth.loginOk") : t("auth.registerOk"));
      }

      router.push(redirectTo);
      router.refresh();
    } catch {
      toast.error(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-2xl brand-gradient shadow-xl shadow-primary/30">
          <Sparkles className="h-6 w-6 text-primary-foreground" />
        </div>
        <CardTitle className="text-2xl">{isLogin ? t("auth.login") : t("auth.register")}</CardTitle>
        <CardDescription>
          {isLogin
            ? t("auth.loginDesc")
            : t("auth.registerDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
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
          {needCode ? (
            <div className="space-y-2">
              <Label htmlFor="email-code">
                {t("auth.verifyCode")}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {t("auth.registerVerifyHint")}
                </span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="email-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder={t("auth.codePlaceholder")}
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center text-lg tracking-[0.4em]"
                />
                <Button
                  type="button"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => void sendCode()}
                  disabled={sending || left > 0}
                >
                  {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {codeSent
                    ? left > 0
                      ? `${t("auth.resend")}（${left}s）`
                      : t("auth.resend")
                    : t("auth.sendCode")}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder={isLogin ? t("auth.passwordHint") : t("auth.passwordMin")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isLogin ? undefined : 8}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isLogin ? (
              <LogIn className="h-4 w-4" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            {isLogin ? t("auth.login") : t("auth.register")}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
            <Link
              href={isLogin ? "/register" : "/login"}
              className="font-medium text-primary hover:underline"
            >
              {isLogin ? t("auth.goRegister") : t("auth.goLogin")}
            </Link>
          </p>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/chat" className="hover:underline">
              {t("auth.backToChat")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
