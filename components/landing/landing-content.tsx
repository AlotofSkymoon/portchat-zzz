"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Coffee,
  Globe,
  Image as ImageIcon,
  Send,
  ServerCog,
  Sparkles,
} from "lucide-react";

import { PotIcon } from "@/components/pot-logo";
import { useI18n } from "@/components/i18n-provider";
import { LocalePickerCompact } from "@/components/locale-picker";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AUTHOR_HOMEPAGE,
  AUTHOR_NAME,
  SITE_NAME,
  SITE_TAGLINE,
  SPONSOR_ENABLED,
  contactHref,
  type ContactType,
} from "@/lib/site";

/**
 * 落地页（首页）。
 *
 * ⚠️ 为什么聊天界面从 `/` 挪到了 `/chat`：
 * 直接把聊天界面当首页，新访客第一眼看到的是一个空输入框 ——
 * 不知道这站能干什么、要不要注册、要不要自己准备 Key。
 * 落地页先把「免费、开箱即用、能做什么」讲清楚，再让人点进去。
 *
 * ⚠️ 为什么文案全部走 i18n 而不是写死中文：
 * 站点有四门语言，切到英文/法文时整个首页不能还是中文。
 */

/** 能力卡片：icon 是组件引用，不能放进服务端常量 */
const FEATURES = [
  { icon: Sparkles, key: "free" },
  { icon: Send, key: "models" },
  { icon: ImageIcon, key: "media" },
  { icon: ServerCog, key: "sync" },
] as const;

/**
 * 聚光灯跟随：把鼠标位置写进 CSS 变量。
 * 不用 JS 逐帧算样式，交给 CSS 的 radial-gradient 渲染。
 */
function useSpotlight() {
  return React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }, []);
}

/** 手机里的对话预览：纯装饰，用 CSS 依次浮现 */
const PREVIEW_USER = "landing.preview.user";
const PREVIEW_REPLY = [
  "landing.preview.r1",
  "landing.preview.r2",
  "landing.preview.r3",
];

