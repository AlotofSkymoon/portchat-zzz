"use client";

/**
 * 账号类设置卡片（昵称 / 邮箱换绑 / GitHub 绑定 / 两步验证）。
 *
 * 放在独立文件里，是为了让「聊天设置弹窗」和「/account 账户设置页」共用同一份实现 ——
 * 以前只在弹窗里有，账户页就只剩改密码，形同虚设。
 */

import * as React from "react";
import { Github, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { useI18n } from "@/components/i18n-provider";

/**
 * 两步验证卡片。
 *
 * 流程刻意做成两步：先出密钥 → 用户用验证器输一次码 → 才真正启用。
 * 直接生成即启用的话，扫码失败的人会被自己的 2FA 锁在门外。
 */
export function TwoFactorCard() {
  const { t } = useI18n();
  const [enabled, setEnabled] = React.useState(false);
  const [backupRemaining, setBackupRemaining] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  // setup 阶段：密钥 + otpauth:// 链接（还没写进账号）
  const [secret, setSecret] = React.useState("");
  const [uri, setUri] = React.useState("");
  const [code, setCode] = React.useState("");
  const [newCodes, setNewCodes] = React.useState<string[]>([]);
  const [password, setPassword] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa", { signal: timeoutSignal(8_000) });
      const data = (await res.json().catch(() => ({}))) as {
        enabled?: boolean;
        backupRemaining?: number;
      };
      setEnabled(!!data.enabled);
      setBackupRemaining(data.backupRemaining ?? 0);
    } catch {
      /* 查不到就当没开 */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, method: "POST" | "DELETE" = "POST") {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        secret?: string;
        uri?: string;
        backupCodes?: string[];
      };
      if (!res.ok) {
        toast.error(data.error ?? t("common.retryLater"));
        return null;
      }
      return data;
    } catch {
      toast.error(t("common.retryLater"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function setup() {
    const data = await post({ action: "setup" });
    if (!data) return;
    setSecret(data.secret ?? "");
    setUri(data.uri ?? "");
    setCode("");
  }

  async function enable() {
    if (code.trim().length !== 6) {
      toast.error(t("auth.enterCode"));
      return;
    }
    const data = await post({ action: "enable", secret, code: code.trim() });
    if (!data) return;
    setNewCodes(data.backupCodes ?? []);
    setSecret("");
    setUri("");
    setCode("");
    void load();
  }

  async function disable() {
    const data = await post({ code: code.trim() || undefined, password: password || undefined }, "DELETE");
    if (!data) return;
    setNewCodes([]);
    setPassword("");
    setCode("");
    void load();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  /* 已开启：只显示状态和关闭入口 */
  if (enabled) {
    return (
      <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="pr-3">
            <p className="text-sm font-medium">{t("settings.twoFactor")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.twoFactorOnDesc")}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.twoFactorBackupLeft")}：{backupRemaining}
            </p>
          </div>
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        </div>
        <div className="flex gap-2">
          <Input
            inputMode="numeric"
            placeholder={t("auth.codePlaceholder")}
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9A-Za-z]/g, ""))}
          />
          <Button type="button" variant="destructive" size="sm" className="shrink-0" disabled={busy} onClick={() => void disable()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("settings.twoFactorDisable")}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t("settings.twoFactorDisableHint")}</p>
      </div>
    );
  }

  /* 没开启：绑定流程 */
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pr-3">
          <p className="text-sm font-medium">{t("settings.twoFactor")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.twoFactorDesc")}</p>
        </div>
      </div>

      {!secret ? (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void setup()}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("settings.twoFactorSetup")}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t("settings.twoFactorScanHint")}</p>
          <Input readOnly value={secret} className="font-mono text-xs" />
          <Input readOnly value={uri} className="font-mono text-[11px]" />
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              placeholder={t("auth.codePlaceholder")}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <Button type="button" size="sm" className="shrink-0" disabled={busy} onClick={() => void enable()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("settings.twoFactorEnable")}
            </Button>
          </div>
        </div>
      )}

      {newCodes.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            {t("settings.twoFactorBackupHint")}
          </p>
          <div className="grid grid-cols-2 gap-1 font-mono text-xs">
            {newCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * GitHub 绑定卡片（设置里，仅登录可见）
 *
 * 绑定要跳出去再跳回来，所以用一个一次性标记避免重复弹提示：
 * 回调回来时 URL 上带 oauth_bound=1，落地后立刻从地址栏抹掉。
 */
export function GithubBindCard({ redirect = "/chat" }: { redirect?: string } = {}) {
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [enabled, setEnabled] = React.useState(false);
  const [bound, setBound] = React.useState(false);
  const [login, setLogin] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/oauth/github/bind", { signal: timeoutSignal(8_000) });
      const data = (await res.json().catch(() => ({}))) as {
        enabled?: boolean;
        bound?: boolean;
        login?: string | null;
      };
      setEnabled(!!data.enabled);
      setBound(!!data.bound);
      setLogin(data.login ?? null);
    } catch {
      /* 查不到就当没配 */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function startBind() {
    setBusy(true);
    // 整页跳转，不走 fetch：GitHub 授权页必须顶层导航
    window.location.href = `/api/auth/oauth/github?mode=bind&redirect=${encodeURIComponent(redirect)}`;
  }

  async function unbind() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/oauth/github/bind", {
        method: "DELETE",
        signal: timeoutSignal(8_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("common.retryLater"));
        return;
      }
      toast.success(t("settings.githubUnbindOk"));
      await load();
    } catch {
      toast.error(t("common.retryLater"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  // 站长没配就不显示，避免放一个点了报错的按钮
  if (!enabled) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pr-3">
          <p className="text-sm font-medium">{t("settings.githubBind")}</p>
          <p className="text-xs text-muted-foreground">
            {bound ? t("settings.githubBindOnDesc") : t("settings.githubBindDesc")}
          </p>
          {bound && login ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">@{login}</p>
          ) : null}
        </div>
        <Github className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {bound ? (
        <>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void unbind()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("settings.githubUnbind")}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t("settings.githubUnbindHint")}</p>
        </>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={startBind}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("settings.githubBindAction")}
        </Button>
      )}
    </div>
  );
}

