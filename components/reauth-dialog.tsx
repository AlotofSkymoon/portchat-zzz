"use client";

import * as React from "react";
import { KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * 二次认证弹窗：密码 / 两步验证 / 邮箱验证码，三选一。
 *
 * 用在「关闭云端保存」这类危险方向上 —— 开启是更安全的一侧，不该拦。
 * 通过后拿到一张一次性凭证（10 分钟有效、用后即焚），交给调用方去完成真正的操作。
 *
 * ⚠️ 这里不做任何状态修改，只负责换凭证：
 * 改状态的是目标接口，它自己会校验凭证，前端跳过弹窗直接调会被拒。
 */

type Method = "password" | "totp" | "email";

const METHODS: Method[] = ["password", "totp", "email"];

function toB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function ReauthDialog({
  open,
  onClose,
  onVerified,
  title,
  description,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: (token: string) => void;
  title?: string;
  description?: string;
}) {
  const { t } = useI18n();
  const [method, setMethod] = React.useState<Method>("password");
  const [value, setValue] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sentTo, setSentTo] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setValue("");
      setSentTo("");
      setBusy(false);
    }
  }, [open]);

  async function sendEmailCode() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "email" }),
      });
      const data = (await res.json()) as { error?: string; hint?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("err.networkError"));
        return;
      }
      setSentTo(data.hint ?? "");
      toast.success(t("reauth.codeSent"));
    } catch {
      toast.error(t("err.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;

    if (method === "email" && !sentTo) {
      await sendEmailCode();
      return;
    }
    if (!value.trim()) {
      toast.error(t("reauth.needInput"));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          password: method === "password" ? value : undefined,
          code: method === "totp" || method === "email" ? value.trim() : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; token?: string };
      if (!res.ok || !data.token) {
        toast.error(data.error ?? t("reauth.failed"));
        return;
      }
      toast.success(t("reauth.verified"));
      onVerified(data.token);
      onClose();
    } catch {
      toast.error(t("err.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const icon = (m: Method) => {
    if (m === "password") return <KeyRound className="h-3.5 w-3.5" />;
    if (m === "totp") return <ShieldCheck className="h-3.5 w-3.5" />;
    return <Mail className="h-3.5 w-3.5" />;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? t("reauth.title")}</DialogTitle>
          <DialogDescription>
            {description ?? t("reauth.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMethod(m);
                setValue("");
                setSentTo("");
              }}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs transition-colors",
                method === m
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {icon(m)}
              {t(`reauth.method.${m}`)}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
            {method === "password" || method === "totp" ? (
              <div className="space-y-2">
                <Label htmlFor="reauth-input">
                  {method === "password" ? t("reauth.passwordLabel") : t("reauth.codeLabel")}
                </Label>
                <Input
                  id="reauth-input"
                  type={method === "password" ? "password" : "text"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={method === "password" ? "" : "000000"}
                  inputMode={method === "password" ? undefined : "numeric"}
                  autoComplete={method === "password" ? "current-password" : "one-time-code"}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="reauth-input">{t("reauth.codeLabel")}</Label>
                <Input
                  id="reauth-input"
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="numeric"
                  placeholder={sentTo ? `${t("reauth.sentTo")} ${sentTo}` : "000000"}
                />
              </div>
            )}
            <div className="flex gap-2">
              {method === "email" ? (
                <Button type="button" variant="outline" onClick={sendEmailCode} disabled={busy}>
                  {sentTo ? t("reauth.resend") : t("reauth.sendCode")}
                </Button>
              ) : null}
              <Button type="submit" className="flex-1" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("reauth.verifyNow")}
              </Button>
            </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
