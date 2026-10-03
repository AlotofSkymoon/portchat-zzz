"use client";

import Link from "next/link";
import { ArrowLeft, Coffee, Github, HeartHandshake, Share2 } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { SponsorChannels } from "@/components/sponsor/sponsor-qr";
import {
  REPO_URL,
  SHOW_SOURCE_LINKS,
  SITE_NAME,
  SPONSOR_CHANNELS,
} from "@/lib/site";

/**
 * 赞助页的文案主体。
 *
 * ⚠️ 为什么从 page.tsx 抽出来单独做客户端组件：
 * 语言切换是客户端状态，服务端组件读不到 ——
 * 文案留在服务端渲染的话，切了语言标题也不会变。
 * 页面本身保留 metadata（SEO 需要服务端产出），只把文案挪到这里。
 *
 * ⚠️ 为什么整页文字用白色系而不是主题变量：
 * 背景是蓝天白云，深浅两种主题下都要压得住。
 * .on-sky 给文字加了投影，白云飘到字下面也不会糊。
 */

/** 资金去向 —— 写清楚比含糊的「请我喝杯咖啡」更有说服力 */
const USE_KEYS = ["living", "shopping", "motivation"] as const;

export function SponsorContent() {
  const { t } = useI18n();

  /*
   * Star / 提 Issue 都指向仓库地址 —— 与页脚同理，默认不暴露。
   * 关掉后只剩「分享给朋友」这条不依赖外链的方式。
   */
  const otherWays = [
    ...(SHOW_SOURCE_LINKS
      ? [
          {
            icon: Github,
            titleKey: "sponsor.way.star",
            descKey: "sponsor.way.starDesc",
            href: REPO_URL,
            ctaKey: "sponsor.way.goRepo",
          },
        ]
      : []),
    {
      icon: Share2,
      titleKey: "sponsor.way.share",
      descKey: "sponsor.way.shareDesc",
      href: null,
      ctaKey: null,
    },
    ...(SHOW_SOURCE_LINKS
      ? [
          {
            icon: HeartHandshake,
            titleKey: "sponsor.way.feedback",
            descKey: "sponsor.way.feedbackDesc",
            href: `${REPO_URL}/issues`,
            ctaKey: "sponsor.way.submit",
          },
        ]
      : []),
  ];

  return (
    <div className="on-sky relative mx-auto max-w-3xl px-4 py-10 sm:py-14">
      {/* 返回聊天 */}
      <Link
        href="/chat"
        className="mb-8 inline-flex items-center gap-1.5 text-sm text-white/85 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("sponsor.back")}
      </Link>

      {/* 标题 */}
      <header className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#082a63]/50 text-white backdrop-blur-sm">
          <Coffee className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {t("sponsor.support")} {SITE_NAME}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-white/90">
          {t("sponsor.free")}
          <br />
          {t("sponsor.note")}
        </p>
      </header>

      {/* 收款码 —— 客户端组件，图片加载失败时优雅降级 */}
      <SponsorChannels channels={SPONSOR_CHANNELS} />

      {/* 资金去向 */}
      <section className="mt-10">
        <h2 className="mb-4 text-center text-sm font-medium text-white/85">
          {t("sponsor.where")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {USE_KEYS.map((k) => (
            <div
              key={k}
              className="rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl"
            >
              <p className="text-sm font-medium text-white">
                {t(`sponsor.use.${k}`)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-white/80">
                {t(`sponsor.use.${k}Desc`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 其他支持方式 */}
      <section className="mt-10">
        <h2 className="mb-4 text-center text-sm font-medium text-white/85">
          {t("sponsor.other")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {otherWays.map((w) => {
            const Icon = w.icon;
            const body = (
              <>
                <Icon className="mb-2.5 h-4 w-4 text-white" />
                <p className="text-sm font-medium text-white">{t(w.titleKey)}</p>
                <p className="mt-1 text-xs leading-relaxed text-white/80">
                  {t(w.descKey)}
                </p>
                {w.ctaKey ? (
                  <span className="mt-2.5 inline-block text-xs font-medium text-white">
                    {t(w.ctaKey)} →
                  </span>
                ) : null}
              </>
            );
            return w.href ? (
              <Link
                key={w.titleKey}
                href={w.href}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl transition-transform hover:scale-[1.02]"
              >
                {body}
              </Link>
            ) : (
              <div
                key={w.titleKey}
                className="rounded-[var(--radius-card)] border border-white/25 bg-[#082a63]/45 px-4 py-4 backdrop-blur-xl"
              >
                {body}
              </div>
            );
          })}
        </div>
      </section>

      {/* 说明 */}
      <p className="mt-10 text-center text-xs leading-relaxed text-white/75">
        {t("sponsor.voluntary")}
      </p>

      {SHOW_SOURCE_LINKS ? (
        <div className="mt-8 flex justify-center">
          <Link
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-white/60 underline decoration-dotted underline-offset-2 hover:text-white"
          >
            {t("sponsor.homepage")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