export function LandingContent() {
  const { t } = useI18n();
  const onSpot = useSpotlight();

  /** 联系方式在管理员面板里填，运行时拉取；拿不到就不渲染那一格 */
  const [contact, setContact] = React.useState<{
    type: ContactType;
    value: string;
  }>({ type: "", value: "" });

  React.useEffect(() => {
    let alive = true;
    fetch("/api/site-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { settings?: { contactType?: string; contactValue?: string } } | null) => {
          if (!alive || !d?.settings) return;
          setContact({
            type: (d.settings.contactType ?? "") as ContactType,
            value: d.settings.contactValue ?? "",
          });
        },
      )
      .catch(() => {
        /* 取不到就不显示即时通讯那一格，个人主页仍然可用 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const contactLink = contactHref(contact.type, contact.value);
  const contactLabel =
    contact.type === "qq" ? t("footer.contactQq") : t("footer.contactTelegram");

  return (
    <div className="aurora relative min-h-screen-safe">
      {/* ---------------- 顶栏 ---------------- */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2">
          <PotIcon className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight">{SITE_NAME}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <LocalePickerCompact />
          <ThemeToggle />
          <Link
            href="/chat"
            className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95"
          >
            {t("landing.enter")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-5 pb-14 pt-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pt-14">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 glass px-3 py-1 text-[12px] text-fg-secondary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {t("landing.badge")}
          </span>

          <h1 className="mt-5 text-[clamp(2rem,6vw,3.25rem)] font-bold leading-[1.12] tracking-tight">
            {t("landing.title1")}
            <br />
            <span className="bg-gradient-to-r from-primary via-[hsl(280_85%_66%)] to-[hsl(190_90%_58%)] bg-clip-text text-transparent">
              {t("landing.title2")}
            </span>
          </h1>

          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-fg-secondary">
            {t("landing.desc")}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/chat"
              className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-[15px] font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:gap-3 hover:shadow-xl hover:shadow-primary/30 active:scale-[0.98]"
            >
              {t("landing.cta")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {SPONSOR_ENABLED ? (
              <Link
                href="/sponsor"
                className="inline-flex items-center gap-2 rounded-full border border-border glass px-5 py-3 text-[14px] font-medium text-fg-secondary transition-colors hover:text-fg"
              >
                <Coffee className="h-4 w-4" />
                {t("landing.ctaSponsor")}
              </Link>
            ) : null}
          </div>

          <p className="mt-4 text-[12px] text-fg-tertiary">{t("landing.note")}</p>
        </div>

        {/* 手机预览：外壳是 CSS 画的，里面的气泡是静态装饰 */}
        <div className="flex justify-center lg:justify-end">
          <div className="relative w-[268px] rounded-[2.25rem] border-[9px] border-[hsl(230_18%_14%)] bg-[hsl(230_18%_14%)] shadow-2xl">
            {/* 刘海 */}
            <div className="absolute left-1/2 top-0 z-20 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[hsl(230_18%_14%)]" />
            <div className="h-[470px] overflow-hidden rounded-[1.7rem] bg-background p-3">
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-1.5 pb-3 pt-1">
                  <PotIcon className="h-4 w-4" />
                  <span className="text-[11px] font-medium">{SITE_NAME}</span>
                  <span className="ml-auto text-[10px] text-fg-tertiary">
                    {SITE_TAGLINE}
                  </span>
                </div>

                {/* 用户消息 */}
                <div className="ml-auto max-w-[80%] animate-[landing-rise_0.6s_ease-out_both] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[11.5px] leading-relaxed text-primary-foreground">
                  {t(PREVIEW_USER)}
                </div>

                {/* AI 回复：三条依次浮现 */}
                <div className="mt-2 space-y-2">
                  {PREVIEW_REPLY.map((k, i) => (
                    <div
                      key={k}
                      style={{ animationDelay: `${0.35 + i * 0.55}s` }}
                      className="max-w-[88%] animate-[landing-rise_0.6s_ease-out_both] rounded-2xl rounded-bl-sm border border-border/70 glass px-3 py-2 text-[11.5px] leading-relaxed text-fg-secondary"
                    >
                      {t(k)}
                    </div>
                  ))}
                </div>

                <div className="mt-auto flex items-center gap-2 rounded-full border border-border/70 glass px-3 py-2">
                  <span className="text-[11px] text-fg-tertiary">{t("input.placeholder")}</span>
                  <span className="ml-auto grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 能力 ---------------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-14">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, key }) => (
            <div
              key={key}
              onMouseMove={onSpot}
              className="acet-spotlight rounded-2xl border border-border/70 glass p-5"
            >
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-3 text-[14px] font-semibold">{t(`landing.feat.${key}`)}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-fg-tertiary">
                {t(`landing.feat.${key}Desc`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- 联系站长 ---------------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-3xl border border-border/70 glass p-6 sm:p-8">
          <h2 className="text-[17px] font-semibold">{t("landing.contact.title")}</h2>
          <p className="mt-1.5 text-[13px] text-fg-tertiary">
            {t("landing.contact.desc")}
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {AUTHOR_HOMEPAGE ? (
              <a
                href={AUTHOR_HOMEPAGE}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 rounded-2xl border border-border/70 glass px-4 py-3 transition-colors hover:border-primary/50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Globe className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">
                    {t("landing.contact.homepage")}
                  </span>
                  <span className="block truncate text-[11.5px] text-fg-tertiary">
                    {AUTHOR_HOMEPAGE.replace(/^https?:\/\//, "")}
                  </span>
                </span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </a>
            ) : null}

            {/*
              即时通讯：管理员面板里填的 Telegram / QQ。
              解析不出可点击链接时整格不渲染 ——
              宁可少一格，也不要放一个点了报错的链接。
            */}
            {contactLink ? (
              <a
                href={contactLink}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 rounded-2xl border border-border/70 glass px-4 py-3 transition-colors hover:border-primary/50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Send className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">{contactLabel}</span>
                  <span className="block truncate text-[11.5px] text-fg-tertiary">
                    {t("landing.contact.chat")}
                  </span>
                </span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-fg-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </a>
            ) : null}
          </div>

          <p className="mt-4 text-[11.5px] text-fg-quaternary">
            {t("footer.by")} {AUTHOR_NAME}
          </p>
        </div>
      </section>

      <SiteFooter className="relative z-10" />
    </div>
  );
}
