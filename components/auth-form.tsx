"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronUp,
  Github,
  KeyRound,
  Loader2,
  LogIn,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrScanner } from "@/components/qr-scanner";

/** base64url → ArrayBuffer（登录令牌等二进制场景需要） */
function b64urlToBuffer(b64url: string): ArrayBuffer {
  const pad = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** ArrayBuffer → base64url（服务端按 base64url 解） */
function bufferToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  /*
   * 登录/注册完成后一律回 /chat —— 这站的主界面就是聊天页，
   * 跳回落地页会让人以为"登录了怎么又回到首页"。
   * redirect 参数只接受站内绝对路径，挡掉 //evil.com、https://evil.com 这类开放重定向。
   */
  const rawRedirect = searchParams.get("redirect") || "";
  const redirectTo = /^\/[A-Za-z0-9/_?=&%-]*$/.test(rawRedirect) ? rawRedirect : "/chat";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  /* ---- 两步验证：登录接口返回 needTwoFactor 时才出现 ---- */
  const [twoFactor, setTwoFactor] = React.useState("");
  const [needTwoFactor, setNeedTwoFactor] = React.useState(false);

  /* ---- GitHub 登录：没配 Client ID 就不显示按钮 ---- */
  const [githubEnabled, setGithubEnabled] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/oauth/github?probe=1", { signal: timeoutSignal(8_000) });
        const data = (await res.json().catch(() => ({}))) as { enabled?: boolean };
        if (alive) setGithubEnabled(!!data.enabled);
      } catch {
        if (alive) setGithubEnabled(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---- 登录令牌：另一台已登录设备生成的一串字符，粘贴到这里即可登录 ---- */
  const [tokenOpen, setTokenOpen] = React.useState(false);
  const [loginToken, setLoginToken] = React.useState("");
  const [tokenBusy, setTokenBusy] = React.useState(false);
  const [scanOpen, setScanOpen] = React.useState(false);

  /* ---- 待注销提醒：登录当下必须让人看见，否则一进聊天就忘了这事 ---- */
  const [deleteInMinutes, setDeleteInMinutes] = React.useState<number | null>(null);

  /**
   * 登录成功后先查一次注销状态。
   *
   * 为什么拦在跳转前：真进了聊天页，顶部横幅很容易被当成普通公告划走；
   * 而「账号还有 X 分钟就没了」是此刻最该知道的事。
   * 查不到（未登录 / 接口挂了）一律放行，不能因为这一个检查让人登不进去。
   */
  async function proceedAfterLogin() {
    try {
      const res = await fetch("/api/account/delete", { signal: timeoutSignal(6_000) });
      const data = (await res.json().catch(() => ({}))) as {
        pending?: boolean;
        minutesLeft?: number;
      };
      if (res.ok && data.pending) {
        setDeleteInMinutes(data.minutesLeft ?? 0);
        return;
      }
    } catch {
      /* 查不到就正常放行 */
    }
    router.push(redirectTo);
    router.refresh();
  }

  /** 用令牌换会话。扫码和粘贴两条路都走这里，逻辑只有一份 */
  async function claimWithToken(raw: string) {
    if (tokenBusy) return;
    const value = raw.trim();
    if (!value) {
      toast.error(t("auth.tokenRequired"));
      return;
    }
    setTokenBusy(true);
    try {
      const res = await fetch("/api/auth/qr/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
        signal: timeoutSignal(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? t("auth.tokenFailed"));
        return;
      }
      toast.success(t("auth.loginOk"));
      setLoginToken("");
      setScanOpen(false);
      await proceedAfterLogin();
    } catch {
      toast.error(t("auth.networkError"));
    } finally {
      setTokenBusy(false);
    }
  }

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
          isLogin
            ? { email, password, code: twoFactor.trim() || undefined }
            : { email, password, code: needCode ? code.trim() : undefined },
        ),
      });
      const data = (await res.json()) as {
        error?: string;
        isFirstUser?: boolean;
        needVerification?: boolean;
        needTwoFactor?: boolean;
        email?: string;
        mailFailed?: boolean;
      };

      if (!res.ok) {
        /*
         * 开了两步验证：密码对但还没验码，不发会话。
         * 这里把验证码框显示出来，用户填完再点一次登录（这次会带上 code）。
         * 好处是不用多开一个页面，密码也还在输入框里。
         */
        if (isLogin && data.needTwoFactor) {
          setNeedTwoFactor(true);
          toast.error(data.error ?? t("auth.twoFactorRequired"));
          return;
        }
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

      /*
       * 注册成功**不自动登录**，跳去登录页让用户自己输一遍密码。
       * 理由：自动登录容易让人注册完就忘了密码（尤其是随手填的），
       * 下一台设备登录时才发现想不起来。多一步输入等于一次记忆确认。
       */
      if (isLogin) {
        await proceedAfterLogin();
      } else {
        const qs = redirectTo && redirectTo !== "/chat" ? `?redirect=${encodeURIComponent(redirectTo)}` : "";
        router.push(`/login${qs}`);
        router.refresh();
      }
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
        {/*
          待注销横幅。
          放在表单最上面而不是 toast：toast 几秒就没了，
          而这件事需要用户当场做决定（取消还是继续）。
        */}
        {deleteInMinutes === null ? null : (
          <div className="mb-4 space-y-2 rounded-xl border border-destructive/50 bg-destructive/10 px-3 py-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t("auth.deletePendingTitle")}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("auth.deletePendingDesc", { minutes: String(deleteInMinutes) })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => router.push("/account")}
              >
                {t("auth.deleteGoCancel")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => {
                  setDeleteInMinutes(null);
                  router.push(redirectTo);
                  router.refresh();
                }}
              >
                {t("auth.deleteContinue")}
              </Button>
            </div>
          </div>
        )}
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
                  onPaste={(e) => {
                    /*
                     * 从邮件里整段复制时，正文可能带「验证码：」「30 分钟内有效」等文字，
                     * 默认粘贴 + maxLength 截断可能截出错误的 6 位。
                     * 剪贴板里能找到连续 6 位就直接用那一串，否则交给上面的 onChange 兜底。
                     */
                    const text = e.clipboardData.getData("text") ?? "";
                    const hit = text.match(/\d{6}/);
                    if (hit) {
                      e.preventDefault();
                      setCode(hit[0]);
                    }
                  }}
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

          {isLogin && needTwoFactor ? (
            <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <Label htmlFor="two-factor-code">{t("auth.twoFactorCode")}</Label>
              <Input
                id="two-factor-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder={t("auth.codePlaceholder")}
                maxLength={10}
                autoFocus
                value={twoFactor}
                onChange={(e) => setTwoFactor(e.target.value.replace(/[^0-9A-Za-z]/g, ""))}
                onPaste={(e) => {
                  // 验证器 App 复制出来通常是「123 456」这种带空格的，直接取数字串
                  const text = e.clipboardData.getData("text") ?? "";
                  const digits = text.replace(/\D/g, "");
                  if (digits) {
                    e.preventDefault();
                    setTwoFactor(digits);
                  }
                }}
                className="text-center text-lg tracking-[0.4em]"
              />
              <p className="text-xs text-muted-foreground">{t("auth.twoFactorHint")}</p>
            </div>
          ) : null}

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

          {isLogin ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setTokenOpen((o) => !o)}
                className="flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {t("auth.useToken")}
                {tokenOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>

              {tokenOpen ? (
                <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3">
                  <Input
                    id="login-token"
                    value={loginToken}
                    onChange={(e) => setLoginToken(e.target.value)}
                    placeholder={t("auth.tokenPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={tokenBusy || loading}
                    onClick={() => void claimWithToken(loginToken)}
                  >
                    {tokenBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <KeyRound className="h-4 w-4" />
                    )}
                    {t("auth.tokenLogin")}
                    <span className="ml-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      {t("auth.experimentalBadge")}
                    </span>
                  </Button>
                  <p className="text-[11px] text-muted-foreground">{t("auth.tokenHint")}</p>
                </div>
              ) : null}

              {tokenOpen ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={tokenBusy || loading}
                  onClick={() => setScanOpen(true)}
                >
                  <Camera className="h-4 w-4" />
                  {t("auth.scanLogin")}
                  <span className="ml-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    {t("auth.experimentalBadge")}
                  </span>
                </Button>
              ) : null}
            </div>
          ) : null}

          {githubEnabled ? (
            <>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{t("auth.orUse")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  // 整页跳转（不是 fetch）：要带着浏览器去 GitHub 授权页
                  const qs = redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : "";
                  window.location.href = `/api/auth/oauth/github${qs}`;
                }}
              >
                <Github className="h-4 w-4" />
                {t("auth.loginWithGithub")}
              </Button>
            </>
          ) : null}

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

      {/*
       * 扫码登录：二维码里只有令牌本身，扫到就直接去换会话。
       * 放在 form 外面 —— 放进 form 里按回车会触发表单提交。
       */}
      {isLogin ? (
        <QrScanner
          open={scanOpen}
          onClose={() => setScanOpen(false)}
          onResult={(text) => void claimWithToken(text)}
        />
      ) : null}
    </Card>
  );
}
