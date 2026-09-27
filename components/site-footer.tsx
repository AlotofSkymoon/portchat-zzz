"use client";

import * as React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n-provider";
import { SiteFooterBadge } from "@/components/site-footer-badge";
import {
  AUTHOR_NAME,
  BY_LINE,
  REPO_URL,
  SHOW_SOURCE_LINKS,
  SITE_NAME,
  UPSTREAM_URL,
} from "@/lib/site";

/**
 * 全站页脚。
 * 按 LICENSE 第四条的署名要求，创作者与上游来源必须可见，不可移除。
 *
 * ⚠️ 为什么改成客户端组件 + 运行时拉取：
 * 备案信息以前只能靠环境变量配，改一次要重新部署，非常麻烦。
 * 现在管理员在面板里填完即生效，所以页脚得在运行时去取站点设置。
 *
 * 取不到时静默用空值 —— 页脚少几行不影响主功能，
 * 没必要因为一个接口失败就报错。
 */

interface FooterSettings {
  icpText: string;
  icpUrl: string;
  icpIconUrl: string;
  footerExtra: string;
}

const EMPTY: FooterSettings = {
  icpText: "",
  icpUrl: "",
  icpIconUrl: "",
  footerExtra: "",
};

export function SiteFooter({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const [footer, setFooter] = React.useState<FooterSettings>(EMPTY);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/site-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: Partial<FooterSettings> } | null) => {
        if (!alive || !d?.settings) return;
        setFooter({
          icpText: d.settings.icpText ?? "",
          icpUrl: d.settings.icpUrl ?? "",
          icpIconUrl: d.settings.icpIconUrl ?? "",
          footerExtra: d.settings.footerExtra ?? "",
        });
      })
      .catch(() => {
        /* 取不到就保持空，页脚照常显示署名部分 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const hasCustom = Boolean(
    footer.icpText || footer.icpIconUrl || footer.footerExtra,
  );

  return (
    <footer
      className={`border-t border-border/60 px-4 py-4 text-center text-[11px] leading-relaxed text-fg-tertiary ${className}`}
    >
      <p>
        <span className="font-medium text-fg-secondary">{SITE_NAME}</span> {t("footer.freeSite")} · {t("footer.by")}{" "}
        <span className="font-medium text-fg-secondary">{AUTHOR_NAME}</span> {t("footer.created")}
      </p>
      {/*
        源码 / 上游仓库链接：默认**不显示**。
        对访客没用（他们不会去部署），对站长却是隐私暴露 ——
        仓库地址会连带暴露 GitHub 账号与部署来源。
        想展示就设 NEXT_PUBLIC_SHOW_SOURCE_LINKS=true。
      */}
      {SHOW_SOURCE_LINKS ? (
        <>
          <p className="mt-1">
            {t("footer.upstream")}{" "}
            <Link
              href={UPSTREAM_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted underline-offset-2 hover:text-primary"
            >
              AlotofSkymoon/agnes-chat
            </Link>
            {" · "}
            <Link
              href={REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted underline-offset-2 hover:text-primary"
            >
              {t("footer.source")}
            </Link>
          </p>
          <p className="mt-1.5 text-fg-quaternary">
            {t("footer.license")}
          </p>
        </>
      ) : null}

      {/* 备案信息 + 自定义内容：管理员在面板里填，改完即生效 */}
      {hasCustom ? (
        <div className="mt-2 flex flex-col items-center gap-1.5">
          {/*
            备案徽章。
            ⚠️ 以前只在填了 icpIconUrl 时才渲染 ——
            但萌备案官方给的接入代码只有文字链接、不带图片，
            于是"配了备案号却看不到徽章"，看着像没生效。
            现在只要有备案号或备案链接就渲染，缺图标时用内联 SVG 兜底。
          */}
          {footer.icpText || footer.icpUrl || footer.icpIconUrl ? (
            <SiteFooterBadge
              src={footer.icpIconUrl || undefined}
              alt={footer.icpText || t("footer.badge")}
              href={footer.icpUrl || undefined}
            />
          ) : null}

          {/* 备案号 */}
          {footer.icpText ? (
            <p className="text-fg-quaternary">
              {footer.icpUrl ? (
                <a
                  href={footer.icpUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline decoration-dotted underline-offset-2 hover:text-primary"
                >
                  {footer.icpText}
                </a>
              ) : (
                footer.icpText
              )}
            </p>
          ) : null}

          {/* 额外自定义文字 */}
          {footer.footerExtra ? (
            <p className="text-fg-quaternary">{footer.footerExtra}</p>
          ) : null}
        </div>
      ) : null}

      {/* 署名标识：按 LICENSE 要求保留，不可移除 */}
      <p className="mt-1 font-medium tracking-wide text-fg-tertiary">{BY_LINE}</p>
    </footer>
  );
}
