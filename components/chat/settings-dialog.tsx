"use client";

import * as React from "react";
import {
  CloudUpload,
  Loader2,
  ShieldCheck,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Palette,
  RefreshCw,
  Server,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { useI18n } from "@/components/i18n-provider";
import { LocalePicker } from "@/components/locale-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  supportsThinking,
  AGENT_TIP,
  CUSTOM_PROVIDER_PREFIX,
  DEFAULT_MODEL,
  PROVIDERS,
  isBlockedBaseUrl,
  type CustomProviderConfig,
  type ProviderId,
} from "@/lib/config";
import { Loader2, Plus, Pencil, Search, Check as CheckIcon, X as XIcon } from "lucide-react";
import {
  ALLOW_CUSTOM_BASE_URL,
  ALLOW_CUSTOM_KEY,
  THEME_PRESETS,
  type ThemePreset,
} from "@/lib/site";
import { useTheme } from "@/components/theme-provider";
import {
  DEFAULT_S3_CONFIG,
  presetsForPlatform,
  type S3Config,
} from "@/lib/s3-presets";

export interface ChatSettings {
  /** 各服务商的 Key：{ agnes, "custom:xxx" } */
  keys: Record<string, string>;
  /**
   * 各服务商「独立」的 Base URL 覆盖值。
   * ⚠️ 必须按服务商分开存 —— 共用一个字符串会导致改 DeepSeek 地址把 Agnes 也带跑。
   */
  baseUrls: Record<string, string>;
  /** 用户自建的 OpenAI 兼容供应商 */
  customProviders: CustomProviderConfig[];
  model: string;
  /** 对象存储配置（图片 / 视频上传） */
  s3?: S3Config;
  /** 思考模式：让模型先输出推理过程 */
  thinking?: boolean;
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ChatSettings;
  onSave: (settings: ChatSettings) => void;
  user: { id: string; email: string; role: string } | null;
  cloudSync: boolean;
  onCloudSyncChange: (value: boolean) => void;
  onClearAll: () => void;
}

// DeepSeek 入口已移除：站点不提供 DeepSeek Key，界面不再列出
const PROVIDER_ORDER: ProviderId[] = ["agnes", "inkstone"];

/**
 * 自定义供应商编辑器。
 *
 * ⚠️ 必须定义在 SettingsDialog 组件【外部】。
 * 之前它嵌在父组件里，父组件每次重渲染都会生成新的函数引用，
 * React 会把它整个 unmount 再 mount —— 用户填到一半的内容（名称、
 * URL、Key、勾选的模型）随时可能被清空，表现为「怎么都保存不进去」。
 */
/**
 * 已添加供应商的「模型管理」区。
 *
 * 为什么需要它：中转站会不断上架新模型，而原来加完供应商之后
 * 模型列表就写死了 —— 想用新模型只能删掉整条重加，Key 和地址
 * 都要重新填一遍。这里做增量：重新探测 /models，把上游新增的、
 * 本地还没有的模型标成「新增」，用户勾选即可追加；也可以直接
 * 手动补一个 id（有些中转站关了 /models 端点，只能手填）。
 */
