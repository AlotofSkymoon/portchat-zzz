"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LogIn, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
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

  const isLogin = mode === "login";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/${isLogin ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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
            <Link href="/" className="hover:underline">
              {t("auth.backToChat")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
