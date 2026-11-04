"use client";

import * as React from "react";

import { useI18n } from "@/components/i18n-provider";

/**
 * 备案徽章。
 *
 * ⚠️ 为什么以前显示不出来（两个独立的原因叠加）：
 *
 * 1. **没有图标就不会渲染徽章。**
 *    萌备案官方给的接入代码只有一行纯文字链接，压根不带图片：
 *    <a href="https://icp.gov.moe/?keyword=20260645">萌ICP备20260645号</a>
 *    所以只粘贴这段代码的话，icpIconUrl 是空的，徽章区根本不渲染。
 *
 * 2. **即使用户自己填了图片地址，也可能永远不加载。**
 *    原来写的是 <img loading="lazy" height={20} className="h-5 w-auto">，
 *    没有 width 属性、CSS 又是 w-auto —— 图片加载前元素宽高为 0。
 *    零面积元素配合 lazy，浏览器可能一直推迟加载，结果什么都不显示。
 *
 * 现在的做法：
 * - 备案链接已知就用**内联 SVG 徽章**，不依赖任何外部图片，一定能显示
 * - 管理员填了自定义图片就优先用图片，加载失败再退回 SVG
 * - 图片去掉 lazy、补上 width/height、加 no-referrer 绕过防盗链
 */

/** 备案服务商识别 */
type BadgeKind = "moe" | "sakura" | "miit" | "gov" | "generic";

interface BadgeStyle {
  kind: BadgeKind;
  /** 徽章上的短标识 */
  mark: string;
  /** 主色 */
  color: string;
  /** 辅助色（渐变用） */
  color2: string;
}

const DEFAULT_STYLE: BadgeStyle = {
  kind: "generic",
  mark: "备",
  color: "#8b5cf6",
  color2: "#6366f1",
};

/**
 * 按备案链接判断服务商。
 *
 * 顺序很重要：先判第三方（域名更具体），再判官方，
 * 否则 icp.gov.moe 会被 `.gov.` 之类的宽松匹配误伤。
 */
export function badgeStyleFromUrl(url: string): BadgeStyle {
  const u = (url || "").toLowerCase();
  if (!u) return DEFAULT_STYLE;

  // 萌备案（萌国 ICP）—— 注意要排在通用 gov 判断之前
  if (u.includes("icp.gov.moe") || u.includes("gov.central.moe") || u.includes("moe.one")) {
    return { kind: "moe", mark: "萌", color: "#ff7eb3", color2: "#a78bfa" };
  }
  // 樱花备案
  if (u.includes("icp.sakura.ink") || u.includes("sakura.ink")) {
    return { kind: "sakura", mark: "樱", color: "#f472b6", color2: "#fb7185" };
  }
  // 公安联网备案
  if (u.includes("beian.gov.cn")) {
    return { kind: "gov", mark: "警", color: "#3b82f6", color2: "#1d4ed8" };
  }
  // 工信部 ICP
  if (u.includes("beian.miit.gov.cn") || u.includes("miit.gov.cn") || u.includes("miitbeian")) {
    return { kind: "miit", mark: "ICP", color: "#0ea5e9", color2: "#0369a1" };
  }
  return DEFAULT_STYLE;
}

/**
 * 内联 SVG 徽章。
 *
 * 用 SVG 而不是外链图片：第三方备案的图标地址随时可能失效，
 * 而且很多图床有防盗链，Referer 不对就返回 403。
 * 内联绘制不依赖网络，一定能显示。
 */
function InlineBadge({ style, size = 18 }: { style: BadgeStyle; size?: number }) {
  const gid = `badge-${style.kind}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden="true"
      className="shrink-0 align-middle"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={style.color} />
          <stop offset="100%" stopColor={style.color2} />
        </linearGradient>
      </defs>
      {/* 圆角底 */}
      <rect x="1" y="1" width="22" height="22" rx="7" fill={`url(#${gid})`} />
      {/* 内描边，深色模式下更清晰 */}
      <rect
        x="1"
        y="1"
        width="22"
        height="22"
        rx="7"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1"
      />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize={style.mark.length > 1 ? 8 : 13}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
      >
        {style.mark}
      </text>
    </svg>
  );
}

export function SiteFooterBadge({
  src,
  alt,
  href,
  size = 18,
}: {
  /** 自定义图标地址，可为空 */
  src?: string;
  alt?: string;
  /** 备案链接，用来判断服务商 */
  href?: string;
  size?: number;
}) {
  const { t } = useI18n();
  // 图片加载失败就退回内联 SVG
  const [failed, setFailed] = React.useState(false);

  /**
   * src 变了要重置失败状态 ——
   * 否则管理员从"坏地址"改成"好地址"后，组件还记着上次的失败，徽章不再出现。
   */
  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  const style = badgeStyleFromUrl(href || "");

  const showImage = Boolean(src) && !failed;

  const node = showImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt || t("footer.badge")}
      /**
       * ⚠️ 必须给宽度。
       * 只有 height + w-auto 时，图片加载前元素面积为 0，
       * 配合 lazy 浏览器可能永远不触发加载。
       * 这里同时去掉 lazy —— 徽章才几十字节，没必要延迟。
       */
      width={20}
      height={20}
      loading="eager"
      decoding="async"
      /** 不带 Referer，规避图床防盗链 */
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-[18px] w-[18px] shrink-0 rounded-md object-contain align-middle"
      style={{ width: size, height: size }}
    />
  ) : (
    <InlineBadge style={style} size={size} />
  );

  if (!href) {
    return (
      <span className="inline-flex items-center" title={alt || t("footer.badge")}>
        {node}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center"
      title={alt || t("footer.badge")}
    >
      {node}
    </a>
  );
}
