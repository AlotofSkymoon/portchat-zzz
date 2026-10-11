"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fingerprint, Github, Loader2, LogIn, Sparkles, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** base64url → ArrayBuffer（WebAuthn 的 challenge 必须是二进制） */
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

  /*
   * ---- Passkey 登录 ----
   *
   * 只在浏览器真的支持 WebAuthn 时才显示按钮，否则点了必然报错。
   * 另外还要检查有没有配存储：Passkey 凭据存 Redis，没配就直接不显示。
   */
  const [passkeyReady, setPasskeyReady] = React.useState(false);
  const [passkeyBusy, setPasskeyBusy] = React.useState(false);
  React.useEffect(() => {
    if (mode !== "login") return;
    /*
     * 只探测浏览器能力，不请求服务端：
     * 未登录的人调 /api/passkey 必然 401，拿不到有意义的结果。
     * 存储没配的情况会在点击时由接口给出明确报错，不影响按钮显示与否。
     */
    const supported =
      typeof window !== "undefined" &&
      !!window.PublicKeyCredential &&
      !!navigator.credentials?.get;
    setPasskeyReady(supported);
  }, [mode]);

  async function loginWithPasskey() {
    if (passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      const optRes = await fetch("/api/passkey/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "login" }),
        signal: timeoutSignal(10_000),
      });
      const opt = (await optRes.json().catch(() => ({}))) as {
        chalId?: string;
        challenge?: string;
        rpId?: string;
        timeout?: number;
        error?: string;
      };
      if (!optRes.ok || !opt.chalId || !opt.challenge || !opt.rpId) {
        toast.error(opt.error ?? t("auth.passkeyFailed"));
        return;
      }

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: b64urlToBuffer(opt.challenge),
          rpId: opt.rpId,
          userVerification: "preferred",
          timeout: opt.timeout ?? 60_000,
        },
      });
      if (!credential) {
        toast.error(t("auth.passkeyFailed"));
        return;
      }

      // 断言（登录）响应体才有 signature / authenticatorData / userHandle，
      // 基类 AuthenticatorResponse 上只有 clientDataJSON，直接读会报类型错
      const pk = credential as PublicKeyCredential;
      const assertion = pk.response as AuthenticatorAssertionResponse;
      const userHandle = assertion.userHandle ?? null;

      const res = await fetch("/api/passkey/authenticate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chalId: opt.chalId,
          credential: {
            id: pk.id,
            rawId: bufferToB64url(pk.rawId),
            response: {
              clientDataJSON: bufferToB64url(assertion.clientDataJSON),
              authenticatorData: bufferToB64url(assertion.authenticatorData),
              signature: bufferToB64url(assertion.signature),
              userHandle: userHandle ? bufferToB64url(userHandle) : null,
            },
          },
        }),
        signal: timeoutSignal(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? t("auth.passkeyFailed"));
        return;
      }
      toast.success(t("auth.passkeyOk"));
      router.replace(redirectTo);
      router.refresh();
    } catch {
      toast.error(t("auth.passkeyFailed"));
    } finally {
      setPasskeyBusy(false);
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
        router.push(redirectTo);
        router.refresh();
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

          {isLogin && passkeyReady ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => void loginWithPasskey()}
              disabled={passkeyBusy || loading}
            >
              {passkeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
              {t("auth.loginWithPasskey")}
              <span className="ml-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                {t("auth.experimentalBadge")}
              </span>
            </Button>
          ) : null}
          {isLogin && passkeyReady ? (
            <p className="text-center text-[11px] text-muted-foreground">{t("auth.passkeyExperimental")}</p>
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
    </Card>
  );
}
