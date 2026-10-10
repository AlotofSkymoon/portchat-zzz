"use client";

/**
 * 扫码登录落地页的客户端部分。
 *
 * 打开 `/qr?id=...&s=...` 后**自动**兑换，不需要点任何按钮 ——
 * 扫码就是为了快，多一步确认都是多余的。
 *
 * 状态机：pending（兑换中）→ ok（跳转聊天）/ error（展示原因）
 */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";

type Phase = "pending" | "ok" | "error";

export function QrClaimClient() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const secret = params.get("s") ?? "";

  const [phase, setPhase] = React.useState<Phase>("pending");
  const [message, setMessage] = React.useState("");

  // 用一个 ref 兜底：StrictMode 下 effect 会跑两次，但令牌只能兑一次
  const done = React.useRef(false);

  React.useEffect(() => {
    if (!id || !secret) {
      setPhase("error");
      setMessage(t("qr.invalid"));
      return;
    }
    if (done.current) return;
    done.current = true;

    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/qr/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, secret }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!alive) return;
        if (res.ok && data.ok) {
          setPhase("ok");
          // 登录态是 cookie，硬刷一次让服务端组件拿到新会话
          window.location.href = "/chat";
          return;
        }
        setPhase("error");
        setMessage(data.error || t("qr.failed"));
      } catch {
        if (!alive) return;
        setPhase("error");
        setMessage(t("qr.failed"));
      }
    })();

    return () => {
      alive = false;
    };
  }, [id, secret, t]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      {phase === "pending" && (
        <>
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("qr.signingIn")}</p>
        </>
      )}
      {phase === "ok" && (
        <>
          <CheckCircle2 className="size-10 text-emerald-500" />
          <p className="text-sm text-muted-foreground">{t("qr.signedIn")}</p>
        </>
      )}
      {phase === "error" && (
        <>
          <XCircle className="size-10 text-destructive" />
          <p className="max-w-xs text-sm text-muted-foreground">{message}</p>
          <Button variant="outline" onClick={() => router.push("/login")}>
            {t("qr.goLogin")}
          </Button>
        </>
      )}
    </main>
  );
}