function ProviderModelManager({
  provider,
  apiKey,
  onChange,
}: {
  provider: CustomProviderConfig;
  apiKey: string;
  onChange: (models: string[]) => void;
}) {
  const { t } = useI18n();
  const [probing, setProbing] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [candidates, setCandidates] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [manual, setManual] = React.useState("");

  const owned = new Set(provider.models);

  async function probe() {
    setProbing(true);
    setMsg("");
    setCandidates([]);
    setPicked(new Set());
    try {
      const res = await fetch("/api/probe-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: provider.baseUrl, apiKey }),
      });
      const data = (await res.json()) as { ok?: boolean; models?: string[]; error?: string };

      if (!data.ok || !data.models?.length) {
        setMsg(data.error ?? t("settings.probeNone"));
        return;
      }

      // 只展示本地还没有的 —— 已有的不需要再勾一遍
      const fresh = data.models.filter((m) => !owned.has(m));
      if (fresh.length === 0) {
        setMsg(t("settings.noNewModels"));
        return;
      }
      setCandidates(fresh);
      setPicked(new Set(fresh));
      setMsg(t("settings.newModelsFound", { count: fresh.length }));
    } catch {
      setMsg(t("settings.probeFailed"));
    } finally {
      setProbing(false);
    }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function appendPicked() {
    const add = Array.from(picked).filter((m) => !owned.has(m));
    if (add.length === 0) return;
    onChange([...provider.models, ...add]);
    setCandidates([]);
    setPicked(new Set());
    setMsg(t("settings.modelsAppended", { count: add.length }));
  }

  function addManual() {
    const id = manual.trim();
    if (!id) return;
    if (owned.has(id)) {
      setMsg(t("settings.modelAlreadyThere"));
      return;
    }
    onChange([...provider.models, id]);
    setManual("");
    setMsg(t("settings.modelsAppended", { count: 1 }));
  }

  function removeModel(id: string) {
    // 至少留一个：删空了供应商会变成废条目，下拉框里也选不出模型
    if (provider.models.length <= 1) {
      setMsg(t("settings.keepOneModel"));
      return;
    }
    onChange(provider.models.filter((m) => m !== id));
  }

  return (
    <div className="space-y-2 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-fg-tertiary">
          {t("settings.manageModels")} · {provider.models.length}
        </span>
        <button
          type="button"
          onClick={probe}
          disabled={probing}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", probing && "animate-spin")} />
          {probing ? t("settings.probing") : t("settings.probeNew")}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {provider.models.map((m) => (
          <span
            key={m}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-fg-secondary"
          >
            <span className="max-w-[190px] truncate">{m}</span>
            <button
              type="button"
              onClick={() => removeModel(m)}
              className="text-fg-quaternary hover:text-destructive"
              aria-label={t("common.delete")}
            >
              <XIcon className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>

      {candidates.length > 0 ? (
        <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <p className="text-[10px] font-medium text-primary">{msg}</p>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {candidates.map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
                <input
                  type="checkbox"
                  checked={picked.has(m)}
                  onChange={() => toggle(m)}
                  className="h-3 w-3 accent-[hsl(var(--primary))]"
                />
                <span className="truncate">{m}</span>
              </label>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            className="h-6 w-full text-[11px]"
            onClick={appendPicked}
            disabled={picked.size === 0}
          >
            <Plus className="mr-1 h-3 w-3" />
            {t("settings.appendSelected")}
          </Button>
        </div>
      ) : msg ? (
        <p className="text-[10px] text-muted-foreground">{msg}</p>
      ) : null}

      <div className="flex gap-1.5">
        <Input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addManual();
            }
          }}
          placeholder={t("settings.modelIdPlaceholder")}
          className="h-7 text-[11px]"
          autoComplete="off"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={addManual}
          disabled={!manual.trim()}
        >
          {t("settings.addModel")}
        </Button>
      </div>
    </div>
  );
}

function CustomProviderEditor({
  existingIds,
  onAdd,
}: {
  existingIds: string[];
  onAdd: (provider: CustomProviderConfig, key: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [key, setKey] = React.useState("");
  const [modelsRaw, setModelsRaw] = React.useState("");
  const [vision, setVision] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [probing, setProbing] = React.useState(false);
  const [probeMsg, setProbeMsg] = React.useState("");
  /** 探测到的候选模型，供用户勾选 */
  const [found, setFound] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  function reset() {
    setEditing(false);
    setLabel("");
    setUrl("");
    setKey("");
    setModelsRaw("");
    setVision(false);
    setThinking(false);
    setErr("");
    setProbeMsg("");
    setFound([]);
    setSelected(new Set());
  }

  /** 自动发现：问上游 /models 上有哪些模型 */
  async function probe() {
    const base = url.trim().replace(/\/+$/, "");
    if (!base) return setErr(t("settings.fillBaseUrl"));

    setProbing(true);
    setProbeMsg("");
    setErr("");
    try {
      const res = await fetch("/api/probe-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: base, apiKey: key.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        models?: string[];
        total?: number;
        error?: string;
      };

      if (data.ok && data.models?.length) {
        setFound(data.models);
        // 默认全选：一般中转站也就十几个模型，全勾上最省事
        setSelected(new Set(data.models));
        setProbeMsg(`${t("settings.probeFound")} ${data.total ?? data.models.length} ${t("settings.modelsUnit")}`);
      } else {
        setFound([]);
        setProbeMsg(data.error ?? t("settings.probeNone"));
      }
    } catch {
      setProbeMsg(t("settings.probeFailed"));
    } finally {
      setProbing(false);
    }
  }

  /** 最终采用的模型列表：勾选优先，其次手填 */
  function resolveModels(): string[] {
    if (selected.size > 0) return Array.from(selected);
    return modelsRaw
      .split(/[\n,]/)
      .map((m) => m.trim())
      .filter(Boolean);
  }

  function toggleModel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function add() {
    const name = label.trim();
    const base = url.trim().replace(/\/+$/, "");
    const models = resolveModels();

    if (!name) return setErr(t("settings.fillName"));
    if (!base) return setErr(t("settings.fillBaseUrl"));
    if (!/^https?:\/\//i.test(base)) return setErr(t("settings.baseUrlProtocol"));
    if (isBlockedBaseUrl(base)) return setErr(t("settings.baseUrlLocal"));
    if (models.length === 0) return setErr(t("settings.needOneModel"));

    const id = `${CUSTOM_PROVIDER_PREFIX}${name.toLowerCase().replace(/[^a-z0-9_-]/g, "") || Date.now()}`;
    if (existingIds.includes(id)) return setErr(t("settings.duplicateProvider"));

    onAdd(
      { id, label: name, baseUrl: base, models, vision, thinking },
      key.trim(),
    );
    reset();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs text-fg-secondary hover:border-primary/50 hover:text-primary"
      >
        <Plus className="h-4 w-4" />
        {t("settings.addProvider")}
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-border/70 bg-card/40 p-3">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Pencil className="h-4 w-4" />
        {t("settings.provider")}
      </Label>

      <div className="space-y-1">
        <Label className="text-[11px] text-fg-tertiary">{t("settings.providerName")}</Label>
        <Input
          placeholder={t("settings.namePlaceholder")}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-fg-tertiary">Base URL</Label>
        <Input
          placeholder={t("settings.baseUrlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-fg-tertiary">
          {t("settings.apiKeyOptional")}
        </Label>
        <Input
          type="password"
          placeholder={t("settings.keyPlaceholder")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
        />
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-full text-xs"
        disabled={probing}
        onClick={() => void probe()}
      >
        {probing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
        {probing ? t("settings.probing") : t("settings.probe")}
      </Button>

      {probeMsg ? (
        <p
          className={`text-[11px] ${
            found.length > 0 ? "text-primary" : "text-amber-600 dark:text-amber-500"
          }`}
        >
          {probeMsg}
        </p>
      ) : null}

      {/* 探测结果：可勾选 */}
      {found.length > 0 ? (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-2">
          {found.map((m) => (
            <label
              key={m}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-muted/60"
            >
              <input
                type="checkbox"
                checked={selected.has(m)}
                onChange={() => toggleModel(m)}
                className="h-3 w-3 rounded border-border"
              />
              <span className="truncate font-mono">{m}</span>
            </label>
          ))}
        </div>
      ) : null}

      <div className="space-y-1">
        <Label className="text-[11px] text-fg-tertiary">
          {t("settings.modelIds")}
        </Label>
        <Input
          placeholder={t("settings.modelIdPlaceholder")}
          value={modelsRaw}
          onChange={(e) => setModelsRaw(e.target.value)}
          autoComplete="off"
        />
        <p className="text-[11px] text-muted-foreground">
          {t("settings.modelIdHint")}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={vision}
            onChange={(e) => setVision(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          {t("settings.supportsVision")}
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={thinking}
            onChange={(e) => setThinking(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          {t("settings.supportsThinking")}
        </label>
      </div>

      {err ? <p className="text-[11px] text-destructive">{err}</p> : null}

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={add}>
          <CheckIcon className="h-4 w-4" />
          {t("settings.add")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * 两步验证卡片。
 *
 * 流程刻意做成两步：先出密钥 → 用户用验证器输一次码 → 才真正启用。
 * 直接生成即启用的话，扫码失败的人会被自己的 2FA 锁在门外。
 */
function TwoFactorCard() {
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

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSave,
  user,
  cloudSync,
  onCloudSyncChange,
  onClearAll,
}: SettingsDialogProps) {
  const { t } = useI18n();
  const [form, setForm] = React.useState<ChatSettings>(settings);
  const [showKey, setShowKey] = React.useState<Record<string, boolean>>({});
  const [showSecret, setShowSecret] = React.useState(false);
  const [discovering, setDiscovering] = React.useState(false);
  const [discoverMsg, setDiscoverMsg] = React.useState("");
  const [siteInfo, setSiteInfo] = React.useState<{
    siteManaged: boolean;
    endpoint: string;
    bucket: string;
    publicBaseUrl: string;
    platform?: "cloudflare" | "vercel" | "local";
    /** 服务端是否通过 Worker binding 直连 R2（有则完全免配置） */
    r2Bound?: boolean;
  } | null>(null);

  // 只展示当前部署平台支持的对象存储
  const availablePresets = React.useMemo(
    () => presetsForPlatform(siteInfo?.platform ?? "local"),
    [siteInfo?.platform],
  );

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch("/api/upload/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d === "object") setSiteInfo(d);
      })
      .catch(() => {
        /* 忽略 */
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const { preset, setPreset } = useTheme();

  /**
   * 权限分流：普通用户只能改「配色主题」和「自己的 API Key」。
   * Base URL、对象存储、云端保存等属于站点级配置，只有管理员可见，
   * 并已在 /admin 面板提供。
   */
  const isAdmin = user?.role === "admin";

  /** 留空也能找：自动在账户里匹配 agnes-chat / agnes-chat-r2 */
  async function discoverBucket() {
    const name = (form.s3?.bucket ?? "").trim();
    setDiscovering(true);
    setDiscoverMsg("");
    try {
      const res = await fetch("/api/upload/discover-r2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: name }),
      });
      const data = (await res.json()) as {
        found?: boolean;
        bucket?: string;
        endpoint?: string;
        publicBaseUrl?: string;
        available?: string[];
        error?: string;
        message?: string;
        mode?: "binding" | "api" | "none";
        noCredentialsNeeded?: boolean;
      };

      /**
       * binding 模式：桶已经通过 wrangler.jsonc 绑定好了，
       * **不需要 endpoint / AK / SK** —— 上传走 /api/upload/direct。
       * 这时 endpoint 为空是正常的，不能用它来判断成功与否。
       */
      if (data.found && data.mode === "binding") {
        patchS3({
          enabled: true,
          endpoint: "",
          region: "auto",
          bucket: data.bucket ?? "agnes-chat",
          publicBaseUrl: data.publicBaseUrl ?? "",
        });
        setDiscoverMsg(data.message ?? t("settings.r2Direct"));
        return;
      }

      if (data.found && data.endpoint && data.bucket) {
        patchS3({
          enabled: true,
          endpoint: data.endpoint,
          region: "auto",
          bucket: data.bucket,
          publicBaseUrl: data.publicBaseUrl ?? "",
        });
        setDiscoverMsg(`${t("settings.bucketFound")}「${data.bucket}」，${t("settings.endpointFilled")}`);
      } else {
        setDiscoverMsg(
          data.available?.length
            ? `${data.error ?? t("settings.notFound")}（${t("settings.optional_")}${data.available.join("、")}）`
            : data.error ?? t("settings.bucketNotFound"),
        );
      }
    } catch {
      setDiscoverMsg(t("settings.lookupFailed"));
    } finally {
      setDiscovering(false);
    }
  }

  const s3 = form.s3 ?? DEFAULT_S3_CONFIG;
  const patchS3 = (patch: Partial<S3Config>) =>
    setForm((f) => ({ ...f, s3: { ...(f.s3 ?? DEFAULT_S3_CONFIG), ...patch } }));

  React.useEffect(() => {
    if (open) setForm(settings);
  }, [open, settings]);

  /** 内置 + 自定义，统一成一个列表渲染 */
  const allProviders = React.useMemo(() => {
    const builtin = PROVIDER_ORDER.map((pid) => {
      const p = PROVIDERS[pid];
      return { id: pid as string, label: p.label, baseUrl: p.baseUrl, hasPreset: p.hasPreset, keyUrl: p.keyUrl };
    });
    const custom = form.customProviders.map((c) => ({
      id: c.id,
      label: c.label,
      baseUrl: (form.baseUrls[c.id] ?? "").trim() || c.baseUrl,
      hasPreset: false,
      keyUrl: "",
      isCustom: true,
    }));
    return [...builtin, ...custom];
  }, [form.customProviders, form.baseUrls]);

  /** 只改某个自定义供应商的模型列表，Key / Base URL 原样保留 */
  function updateProviderModels(id: string, models: string[]) {
    setForm((f) => ({
      ...f,
      customProviders: f.customProviders.map((c) => (c.id === id ? { ...c, models } : c)),
    }));
  }

  function removeCustomProvider(id: string) {
    setForm((f) => ({
      ...f,
      customProviders: f.customProviders.filter((c) => c.id !== id),
      // 同时清掉它的 Key 和 Base URL，避免残留脏数据
      keys: Object.fromEntries(Object.entries(f.keys).filter(([k]) => k !== id)),
      baseUrls: Object.fromEntries(Object.entries(f.baseUrls).filter(([k]) => k !== id)),
      // 若当前正选中该供应商的模型，回落到默认模型
      model: f.customProviders.find((c) => c.id === id)?.models.includes(f.model)
        ? DEFAULT_MODEL
        : f.model,
    }));
  }

  /**
   * 添加供应商后立即持久化。
   *
   * 之前「添加」只更新内存里的 form，用户以为已经保存了，
   * 关掉设置面板再打开就没了 —— 必须再点一次「保存」才写盘，
   * 这个落差太大。添加本身是个明确的完成动作，直接落盘更符合预期。
   *
   * 注意：这里直接用当前渲染的 form 构造 next，而不是在 setForm 的
   * 更新函数里做副作用 —— 更新函数可能会被 React 调用多次（严格模式），
   * 在里面发请求 / 写存储会产生重复副作用。
   */
  function handleAddProvider(provider: CustomProviderConfig, key: string) {
    const next: ChatSettings = {
      ...form,
      customProviders: [...form.customProviders, provider],
      keys: { ...form.keys, [provider.id]: key },
      // 默认选中第一个模型，省得再手动切
      model: provider.models[0] ?? form.model,
    };
    setForm(next);
    onSave({
      keys: next.keys,
      baseUrls: next.baseUrls,
      customProviders: next.customProviders,
      model: next.model,
      s3: next.s3,
      thinking: next.thinking === true,
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(form.keys)) trimmedKeys[k] = (v ?? "").trim();
    // 自定义供应商的 Key 也要一起带上
    for (const c of form.customProviders) {
      trimmedKeys[c.id] = (form.keys[c.id] ?? "").trim();
    }

    const trimmedBaseUrls: Record<string, string> = {};
    for (const [k, v] of Object.entries(form.baseUrls)) trimmedBaseUrls[k] = (v ?? "").trim();

    onSave({
      keys: trimmedKeys,
      baseUrls: trimmedBaseUrls,
      customProviders: form.customProviders,
      model: form.model,
      s3: form.s3,
      // ⚠️ thinking 必须一起带上，否则每次保存设置都会把它清掉
      thinking: form.thinking === true,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{AGENT_TIP}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {/* 外观：配色预设 */}
          <div className="space-y-2 rounded-xl border border-border/70 bg-card/40 p-3">
            <Label className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              {t("settings.colorTheme")}
            </Label>
            {/* 5 套风格用 2 列会剩一个空格，中等屏起给 3 列 */}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {THEME_PRESETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setPreset(t.id as ThemePreset)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    preset === t.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted",
                  )}
                >
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="mt-0.5 block text-[11px] text-fg-tertiary">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 界面语言：简体 → 繁体 → 英文 → 法文 */}
          <div className="rounded-xl border border-border/70 bg-card/40 p-3">
            <LocalePicker />
          </div>

          {/* 以下全部为站点级配置，普通用户不可见 */}
          {/* API Keys（按服务商）—— 站长可锁死为「仅用内置 Key」 */}
          {isAdmin ? (
          <>
          <div className="space-y-4">
            <Label className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" />
              API Key
              {!ALLOW_CUSTOM_KEY ? (
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-fg-tertiary">
                  {t("settings.builtInNote")}
                </span>
              ) : null}
            </Label>

            {!ALLOW_CUSTOM_KEY ? (
              <p className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-fg-secondary">
                {t("settings.presetReady")}
              </p>
            ) : null}

            {/*
              免责声明：自带的 Key 一旦泄露，损失的是用户自己的额度。
              必须说清楚三件事 —— 存哪儿、怎么用、出事谁负责。
            */}
            {ALLOW_CUSTOM_KEY ? (
              <div className="space-y-1.5 rounded-lg border border-amber-500/35 bg-amber-500/5 px-3 py-2.5">
                <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                  {t("settings.aboutPresetKey")}
                </p>
                <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-fg-tertiary">
                  <li>{t("settings.disclaimer1")}</li>
                  <li>
                    {t("settings.disclaimer2a")}
                    <strong className="font-medium">{t("settings.encrypted")}</strong>
                    {t("settings.disclaimer2b")}
                  </li>
                  <li>
                    {t("settings.disclaimer3a")}
                    <strong className="font-medium">{t("settings.disclaimer3b")}</strong>
                    {t("settings.disclaimer3c")}
                  </li>
                  <li>{t("settings.disclaimer4")}</li>
                </ul>
                <p className="pt-0.5 text-[10px] text-fg-quaternary">
                  {t("settings.agreeDisclaimer")}
                </p>
              </div>
            ) : null}

            <div className={ALLOW_CUSTOM_KEY ? "space-y-4" : "hidden"}>

            {allProviders.map((p) => {
              const pid = p.id;
              const isCustom = "isCustom" in p && p.isCustom;
              return (
                <div key={pid} className="space-y-1.5 rounded-xl border border-border/70 bg-card/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {p.label}
                      {isCustom ? (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {t("settings.custom")}
                        </span>
                      ) : null}
                    </span>
                    {isCustom ? (
                      <button
                        type="button"
                        onClick={() => removeCustomProvider(pid)}
                        className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                      >
                        <XIcon className="h-3 w-3" />
                        {t("common.delete")}
                      </button>
                    ) : (
                      <a
                        href={p.keyUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {t("settings.apply")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      type={showKey[pid] ? "text" : "password"}
                      placeholder={
                        p.hasPreset
                          ? t("settings.keyPresetPlaceholder")
                          : t("settings.keyRequiredPlaceholder", { name: p.label })
                      }
                      value={form.keys[pid] ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, keys: { ...f.keys, [pid]: e.target.value } }))
                      }
                      className="pr-10"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => ({ ...s, [pid]: !s[pid] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                      aria-label={t("settings.toggleKey")}
                    >
                      {showKey[pid] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {isCustom
                      ? t("settings.sendTo", { url: p.baseUrl })
                      : p.hasPreset
                        ? t("settings.storedLocal")
                        : t("settings.requireKeyNote")}
                  </p>

                  {/* 每个供应商独立的 Base URL —— 互不干扰 */}
                  {isAdmin && ALLOW_CUSTOM_BASE_URL ? (
                    <div className="space-y-1 border-t border-border/60 pt-2">
                      <Label
                        htmlFor={`bu-${pid}`}
                        className="flex items-center gap-1.5 text-[11px] text-fg-tertiary"
                      >
                        <Server className="h-3 w-3" />
                        {p.label} {t("settings.baseUrlSuffix")}
                      </Label>
                      <Input
                        id={`bu-${pid}`}
                        placeholder={p.baseUrl || "https://api.example.com/v1"}
                        value={form.baseUrls[pid] ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            baseUrls: { ...f.baseUrls, [pid]: e.target.value },
                          }))
                        }
                        autoComplete="off"
                        className="h-8 text-xs"
                      />
                      {form.baseUrls[pid] && isBlockedBaseUrl(form.baseUrls[pid]) ? (
                        <p className="text-[11px] text-destructive">
                          {t("settings.blockedBaseUrlHint")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 上游上架新模型后在这里增量追加，不用删掉整条重加 */}
                  {isCustom ? (
                    <ProviderModelManager
                      provider={
                        form.customProviders.find((c) => c.id === pid) ?? {
                          id: pid,
                          label: p.label,
                          baseUrl: p.baseUrl,
                          models: [],
                          vision: false,
                          thinking: false,
                        }
                      }
                      apiKey={form.keys[pid] ?? ""}
                      onChange={(models) => updateProviderModels(pid, models)}
                    />
                  ) : null}
                </div>
              );
            })}
            </div>
          </div>

          {/* 添加自定义供应商 */}
          {isAdmin && ALLOW_CUSTOM_BASE_URL ? (
            <CustomProviderEditor
              existingIds={form.customProviders.map((c) => c.id)}
              onAdd={handleAddProvider}
            />
          ) : null}
          </>
          ) : null}

          {/* 模型：已移到输入框左下角的小选择框 */}
          <div className="rounded-xl border border-border/70 bg-card/40 px-3 py-2.5 text-xs text-muted-foreground">
            {t("settings.modelComposerA")}
            <span className="font-medium text-foreground">{form.model}</span>
            {t("settings.modelComposerB")}
          </div>

          {/* 对象存储：图片 / 视频上传 —— 仅管理员可见 */}
          {!isAdmin ? null : (
          <details className="rounded-xl border border-border/70 bg-card/40 px-3 py-2">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <CloudUpload className="h-4 w-4" />
              {t("settings.objectStorageSection")}
              {form.s3?.enabled ? (
                <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t("common.enabled")}
                </span>
              ) : null}
            </summary>

            <div className="mt-3 space-y-3">
              {/*
               * binding 模式：桶已经挂在 Worker 上，权限来自 binding 本身。
               * 这时 Endpoint / AK / SK 全都无意义 —— 显示出来只会让人
               * 以为"还得填点什么"，甚至去搜怎么生成 Access Key。
               * 所以整块手填表单隐藏，只留一张说明卡。
               */}
              {siteInfo?.r2Bound ? (
                <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                  <p className="text-xs font-medium text-primary">
                    {t("settings.r2BoundTitle")}
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {t("settings.r2BoundA")}
                    <strong>{t("settings.r2BoundStrong")}</strong>
                    {t("settings.r2BoundB")}
                  </p>

                  {/*
                    唯一还需要用户提供的就是**访问网址**。
                    留空也能用（走 /api/r2/<key> 回源，桶不必开公开读），
                    但填了自己的域名/CDN 后，图片直接用外网地址，速度更快。
                  */}
                  <div className="space-y-1">
                    <Label className="text-xs">{t("settings.publicDomainLabel")}</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder={t("settings.publicDomainPlaceholder")}
                      value={form.s3?.publicBaseUrl ?? ""}
                      onChange={(e) =>
                        patchS3({ enabled: true, publicBaseUrl: e.target.value })
                      }
                    />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t("settings.publicDomainA")}
                      <code>/api/r2/&lt;key&gt;</code>
                      {t("settings.publicDomainB")}
                      <br />
                      {t("settings.publicDomainC")}
                    </p>
                  </div>
                </div>
              ) : siteInfo?.siteManaged ? (
                <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                  <p className="text-xs font-medium text-primary">{t("settings.siteManagedTitle")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t("settings.siteManagedA")}
                    <strong>{t("settings.siteManagedStrong")}</strong>
                    {siteInfo.bucket ? ` ${t("settings.bucketName", { bucket: siteInfo.bucket })}` : "."}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.s3?.useSiteConfig ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() =>
                      patchS3({
                        enabled: true,
                        useSiteConfig: true,
                        endpoint: siteInfo.endpoint,
                        region: "auto",
                        bucket: siteInfo.bucket,
                        publicBaseUrl: siteInfo.publicBaseUrl,
                        accessKeyId: "",
                        secretAccessKey: "",
                      })
                    }
                  >
                    {form.s3?.useSiteConfig
                      ? t("settings.usingSiteConfig")
                      : t("settings.useSiteConfig")}
                  </Button>
                </div>
              ) : null}

              {/* binding 模式下整个手填表单没有意义，直接不渲染 */}
              {siteInfo?.r2Bound ? null : (
              <>
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                <div className="pr-3">
                  <p className="text-sm">{t("settings.enableStorage")}</p>
                  <p className="text-xs text-muted-foreground">{t("settings.enableStorageDesc")}</p>
                </div>
                <Switch
                  checked={Boolean(form.s3?.enabled)}
                  onCheckedChange={(v) => patchS3({ enabled: v })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t("settings.presetLabel")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {availablePresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        patchS3({
                          endpoint: preset.endpointHint,
                          region: preset.regionHint,
                        })
                      }
                      title={preset.note}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                        preset.limited
                          ? "border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                          : preset.recommended
                            ? "border-primary/40 text-primary hover:bg-primary/10"
                            : "border-border text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.presetHint")}
                </p>
              </div>

              {form.s3?.useSiteConfig ? (
                <p className="rounded-lg border border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                  {t("settings.siteManagedNotice")}
                </p>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.endpoint")}</Label>
                  <Input
                    placeholder={t("settings.endpointPlaceholder")}
                    value={s3.endpoint}
                    onChange={(e) => patchS3({ endpoint: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.region")}</Label>
                  <Input
                    placeholder={t("settings.regionPlaceholder")}
                    value={s3.region}
                    onChange={(e) => patchS3({ region: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.bucket")}</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t("settings.bucketPlaceholder")}
                      value={s3.bucket}
                      onChange={(e) => patchS3({ bucket: e.target.value })}
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 text-xs"
                      disabled={discovering}
                      onClick={() => void discoverBucket()}
                      title={t("settings.bucketMatchTitle")}
                    >
                      {discovering ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      {t("settings.autoFind")}
                    </Button>
                  </div>
                  {discoverMsg ? (
                    <p
                      className={`text-[11px] ${
                        discoverMsg.startsWith(t("settings.bucketFound").slice(0, 3))
                          ? "text-primary"
                          : "text-destructive"
                      }`}
                    >
                      {discoverMsg}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.prefixLabel")}</Label>
                  <Input
                    placeholder="agnes-chat"
                    value={s3.prefix ?? ""}
                    onChange={(e) => patchS3({ prefix: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.accessKeyIdLabel")}</Label>
                  <Input
                    placeholder={t("settings.accessKeyIdPlaceholder")}
                    value={s3.accessKeyId}
                    onChange={(e) => patchS3({ accessKeyId: e.target.value })}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("settings.secretKeyLabel")}</Label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      placeholder={t("settings.secretKeyLabel")}
                      value={s3.secretAccessKey}
                      onChange={(e) => patchS3({ secretAccessKey: e.target.value })}
                      className="pr-10"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                      aria-label={t("settings.toggleSecret")}
                    >
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{t("settings.publicDomainLabel")}</Label>
                <Input
                  placeholder={t("settings.publicDomainPlaceholder2")}
                  value={s3.publicBaseUrl ?? ""}
                  onChange={(e) => patchS3({ publicBaseUrl: e.target.value })}
                  autoComplete="off"
                />
                <p className="text-[11px] text-muted-foreground">
                  {t("settings.publicDomainHint2")}
                </p>
              </div>

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {t("settings.twoSettings")}
                </p>
                <p className="mt-1">
                  {t("settings.req1A")}
                  <strong>{t("settings.req1Strong")}</strong>
                  {t("settings.req1B")}
                </p>
                <p>
                  {t("settings.req2A")}
                  <code className="rounded bg-muted px-1">PUT</code>
                  {t("settings.req2B")}
                </p>
                <p className="mt-1">
                  {t("settings.req3A")}
                  <strong>{t("settings.req3Strong")}</strong>
                  {t("settings.req3B")}
                </p>
                {availablePresets[0]?.platform === "cloudflare" ? (
                  <p className="mt-1">
                    {t("settings.onCfA")}
                    <strong>{t("settings.onCfStrong")}</strong>
                    {t("settings.onCfB")}
                  </p>
                ) : null}
                {availablePresets[0]?.platform === "vercel" ? (
                  <p className="mt-1">
                    {t("settings.onCfA")}
                    <strong>{t("settings.onVercelStrong")}</strong>
                    {t("settings.onVercelB")}
                  </p>
                ) : null}
              </div>
              </>
              )}
            </div>
          </details>
          )}

          {/* 思考模式 */}
          {supportsThinking(form.model) ? (
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 px-3 py-3">
              <div className="pr-3">
                <p className="text-sm font-medium">{t("settings.thinkingMode")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.thinkingModeDesc")}</p>
              </div>
              <Switch
                checked={form.thinking === true}
                onCheckedChange={(v) => setForm((f) => ({ ...f, thinking: v }))}
              />
            </div>
          ) : null}

          {/* 两步验证（TOTP） */}
          {user ? <TwoFactorCard /> : null}

          {/* 云端保存 —— 仅管理员可见（站点级配置已移到 /admin） */}
          {!isAdmin ? null : user ? (
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/40 px-3 py-3">
              <div className="pr-3">
                <p className="text-sm font-medium">{t("settings.cloudSave")}</p>
                <p className="text-xs text-muted-foreground">{t("settings.cloudSaveDesc")}</p>
              </div>
              <Switch checked={cloudSync} onCheckedChange={onCloudSyncChange} />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              {t("settings.cloudSaveLoginHint")}
            </div>
          )}

          {/* 普通用户提示：高级配置已移至管理员面板 */}
          {isAdmin ? null : (
            <div className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-[11px] text-fg-tertiary">
              {t("settings.adminOnlyHint")}
            </div>
          )}

          {/* 清空 */}
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3">
            <p className="text-sm font-medium text-destructive">{t("settings.clearAllTitle")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.clearAllDesc")}</p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-3"
              onClick={() => {
                onClearAll();
                onOpenChange(false);
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("settings.clearAllTitle")}
            </Button>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{t("common.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
