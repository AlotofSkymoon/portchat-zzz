"use client";

/**
 * 账号类设置卡片（昵称 / 邮箱换绑 / GitHub 绑定 / 两步验证）。
 *
 * 放在独立文件里，是为了让「聊天设置弹窗」和「/account 账户设置页」共用同一份实现 ——
 * 以前只在弹窗里有，账户页就只剩改密码，形同虚设。
 */

import * as React from "react";
import { Fingerprint, Github, Loader2, Mail, QrCode, ShieldCheck } from "lucide-react";
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

/* ------------------------------------------------------------------ *
 * Passkey 绑定
 * ------------------------------------------------------------------ */

type PasskeyItem = {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  synced?: boolean;
};

/** ArrayBuffer → base64url（客户端自己实现，lib/webauthn 依赖 redis 不能在客户端引） */
function toB64urlBuf(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64urlStr(text: string): Uint8Array {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Passkey 卡片：指纹 / 面容直接登录。
 *
 * ⚠️ 需求写的是「仅支持 iCloud 钥匙圈」，这里说清楚实际能做到什么程度：
 * WebAuthn 没有任何字段能读出「这把钥匙来自 iCloud」。
 * 唯一可读的是 BE（backup eligible）标志位 —— BE=1 表示这把密钥允许云端同步
 * （iCloud 钥匙圈 / Google 密码管理器 / 1Password 都是），BE=0 表示只在本机、丢了就没了。
 * 服务端用 BE 作为代理判据，BE=0 会被拒绝，并在 UI 上把「不同步」的钥匙标出来。
 */
/**
 * 把 Passkey 失败的真实原因说出来。
 *
 * 之前 catch 里一律弹「添加失败」，等于让人瞎猜：
 * 取消、超时、已注册过、域名不是 HTTPS、密钥不同步 —— 原因差别很大，
 * 处理办法完全不同。WebAuthn 的异常带 name 字段，直接映射成能看懂的话。
 */
function passkeyErrorText(err: unknown, t: (key: string) => string): string {
  const name = (err as { name?: string } | null | undefined)?.name ?? "";
  const known: Record<string, string> = {
    NotAllowedError: t("settings.passkeyErrNotAllowed"),
    InvalidStateError: t("settings.passkeyErrRegistered"),
    SecurityError: t("settings.passkeyErrDomain"),
    AbortError: t("settings.passkeyErrAbort"),
  };
  if (name && known[name]) return known[name];
  const msg = err instanceof Error ? err.message : "";
  if (msg) return `${t("settings.passkeyAddFailed")}（${msg}）`;
  return t("settings.passkeyAddFailed");
}

export function PasskeyCard() {
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [items, setItems] = React.useState<PasskeyItem[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/passkey", { signal: timeoutSignal(8_000) });
      const data = (await res.json().catch(() => ({}))) as { passkeys?: PasskeyItem[] };
      setItems(data.passkeys ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function register() {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      toast.error(t("settings.passkeyUnsupported"));
      return;
    }
    setBusy(true);
    try {
      const optRes = await fetch("/api/passkey/register/options", {
        method: "POST",
        signal: timeoutSignal(8_000),
      });
      const opt = (await optRes.json().catch(() => ({}))) as {
        error?: string;
        chalId?: string;
        rp?: { id: string; name: string };
        user?: { id: string; name: string; displayName: string };
        challenge?: string;
        excludeCredentials?: { id: string; type: string; transports?: string[] }[];
        authenticatorSelection?: Record<string, unknown>;
        pubKeyCredParams?: { type: string; alg: number }[];
        timeout?: number;
      };
      if (!optRes.ok || !opt.chalId || !opt.challenge || !opt.rp || !opt.user) {
        toast.error(opt.error ?? t("settings.passkeyAddFailed"));
        return;
      }

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: fromB64urlStr(opt.challenge),
          rp: opt.rp,
          // 服务端返回的 user.id 是账号 id 原文（不是 base64url），按 UTF-8 编码
          user: {
            id: new TextEncoder().encode(opt.user.id),
            name: opt.user.name,
            displayName: opt.user.displayName,
          },
          // 类型标注成字面量联合，否则 TS 会把它推成 string 而不匹配 WebAuthn 的签名
          pubKeyCredParams: (opt.pubKeyCredParams ?? [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ]) as PublicKeyCredentialParameters[],
          excludeCredentials: (opt.excludeCredentials ?? []).map((c) => ({
            id: fromB64urlStr(c.id),
            type: "public-key" as const,
            transports: (c.transports ?? []) as AuthenticatorTransport[],
          })),
          authenticatorSelection: opt.authenticatorSelection as AuthenticatorSelectionCriteria,
          attestation: "none",
          timeout: opt.timeout ?? 60_000,
        },
      })) as PublicKeyCredential | null;

      if (!cred) {
        toast.error(t("settings.passkeyAddFailed"));
        return;
      }
      const resp = cred.response as AuthenticatorAttestationResponse;

      const verRes = await fetch("/api/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeoutSignal(8_000),
        body: JSON.stringify({
          chalId: opt.chalId,
          credential: {
            id: cred.id,
            rawId: cred.id,
            response: {
              clientDataJSON: toB64urlBuf(resp.clientDataJSON),
              attestationObject: toB64urlBuf(resp.attestationObject),
              transports: resp.getTransports?.() ?? [],
            },
          },
        }),
      });
      const ver = (await verRes.json().catch(() => ({}))) as { error?: string };
      if (!verRes.ok) {
        toast.error(ver.error ?? t("settings.passkeyAddFailed"));
        return;
      }
      toast.success(t("settings.passkeyAdded"));
      await load();
    } catch (err) {
      toast.error(passkeyErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/passkey?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        signal: timeoutSignal(8_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("common.retryLater"));
        return;
      }
      toast.success(t("settings.passkeyRemoved"));
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

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pr-3">
          <p className="text-sm font-medium">{t("settings.passkey")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.passkeyDesc")}</p>
          {/* 绑定状态直接显示有几把 —— 绑没绑成功一眼能看到，不用去猜 */}
          <p className="mt-1 text-xs">
            {items.length > 0 ? (
              <span className="font-medium text-emerald-500">
                {t("settings.passkeyBoundCount", { n: items.length })}
              </span>
            ) : (
              <span className="text-muted-foreground">{t("settings.passkeyNone")}</span>
            )}
          </p>
        </div>
        <Fingerprint
          className={`mt-0.5 h-4 w-4 shrink-0 ${items.length > 0 ? "text-emerald-500" : "text-muted-foreground"}`}
        />
      </div>

      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {p.label}
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
                {p.synced === false ? (
                  <span className="ml-1 text-amber-500">{t("settings.passkeyNotSynced")}</span>
                ) : (
                  <span className="ml-1 text-emerald-500">{t("settings.passkeySynced")}</span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void remove(p.id)}
              >
                {t("settings.passkeyRemove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void register()}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        {t("settings.passkeyAdd")}
      </Button>
      <p className="text-[11px] text-muted-foreground">{t("settings.passkeyHint")}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 二维码登录
 * ------------------------------------------------------------------ */

/**
 * 二维码登录卡片：在这台已登录的设备上生成二维码，另一台设备扫一下就登录。
 *
 * ⚠️ 两个刻意的取舍：
 *   1. 二维码只在点击时才生成，且 5 分钟后自动失效 —— 常驻显示等于把登录凭证贴在屏幕上
 *   2. 兑换成功后服务端立刻销毁令牌，所以这里轮询到 claimed 就把二维码撤掉
 */
export function QrLoginCard() {
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);
  const [matrix, setMatrix] = React.useState<boolean[][] | null>(null);
  const [path, setPath] = React.useState("");
  const [viewBox, setViewBox] = React.useState(0);
  const [qrId, setQrId] = React.useState("");
  const [left, setLeft] = React.useState(0);

  const stop = React.useCallback(() => {
    setMatrix(null);
    setPath("");
    setQrId("");
    setLeft(0);
  }, []);

  // 轮询状态 + 倒计时
  React.useEffect(() => {
    if (!qrId) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      if (!alive) return;
      setLeft((s) => (s > 0 ? s - 1 : 0));
      try {
        const res = await fetch(`/api/auth/qr/status?id=${encodeURIComponent(qrId)}`, {
          signal: timeoutSignal(5_000),
        });
        const data = (await res.json().catch(() => ({}))) as { status?: string };
        if (data.status !== "pending") {
          // 已兑换 / 已过期 —— 令牌在服务端已销毁，这里把二维码一起撤掉
          if (alive) {
            stop();
            toast.success(t("settings.qrClaimed"));
          }
        }
      } catch {
        /* 网络抖动不撤码，等过期 */
      }
    }, 3_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [qrId, stop, t]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/qr/create", {
        method: "POST",
        signal: timeoutSignal(8_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string; payload?: string };
      if (!res.ok || !data.payload || !data.id) {
        toast.error(data.error ?? t("common.retryLater"));
        return;
      }
      const { qrMatrix, qrSvgPath, qrViewBox } = await import("@/lib/qr");
      const m = qrMatrix(data.payload);
      setMatrix(m);
      setPath(qrSvgPath(m));
      setViewBox(qrViewBox(m));
      setQrId(data.id);
      setLeft(300);
    } catch {
      toast.error(t("common.retryLater"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pr-3">
          <p className="text-sm font-medium">{t("settings.qrLogin")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.qrLoginDesc")}</p>
        </div>
        <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {matrix && path ? (
        <div className="space-y-2">
          <div className="mx-auto w-40 rounded-lg bg-white p-2">
            <svg viewBox={`0 0 ${viewBox} ${viewBox}`} className="h-full w-full" role="img" aria-label="QR">
              <path d={path} fill="#000" />
            </svg>
          </div>
          <p className="text-center text-[11px] text-muted-foreground">
            {t("settings.qrExpiresIn")} {Math.ceil(left / 60)} {t("settings.qrMinutes")}
          </p>
          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={stop}>
            {t("settings.qrCancel")}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void create()}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("settings.qrGenerate")}
        </Button>
      )}
    </div>
  );
}
