"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, LogOut, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import {
  EmailCard,
  GithubBindCard,
  NicknameCard,
  PasskeyCard,
  QrLoginCard,
  TwoFactorCard,
} from "@/components/account-cards";
import { ReauthDialog } from "@/components/reauth-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LS_KEYS } from "@/lib/config";
import { SiteFooter } from "@/components/site-footer";

interface AccountUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  nickname?: string;
}

export function AccountClient({ user }: { user: AccountUser }) {
  const { t } = useI18n();
  const router = useRouter();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [cloudSync, setCloudSync] = React.useState(true);
  const [syncLoaded, setSyncLoaded] = React.useState(false);
  const [reauthOpen, setReauthOpen] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);

  /**
   * 云端保存：**默认开启**，开关状态存在服务端。
   *
   * ⚠️ 为什么不只放 localStorage：那样清一次浏览器数据就能绕过认证把开关拨回去，
   * 认证就成了摆设。这里以服务端为准，前端只是镜像。
   */
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/user/cloud-sync");
        const data = (await res.json()) as { enabled?: boolean };
        if (alive) {
          setCloudSync(data.enabled !== false);
          localStorage.setItem(LS_KEYS.cloudSync, String(data.enabled !== false));
        }
      } catch {
        // 读不到就按默认开启，不要因为接口抽风把同步关掉
        if (alive) setCloudSync(true);
      } finally {
        if (alive) setSyncLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function applyCloudSync(enabled: boolean, token?: string) {
    setCloudSync(enabled);
    localStorage.setItem(LS_KEYS.cloudSync, String(enabled));
    try {
      const res = await fetch("/api/user/cloud-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, reauthToken: token }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        // 服务端拒绝了（多半是凭证无效）——把开关拨回去，别让界面撒谎
        setCloudSync(!enabled);
        localStorage.setItem(LS_KEYS.cloudSync, String(!enabled));
        toast.error(data.error ?? t("account.cloudSyncFailed"));
        return;
      }
      toast.success(enabled ? t("account.cloudSyncOn") : t("account.cloudSyncOff"));
    } catch {
      setCloudSync(!enabled);
      toast.error(t("auth.networkError"));
    }
  }

  function toggleCloudSync(next: boolean) {
    // 开启是更安全的一侧，不拦；关闭会停同步，必须先验证身份
    if (next) {
      applyCloudSync(true);
      return;
    }
    setReauthOpen(true);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? t("account.changeFailed"));
        return;
      }
      toast.success(t("account.pwdChanged"));
      setCurrent("");
      setNext("");
      router.push("/login");
      router.refresh();
    } catch {
      toast.error(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/chat");
    router.refresh();
  }

  async function clearCloudHistory() {
    setClearing(true);
    try {
      const res = await fetch("/api/conversations", { method: "DELETE" });
      const data = (await res.json()) as { error?: string; deleted?: number };
      if (!res.ok) toast.error(data.error ?? t("account.clearFailed"));
      else toast.success(`${t("account.cloudCleared")}（${data.deleted ?? 0} ${t("account.recordsUnit")}）`);
    } catch {
      toast.error(t("account.networkError"));
    } finally {
      setClearing(false);
    }
  }

  function clearLocalHistory() {
    try {
      // 清空所有本地会话（历史列表 + 每个会话的消息）
      Object.keys(localStorage)
        .filter((k) => k.startsWith("agnes:msgs:") || k === "agnes:conversations")
        .forEach((k) => localStorage.removeItem(k));
      toast.success(t("account.localCleared"));
    } catch {
      toast.error(t("account.clearFailed"));
    }
  }

  return (
    <main className="relative min-h-screen-safe px-4 py-10">
      <div className="pointer-events-none absolute inset-0 aurora" />
      <div className="relative mx-auto w-full max-w-2xl space-y-6">
        <Link
          href="/chat"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("account.backToChat")}
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>{t("account.title")}</CardTitle>
            <CardDescription>
              {user.nickname?.trim() || user.email} · {user.role === "admin" ? t("account.adminRole") : t("account.userRole")} ·{" "}
              {t("account.registeredAt")} {new Date(user.createdAt).toLocaleString("zh-CN")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {user.role === "admin" ? (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary"
              >
                <Shield className="h-4 w-4" />
                {t("account.goAdmin")}
              </Link>
            ) : null}

            {/* 账号类设置：昵称 / 邮箱换绑 / GitHub 绑定 / 两步验证
                与聊天里的设置弹窗共用同一批组件，改一处两边都生效 */}
            <div className="space-y-3">
              <NicknameCard onChanged={() => router.refresh()} />
              <EmailCard onChanged={() => router.refresh()} />
              <GithubBindCard redirect="/account" />
              <PasskeyCard />
              <QrLoginCard />
              <TwoFactorCard />
            </div>

            <div className="h-px bg-border" />

            <form onSubmit={changePassword} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="current">{t("account.currentPwd")}</Label>
                <Input
                  id="current"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="next">{t("account.newPwd")}</Label>
                <Input
                  id="next"
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("account.changePwd")}
              </Button>
            </form>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t("settings.cloudSave")}</p>
                <p className="text-xs text-muted-foreground">{t("account.cloudSaveNote")}</p>
              </div>
              <Switch checked={cloudSync} onCheckedChange={toggleCloudSync} disabled={!syncLoaded} />
            </div>
            <p className="text-xs text-muted-foreground">{t("account.cloudSyncOffHint")}</p>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={clearLocalHistory}>
                <Trash2 className="h-4 w-4" />
                {t("account.clearLocal")}
              </Button>
              <Button variant="outline" onClick={clearCloudHistory} disabled={clearing}>
                <Trash2 className="h-4 w-4" />
                {clearing ? t("account.clearing") : t("account.clearCloud")}
              </Button>
              <Button variant="destructive" onClick={logout}>
                <LogOut className="h-4 w-4" />
                {t("account.logout")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <SiteFooter />

      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onVerified={(token) => applyCloudSync(false, token)}
        title={t("reauth.cloudTitle")}
        description={t("reauth.cloudDescription")}
      />
    </main>
  );
}
