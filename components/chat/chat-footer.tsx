"use client";

import * as React from "react";

import { useI18n } from "@/components/i18n-provider";
import { SiteFooterBadge } from "@/components/site-footer-badge";
import { useSiteIcp } from "@/lib/use-site-icp";

/**
 * 聊天区底部的备案条。
 *
 * ⚠️ 为什么要有这个：聊天主界面是全屏布局，没有常规页脚，
 * 管理员配了备案号之后在主界面根本看不到 —— 以为没生效。
 *
 * 只在真的配了内容时才占位，什么都不配就完全不渲染，
 * 不会在输入框下面多出一条空白。
 */
export function ChatFooter({ className = "" }: { className?: string }) {
  const { icpText, icpUrl, icpIconUrl, footerExtra } = useSiteIcp();
  const { t } = useI18n();

  const hasAny = Boolean(icpText || icpIconUrl || footerExtra);
  if (!hasAny) return null;

  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 pb-1 text-center text-[11px] text-fg-quaternary ${className}`}
    >
      {/*
        有备案信息就显示徽章（不要求填图标地址）。
        萌备案官方只给文字链接，没填图标时会自动用内联 SVG 兜底。
      */}
      {icpText || icpUrl || icpIconUrl ? (
        <SiteFooterBadge
          src={icpIconUrl || undefined}
          alt={icpText || t("footer.badge")}
          href={icpUrl || undefined}
        />
      ) : null}

      {icpText ? (
        <span>
          {icpUrl ? (
            <a
              href={icpUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-dotted underline-offset-2 hover:text-primary"
            >
              {icpText}
            </a>
          ) : (
            icpText
          )}
        </span>
      ) : null}

      {footerExtra ? <span>{footerExtra}</span> : null}
    </div>
  );
}