/**
 * 邮箱账号卡片。
 *
 * 邮箱不在白名单里的老账号会看到换绑提示 —— 到期还没换，聊天接口会拦他，
 * 但登录永远放行，所以这里只提示、不硬挡。
 */
export function EmailCard({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState<string>("");
  const [mustChange, setMustChange] = React.useState(false);
  const [pastDeadline, setPastDeadline] = React.useState(false);
  const [recommended, setRecommended] = React.useState<string>("hypermail.kdns.fr");
  const [open, setOpen] = React.useState(false);
  const [newEmail, setNewEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/profile", { signal: timeoutSignal(8_000) });
      const data = (await res.json().catch(() => ({}))) as {
        email?: {
          address?: string;
          mustChange?: boolean;
          pastDeadline?: boolean;
          recommendedDomain?: string;
        };
      };
      setEmail(data.email?.address ?? "");
      setMustChange(!!data.email?.mustChange);
      setPastDeadline(!!data.email?.pastDeadline);
      setRecommended(data.email?.recommendedDomain || "hypermail.kdns.fr");
    } catch {
      /* 查不到就保持默认 */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: "request" | "confirm") {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, newEmail: newEmail.trim(), code: code.trim() }),
        signal: timeoutSignal(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("common.retryLater"));
        return;
      }
      if (action === "request") {
        setSent(true);
        toast.success(t("settings.emailCode"));
      } else {
        toast.success(t("settings.emailChanged"));
        setOpen(false);
        setSent(false);
        setNewEmail("");
        setCode("");
        await load();
        onChanged();
      }
    } catch {
      toast.error(t("common.retryLater"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-3 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t("common.loading")}
      </div>
    );
  }

  if (!email) return null;

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pr-3">
          <p className="text-sm font-medium">{t("settings.email")}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{email}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mustChange ? t("settings.emailMustChange") : t("settings.emailAllowedHint")}
          </p>
          {mustChange ? (
            <p className="mt-1 text-[11px] text-destructive">
              {t("settings.emailDeadline").replace("{d}", "2026-10-15")}
            </p>
          ) : null}
        </div>
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {open ? (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            {t("settings.emailRecommend").replace("{d}", recommended)}
          </p>
          <Input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={`name@${recommended}`}
            className="h-8 text-xs"
            disabled={busy || sent}
          />
          {sent ? (
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("settings.emailCode")}
              className="h-8 text-xs"
              disabled={busy}
            />
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={sent ? "secondary" : "default"}
              disabled={busy || !newEmail.trim() || (sent && !code.trim())}
              onClick={() => void submit(sent ? "confirm" : "request")}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {sent ? t("settings.emailConfirm") : t("settings.emailSendCode")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setSent(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {t("settings.emailChangeAction")}
        </Button>
      )}

      {pastDeadline ? (
        <p className="text-[11px] text-destructive">{t("settings.emailMustChange")}</p>
      ) : null}
    </div>
  );
}

/** 昵称：不填就回落显示邮箱，所以老账号不受影响 */
export function NicknameCard({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState("");
  const [saved, setSaved] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auth/profile", { signal: timeoutSignal(8_000) });
      const data = (await res.json().catch(() => ({}))) as { user?: { nickname?: string } };
      const n = data.user?.nickname ?? "";
      setValue(n);
      setSaved(n);
    } catch {
      /* 查不到就留空 */
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: value }),
        signal: timeoutSignal(8_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; user?: { nickname?: string } };
      if (!res.ok) {
        toast.error(data.error ?? t("settings.saveFailed"));
        return;
      }
      setSaved(data.user?.nickname ?? "");
      setDirty(false);
      toast.success(t("settings.nicknameSaved"));
      onChanged();
    } catch {
      toast.error(t("settings.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div>
        <p className="text-sm font-medium">{t("settings.nickname")}</p>
        <p className="text-xs text-muted-foreground">{t("settings.nicknameDesc")}</p>
      </div>
      <Input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
        placeholder={t("settings.nicknamePlaceholder")}
        className="h-8 text-xs"
        disabled={busy}
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !dirty || value === (saved ?? "")}
        onClick={() => void save()}
      >
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        {t("settings.nicknameSave")}
      </Button>
    </div>
  );
}
