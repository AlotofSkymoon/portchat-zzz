"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Shield,
  Trash2,
  TriangleAlert,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SiteFooter } from "@/components/site-footer";
import { parseIcpInput } from "@/lib/use-site-icp";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { SiteFooterBadge } from "@/components/site-footer-badge";

interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
}

export function AdminClient({ me }: { me: AdminUser }) {
  const { t } = useI18n();
  const router = useRouter();
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [presetKey, setPresetKey] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("admin.loadFailed"));
        return;
      }
      setUsers(data.users ?? []);
    } catch {
      toast.error(t("account.networkError"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadKey = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/preset-key", { cache: "no-store" });
      const data = (await res.json()) as { apiKey?: string; error?: string };
      if (res.ok) setPresetKey(data.apiKey ?? "");
    } catch {
      /* 忽略 */
    }
  }, []);

  React.useEffect(() => {
    void load();
    void loadKey();
  }, [load, loadKey]);

  async function toggleRole(user: AdminUser) {
    if (user.id === me.id) {
      toast.error(t("admin.cantDemoteSelf"));
      return;
    }
    setBusyId(user.id);
    try {
      const nextRole = user.role === "admin" ? "user" : "admin";
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, role: nextRole }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("admin.changeFailed"));
        return;
      }
      toast.success(`${t("admin.roleChanged")} ${user.email} ${t("admin.roleTo")} ${nextRole === "admin" ? t("account.adminRole") : t("account.userRole")}`);
      await load();
    } catch {
      toast.error(t("common.networkError"));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(user: AdminUser) {
    if (user.id === me.id) {
      toast.error(t("admin.cantDeleteSelf"));
      return;
    }
    if (!confirm(`${t("admin.confirmDelete")} ${user.email}${t("admin.deleteWarn")}`)) return;
    setBusyId(user.id);
    try {
      const res = await fetch(`/api/admin/users?userId=${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("admin.deleteFailed"));
        return;
      }
      toast.success(t("admin.userDeleted"));
      await load();
    } catch {
      toast.error(t("common.networkError"));
    } finally {
      setBusyId(null);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(presetKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("chat.copyFailed"));
    }
  }

  return (
    <main className="relative min-h-screen-safe px-4 py-10">
      <div className="pointer-events-none absolute inset-0 aurora" />
      <div className="relative mx-auto w-full max-w-4xl space-y-6">
        <Link
          href="/chat"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("admin.backToChat")}
        </Link>

        <div className="flex items-center gap-2 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm text-primary">
          <Crown className="h-4 w-4 shrink-0" />
          {t("admin.firstAdmin")}
        </div>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                {t("admin.presetKey")}
              </CardTitle>
              <CardDescription>
                {t("admin.presetKeyNote")}
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={() => void loadKey()} title={t("admin.refresh")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {presetKey ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 truncate rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-xs">
                  {showKey ? presetKey : `${presetKey.slice(0, 6)}••••••••${presetKey.slice(-4)}`}
                </code>
                <Button variant="outline" size="sm" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showKey ? t("admin.hide") : t("admin.show")}
                </Button>
                <Button variant="outline" size="sm" onClick={copyKey}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? t("chat.copied") : t("chat.copy")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("admin.notSet")}
              </p>
            )}
          </CardContent>
        </Card>

        <SiteSettingsCard />

        <MailCard />

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>{t("admin.usersTitle")}</CardTitle>
              <CardDescription>{t("admin.usersCount")} {users.length} {t("admin.usersUnit")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("admin.refresh")}
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{u.email}</span>
                        {u.role === "admin" ? (
                          <Badge>
                            <Shield className="mr-1 h-3 w-3" />
                            admin
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <UserIcon className="mr-1 h-3 w-3" />
                            user
                          </Badge>
                        )}
                        {u.id === me.id ? <Badge variant="outline">{t("admin.me")}</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        id: {u.id} · {new Date(u.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleRole(u)}
                        disabled={busyId === u.id}
                      >
                        {u.role === "admin" ? t("admin.toUser") : t("admin.toAdmin")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => remove(u)}
                        disabled={busyId === u.id}
                      >
                        <Trash2 className="h-4 w-4" />
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                ))}
                {users.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("admin.noUsers")}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </main>
  );
}


/* ========================================================================== */
/* 站点配置：原本散落在用户设置里的高级项，统一收归管理员                      */
/* ========================================================================== */

interface SiteSettings {
  defaultBaseUrl: string;
  defaultModel: string;
  cloudSaveDefault: boolean;
  /* 页脚 / 备案 */
  icpText: string;
  icpUrl: string;
  icpIconUrl: string;
  footerExtra: string;
  contactType: "" | "telegram" | "qq";
  contactValue: string;
}

function SiteSettingsCard() {
  const { t } = useI18n();
  const [form, setForm] = React.useState<SiteSettings>({
    defaultBaseUrl: "",
    defaultModel: "",
    cloudSaveDefault: false,
    icpText: "",
    icpUrl: "",
    icpIconUrl: "",
    footerExtra: "",
    contactType: "",
    contactValue: "",
  });
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  /**
   * 读取结果的提示。
   * fatal=true  → 拿不到配置，展示错误态 + 重试
   * fatal=false → 只是警告（如后端没配存储），表单仍可填
   */
  const [loadError, setLoadError] = React.useState<{ msg: string; fatal: boolean } | null>(
    null,
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      /**
       * 必须带超时。之前没有，服务端一旦挂起（Upstash 慢、KV 卡住），
       * 这张卡片就会永远停在「读取中…」，而其他卡片都正常 ——
       * 看起来像整个页面坏了，实际只是这一个请求没回来。
       */
      const res = await fetch("/api/admin/settings", {
        signal: timeoutSignal(10_000),
      });

      // 403 / 500 也带 JSON，尽量读出服务端给的中文原因
      const data = (await res.json().catch(() => ({}))) as {
        settings?: SiteSettings;
        error?: string;
        storage?: boolean;
      };

      if (!res.ok) {
        setLoadError({
          msg: data.error ?? t("admin.readFailedHttp", { code: res.status }),
          fatal: true,
        });
        return;
      }

      if (data.settings) {
        /**
         * 旧数据里没有页脚字段（服务端可能是旧版本或空配置），
         * 逐个兜底成空串 —— 否则受控输入拿到 undefined 会报警告，
         * 而且用户在框里一打字就崩。
         */
        setForm({
          ...data.settings,
          icpText: data.settings.icpText ?? "",
          icpUrl: data.settings.icpUrl ?? "",
          icpIconUrl: data.settings.icpIconUrl ?? "",
          footerExtra: data.settings.footerExtra ?? "",
          contactType: (data.settings.contactType ?? "") as "" | "telegram" | "qq",
          contactValue: data.settings.contactValue ?? "",
        });
      }
      // storage:false 表示后端没配存储，配置能读但保存会失败，提前告知
      if (data.storage === false) {
        setLoadError({
          msg: t("admin.noStorage"),
          fatal: false,
        });
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setLoadError({
        msg:
          name === "TimeoutError" || name === "AbortError"
            ? t("admin.readTimeout")
            : t("admin.readFailed"),
        fatal: true,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        signal: timeoutSignal(15_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        /** 服务端回读校验：保存的值和读回来的值是否一致 */
        verified?: boolean;
        settings?: SiteSettings;
      };
      if (!res.ok) {
        // 服务端会给出中文原因（如"需要管理员权限""未配置存储"），优先展示
        toast.error(data.error ?? `${t("admin.saveFailed")}（HTTP ${res.status}）`);
        return;
      }
      /**
       * 保存后校验回读值。
       *
       * 之前这里只弹一句"已保存"，实际有没有写进去完全靠猜 ——
       * 于是出现了"保存成功但刷新还是关闭"这种无解现象。
       * 现在服务端会回读并给出 verified，存没存进去当场能看出来。
       */
      if (data.verified === false) {
        toast.error(t("admin.saveMismatch"));
      } else {
        toast.success(t("admin.saved"));
      }
      await load();
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      toast.error(
        name === "TimeoutError" || name === "AbortError" ? t("admin.saveTimeout") : t("admin.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {t("admin.siteSettingsTitle")}
          </CardTitle>
          <CardDescription>
            {t("admin.siteSettingsDesc")}
          </CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void load()} title={t("admin.refresh")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          /* 骨架屏：保留大致布局，避免内容到达时高度突变 */
          <div className="space-y-4" aria-busy>
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
            </div>
            <div className="space-y-2">
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-9 w-full animate-pulse rounded-md bg-muted" />
            </div>
            <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : loadError?.fatal ? (
          /* 出错时给出原因和重试入口，而不是让用户对着空白猜 */
          <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {loadError.msg}
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("admin.retry")}
            </Button>
          </div>
        ) : (
          <>
            {/* 非致命警告：表单照常可用，只是提前告知保存会失败 */}
            {loadError ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {loadError.msg}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="ss-base" className="flex items-center gap-2">
                <Server className="h-4 w-4" />
                {t("admin.defaultBaseUrl")}
              </Label>
              <Input
                id="ss-base"
                placeholder={t("admin.baseUrlPlaceholder")}
                value={form.defaultBaseUrl}
                onChange={(e) => setForm((f) => ({ ...f, defaultBaseUrl: e.target.value }))}
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("admin.baseUrlHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ss-model">{t("admin.defaultModel")}</Label>
              <Input
                id="ss-model"
                placeholder={t("admin.modelPlaceholder")}
                value={form.defaultModel}
                onChange={(e) => setForm((f) => ({ ...f, defaultModel: e.target.value }))}
                autoComplete="off"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3 py-3">
              <div className="pr-3">
                <p className="text-sm font-medium">{t("admin.cloudSaveDefault")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("admin.cloudSaveDefaultHint")}
                </p>
              </div>
              <Switch
                checked={form.cloudSaveDefault}
                onCheckedChange={(v) => setForm((f) => ({ ...f, cloudSaveDefault: v }))}
              />
            </div>

            {/* ---- 页脚 / 备案：在面板里填，不用改环境变量 ---- */}
            <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                {t("admin.footer")}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="ss-icp-text">{t("admin.icpText")}</Label>
                <Input
                  id="ss-icp-text"
                  placeholder={t("admin.icpTextPlaceholder")}
                  value={form.icpText}
                  onChange={(e) => {
                    const v = e.target.value;
                    /**
                     * 支持直接粘贴第三方备案给的整段 <a> 标签：
                     * 自动拆出链接和文字，不用手动分两个框填。
                     */
                    const parsed = parseIcpInput(v);
                    if (parsed) {
                      setForm((f) => ({
                        ...f,
                        icpText: parsed.icpText || f.icpText,
                        icpUrl: parsed.icpUrl || f.icpUrl,
                      }));
                      toast.success(t("admin.icpParsed"));
                      return;
                    }
                    setForm((f) => ({ ...f, icpText: v }));
                  }}
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("admin.icpPasteHint")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ss-icp-url">{t("admin.icpUrl")}</Label>
                <Input
                  id="ss-icp-url"
                  placeholder={t("admin.icpUrlPlaceholder")}
                  value={form.icpUrl}
                  onChange={(e) => {
                    const v = e.target.value;
                    const parsed = parseIcpInput(v);
                    if (parsed) {
                      setForm((f) => ({
                        ...f,
                        icpUrl: parsed.icpUrl || f.icpUrl,
                        icpText: parsed.icpText || f.icpText,
                      }));
                      return;
                    }
                    setForm((f) => ({ ...f, icpUrl: v }));
                  }}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ss-icp-icon">{t("admin.icpIcon")}</Label>
                <Input
                  id="ss-icp-icon"
                  placeholder={t("admin.icpIconPlaceholder")}
                  value={form.icpIconUrl}
                  onChange={(e) => setForm((f) => ({ ...f, icpIconUrl: e.target.value }))}
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("admin.icpIconHint")}
                </p>
              </div>

              {/* 实时预览：填完立刻能看出效果，不用去前台刷新 */}
              {form.icpUrl || form.icpText ? (
                <div className="space-y-1.5">
                  <Label>{t("admin.badgePreview")}</Label>
                  <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] text-fg-tertiary">
                    <SiteFooterBadge
                      src={form.icpIconUrl || undefined}
                      alt={form.icpText || t("admin.badgeAlt")}
                      href={form.icpUrl || undefined}
                    />
                    <span>{form.icpText || t("admin.icpNotSet")}</span>
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="ss-contact-type">{t("admin.contact")}</Label>
                <div className="flex gap-2">
                  <select
                    id="ss-contact-type"
                    className="flex h-10 w-40 shrink-0 rounded-xl border border-input bg-background/60 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={form.contactType}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        contactType: e.target.value as "" | "telegram" | "qq",
                      }))
                    }
                  >
                    <option value="">{t("admin.contactNone")}</option>
                    <option value="telegram">{t("admin.contactTelegram")}</option>
                    <option value="qq">{t("admin.contactQq")}</option>
                  </select>
                  <Input
                    id="ss-contact-value"
                    className="flex-1"
                    placeholder={
                      form.contactType === "qq"
                        ? t("admin.contactValueQqPlaceholder")
                        : form.contactType === "telegram"
                          ? t("admin.contactValueTelegramPlaceholder")
                          : t("admin.contactValuePlaceholder")
                    }
                    value={form.contactValue}
                    onChange={(e) => setForm((f) => ({ ...f, contactValue: e.target.value }))}
                    disabled={!form.contactType}
                    autoComplete="off"
                  />
                </div>
                {form.contactType ? (
                  <p className="text-xs text-muted-foreground">{t("admin.contactHint")}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ss-footer-extra">{t("admin.footerExtra")}</Label>
                <Input
                  id="ss-footer-extra"
                  placeholder={t("admin.footerExtraPlaceholder")}
                  value={form.footerExtra}
                  onChange={(e) => setForm((f) => ({ ...f, footerExtra: e.target.value }))}
                  autoComplete="off"
                />
              </div>
            </div>

            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t("admin.saveConfig")}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface MailStatus {
  enabled: boolean;
  from?: string;
  missing?: string[];
  keyPreview?: string;
}

/**
 * 邮箱验证状态卡片。
 *
 * 存在的理由：Resend 配没配上，以前完全没有可观测性 ——
 * 用户以为开了邮箱验证，其实 isEmailConfigured() 一直是 false，
 * 注册静默跳过验证，谁也不知道。这里把「读到了什么」直接摊开。
 */
function MailCard() {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<MailStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [to, setTo] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; msg: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/mail-test", { signal: timeoutSignal(10_000) });
      const data = (await res.json().catch(() => ({}))) as MailStatus & { error?: string };
      if (!res.ok) {
        setStatus(null);
        setResult({ ok: false, msg: data.error ?? t("admin.readFailedHttp", { code: res.status }) });
        return;
      }
      setStatus({ enabled: !!data.enabled, from: data.from, missing: data.missing, keyPreview: data.keyPreview });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setStatus(null);
      setResult({
        ok: false,
        msg: name === "TimeoutError" || name === "AbortError" ? t("admin.readTimeout") : t("admin.readFailed"),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/mail-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
        signal: timeoutSignal(20_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        hint?: string;
      };
      if (res.ok && data.ok) {
        setResult({ ok: true, msg: t("admin.mailTestOk") });
      } else {
        setResult({
          ok: false,
          msg: [data.hint, data.error, data.detail].filter(Boolean).join(" ｜ ") || t("admin.mailTestFailed"),
        });
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setResult({
        ok: false,
        msg: name === "TimeoutError" || name === "AbortError" ? t("admin.readTimeout") : t("admin.readFailed"),
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            {t("admin.mailTitle")}
          </CardTitle>
          <CardDescription>{t("admin.mailDesc")}</CardDescription>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void load()} title={t("admin.refresh")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="h-16 w-full animate-pulse rounded-md bg-muted" aria-busy />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={status?.enabled ? "secondary" : "outline"}>
                {status?.enabled ? t("admin.mailEnabled") : t("admin.mailDisabled")}
              </Badge>
              {status?.from ? (
                <span className="text-muted-foreground">
                  {t("admin.mailFrom")}: {status.from}
                </span>
              ) : null}
              {status?.keyPreview ? (
                <span className="text-muted-foreground">key: {status.keyPreview}</span>
              ) : null}
            </div>

            {status && !status.enabled && status.missing?.length ? (
              <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
                <p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("admin.mailMissing")}: <code>{status.missing.join(", ")}</code>
                </p>
                <p className="text-[11px] text-muted-foreground">{t("admin.mailMissingHint")}</p>
              </div>
            ) : null}

            {status?.enabled ? (
              <p className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                {t("admin.mailDomainHint")}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label>{t("admin.mailTestTitle")}</Label>
              <p className="text-[11px] text-muted-foreground">{t("admin.mailTestDesc")}</p>
              <div className="flex gap-2">
                <Input
                  placeholder="you@example.com"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  autoComplete="off"
                  inputMode="email"
                />
                <Button
                  variant="secondary"
                  onClick={() => void send()}
                  disabled={sending || !to.trim()}
                  className="shrink-0"
                >
                  {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {t("admin.mailTestSend")}
                </Button>
              </div>
            </div>

            {result ? (
              <p
                className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm ${
                  result.ok
                    ? "border border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                    : "border border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {result.msg}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
