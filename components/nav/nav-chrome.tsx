"use client";

import * as React from "react";
import Link from "next/link";
import { Compass, LogIn, MessageSquare, Shield, User as UserIcon } from "lucide-react";

import { PortchatIcon } from "@/components/portchat-logo";
import { useI18n } from "@/components/i18n-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { SITE_NAME } from "@/lib/site";

interface ChromeUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
}

/** 导航站 / 通用子页面的顶部栏（含主题切换、聊天入口、账户入口） */
export function NavChrome({ user }: { user?: ChromeUser | null }) {
  const { t } = useI18n();
  const [me, setMe] = React.useState<ChromeUser | null>(user ?? null);

  React.useEffect(() => {
    if (user) return;
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.user) setMe(d.user);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <header className="glass-bar relative z-10 flex items-center justify-between gap-2 px-3 py-2.5 sm:px-6">
      <Link href="/" className="flex items-center gap-2">
        <PortchatIcon className="h-7 w-7 text-[#4D6BFE]" />
        <span className="text-sm font-semibold sm:text-base">{SITE_NAME}</span>
      </Link>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/chat">
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">{t("chrome.chat")}</span>
          </Link>
        </Button>
        <Button variant="ghost" size="icon" asChild title={t("chrome.nav")}>
          <Link href="/nav">
            <Compass className="h-4 w-4" />
          </Link>
        </Button>
        <ThemeToggle />

        {me ? (
          <>
            {me.role === "admin" ? (
              <Button variant="ghost" size="icon" asChild title={t("chrome.admin")}>
                <Link href="/admin">
                  <Shield className="h-4 w-4 text-primary" />
                </Link>
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" asChild title={t("chrome.account")}>
              <Link href="/account">
                <UserIcon className="h-4 w-4" />
              </Link>
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">
              <LogIn className="h-4 w-4" />
              {t("sidebar.login")}
            </Link>
          </Button>
        )}
      </div>
    </header>
  );
}
