/**
 * 站点品牌配置。
 *
 * 本站定位：**免费 AI 聊天站**（独立的开源项目，不隶属于任何 API 服务商）。
 * 站长把自己的 Key 和 Base URL 配进环境变量，
 * 访客打开就能直接聊，不用自己申请 Key、也不用填 Base URL。
 *
 * 所以品牌名、上游地址、模型列表全部可配置，默认给 Agnes AI 一套。
 */

/** 站点显示名，默认 Agnes AI。改环境变量 NEXT_PUBLIC_SITE_NAME 即可换。 */
export const SITE_NAME: string =
  process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "Agnes AI";

/** 站点副标题 */
export const SITE_TAGLINE: string =
  process.env.NEXT_PUBLIC_SITE_TAGLINE?.trim() || "免费聊天";

/** 完整标题，如 "Agnes AI 免费聊天" */
export const SITE_TITLE = `${SITE_NAME} ${SITE_TAGLINE}`;

/** 页面标题拼接：pageTitle("登录") → "登录 · Agnes AI 免费聊天" */
export function pageTitle(page: string): string {
  return `${page} · ${SITE_TITLE}`;
}

/** 站点简介（README / SEO / 页脚共用） */
export const SITE_DESCRIPTION: string =
  process.env.NEXT_PUBLIC_SITE_DESCRIPTION?.trim() ||
  `${SITE_NAME} 免费 AI 聊天站。开箱即用，支持自带 API Key 与自定义 Base URL。`;

/**
 * 主题预设。
 * - fuwari：静态博客主题的观感 —— 极简、卡片、大留白，色相可调
 * - violet-rose：紫粉渐变 + 白色圆角卡片（玫瑰点缀）
 * - anthropic：克制的暖色调 —— 米白底、赤陶橙点缀、细边框
 * - sidefolio：侧栏工作台 —— 中性灰阶、近黑深底、面板感（参考 Aceternity Sidefolio）
 * - minimalist：极简作品集 —— 暖白纸面、大留白、近直角发丝框
 */
export type ThemePreset =
  | "fuwari"
  | "violet-rose"
  | "anthropic"
  | "sidefolio"
  | "minimalist";

export const THEME_PRESETS: { id: ThemePreset; label: string; desc: string }[] = [
  { id: "anthropic", label: "Anthropic", desc: "纸感排版 · 衬线思考 · Inter + Source Serif" },
  { id: "fuwari", label: "Fuwari", desc: "极简卡片 · 大留白 · 单色相驱动" },
  { id: "violet-rose", label: "Violet Rose", desc: "紫粉柔光 · 大圆角糖果 · 实心白卡" },
  { id: "sidefolio", label: "Sidefolio", desc: "侧栏工作台 · 中性灰阶 · 近黑深底" },
  { id: "minimalist", label: "Minimalist", desc: "极简作品集 · 大留白 · 近直角发丝框" },
];

export const THEME_IDS: ThemePreset[] = [
  "anthropic",
  "fuwari",
  "violet-rose",
  "sidefolio",
  "minimalist",
];

const DEFAULT_THEME: ThemePreset = (() => {
  const t = process.env.NEXT_PUBLIC_THEME?.trim();
  return THEME_IDS.includes(t as ThemePreset) ? (t as ThemePreset) : "anthropic";
})();

export const SITE_THEME: ThemePreset = DEFAULT_THEME;

/** 站长信息（页脚 / 版权处展示） */
export const AUTHOR_NAME: string =
  process.env.NEXT_PUBLIC_AUTHOR_NAME?.trim() || "wcvjk8tnz8";

/** 仓库地址（页脚链接） */
export const REPO_URL: string =
  process.env.NEXT_PUBLIC_REPO_URL?.trim() || "https://github.com/AlotofSkymoon/agnes-chat";

/**
 * 项目主页地址。
 *
 * 对应 cloud-mail 里的 project_link 变量 —— 页脚和署名处指向项目仓库，
 * 别人看到界面想自己搭一个时，点一下就能找到源码。
 */
export const PROJECT_LINK: string =
  process.env.NEXT_PUBLIC_PROJECT_LINK?.trim() ||
  "https://github.com/wcvjk8tnz8-create/agnes-chat";

/**
 * 是否在页面上展示源码 / 上游仓库链接。
 *
 * ⚠️ 为什么默认关：
 * 这些链接对访客没有任何用处 —— 他们只是来聊天的，不会想去部署一份。
 * 但对站长是实打实的隐私暴露：仓库地址等于把 GitHub 账号、
 * 部署来源、甚至 commit 记录一起公开，被人顺着摸到别的信息并不难。
 *
 * 想开源宣传就设 NEXT_PUBLIC_SHOW_SOURCE_LINKS=true。
 */
export const SHOW_SOURCE_LINKS: boolean =
  process.env.NEXT_PUBLIC_SHOW_SOURCE_LINKS?.trim() === "true";

/**
 * 署名标识：默认只显示站长名字，不带任何链接。
 * 页面会显式展示（页脚 + 侧边栏底部），按 LICENSE 要求不可移除。
 * 想换成自己的地址就改 NEXT_PUBLIC_BY_LINE。
 */
export const BY_LINE: string =
  process.env.NEXT_PUBLIC_BY_LINE?.trim() || `by ${AUTHOR_NAME}`;

/** 上游项目地址（迁移来源，页脚标注） */
export const UPSTREAM_URL: string =
  process.env.NEXT_PUBLIC_UPSTREAM_URL?.trim() || "https://github.com/AlotofSkymoon/agnes-chat";

/**
 * 是否允许访客自带 Key / Base URL。
 * 免费聊天站一般开着（访客想用自己的额度也行）；
 * 想锁死成"只能用站长的"就设 NEXT_PUBLIC_ALLOW_CUSTOM_KEY=false。
 */
export const ALLOW_CUSTOM_KEY =
  process.env.NEXT_PUBLIC_ALLOW_CUSTOM_KEY?.trim() !== "false";

/** 是否允许自定义 Base URL（关掉后只能用环境变量里配置的中转地址） */
export const ALLOW_CUSTOM_BASE_URL =
  process.env.NEXT_PUBLIC_ALLOW_CUSTOM_BASE_URL?.trim() !== "false";

/**
 * 是否开放联网搜索。
 *
 * 默认开放（true）：访客都能用，不需要任何 API Key，
 * 因为走的是 DuckDuckGo 公开端点。
 *
 * 想关掉就设 NEXT_PUBLIC_ALLOW_WEB_SEARCH=false ——
 * 比如你担心额度、或部署环境不允许出站请求。
 */
export const ALLOW_WEB_SEARCH =
  process.env.NEXT_PUBLIC_ALLOW_WEB_SEARCH?.trim() !== "false";

/* ---------------------------------------------------------------------------
   赞助 / 支持
   --------------------------------------------------------------------------- */

/**
 * 是否展示赞助页面。
 * 默认开启；不想放收款码就设 NEXT_PUBLIC_SPONSOR_ENABLED=false，
 * 页面会返回 404，侧边栏入口也会隐藏。
 */
export const SPONSOR_ENABLED =
  process.env.NEXT_PUBLIC_SPONSOR_ENABLED?.trim() !== "false";

/**
 * 收款二维码图片地址。
 *
 * 默认放 public/sponsor-qr.png（把你的收款码存成这个文件名即可）。
 * 也可以直接给一个外链，例如图床地址。
 *
 * ⚠️ 不建议用会过期的临时链接 —— 二维码一旦失效，赞助入口就废了。
 */
export const SPONSOR_QR: string =
  process.env.NEXT_PUBLIC_SPONSOR_QR?.trim() || "/sponsor-qr.png";

/** 收款方式名称，展示在二维码下方 */
export const SPONSOR_METHOD: string =
  process.env.NEXT_PUBLIC_SPONSOR_METHOD?.trim() || "AlipayHK";

/** 赞助说明（支持一句话说明用途） */
export const SPONSOR_NOTE: string =
  process.env.NEXT_PUBLIC_SPONSOR_NOTE?.trim() ||
  "服务器、域名、API 额度都用的免费额度，站长不担心这块。赞助会直接变成他的生活经费和购物基金 —— 谢谢 ☕";

/* ------------------------------------------------------------------ *
 * 收款渠道
 *
 * ⚠️ 为什么支持多个：
 * 访客所在地不同，能用的支付方式也不同 —— 只放 AlipayHK 内地用户扫不了，
 * 只放支付宝香港用户也扫不了。两个都摆出来，各自挑方便的那个。
 *
 * 默认读仓库里自带的两张图：
 *   public/sponsor-alipay.png   内地支付宝
 *   public/sponsor-qr.png       AlipayHK
 * 想改渠道就设 NEXT_PUBLIC_SPONSOR_CHANNELS（JSON 数组）。
 * ------------------------------------------------------------------ */

export interface SponsorChannel {
  id: string;
  name: string;
  /** 图片地址：本地路径或外链 */
  qr: string;
  note: string;
}

const DEFAULT_SPONSOR_CHANNELS: SponsorChannel[] = [
  {
    id: "alipay",
    name: "支付宝",
    qr: "/sponsor-alipay.png",
    note: "内地用户：打开支付宝「扫一扫」",
  },
  {
    id: "alipayhk",
    name: "AlipayHK",
    qr: "/sponsor-qr.png",
    note: "香港用户：用 AlipayHK App 扫码",
  },
];

function resolveSponsorChannels(): SponsorChannel[] {
  // 完全自定义：NEXT_PUBLIC_SPONSOR_CHANNELS='[{"name":"微信支付","qr":"https://..."}]'
  const raw = process.env.NEXT_PUBLIC_SPONSOR_CHANNELS?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const list = parsed
          .filter(
            (c): c is Record<string, unknown> =>
              typeof c === "object" && c !== null && typeof (c as { qr?: unknown }).qr === "string" && Boolean((c as { qr?: string }).qr),
          )
          .map((c, i) => ({
            id: String(c.id ?? `channel-${i}`),
            name: String(c.name ?? "收款码"),
            qr: String(c.qr),
            note: String(c.note ?? ""),
          }));
        // JSON 写错或数组为空时退回默认，不至于让赞助页整个消失
        if (list.length > 0) return list;
      }
    } catch {
      /* JSON 解析失败就用默认渠道 */
    }
  }

  // 兼容旧的单码配置：只填了 NEXT_PUBLIC_SPONSOR_QR 时当成唯一渠道
  const legacy = process.env.NEXT_PUBLIC_SPONSOR_QR?.trim();
  if (legacy) {
    return [{ id: "custom", name: SPONSOR_METHOD, qr: legacy, note: SPONSOR_NOTE }];
  }

  return DEFAULT_SPONSOR_CHANNELS;
}

export const SPONSOR_CHANNELS: SponsorChannel[] = resolveSponsorChannels();

/* ---------------------------------------------------------------------------
   页脚 / 备案
   --------------------------------------------------------------------------- */

/**
 * 备案号文字，例如「京ICP备12345678号-1」。
 * 留空则不显示备案行。
 */
export const ICP_TEXT: string =
  process.env.NEXT_PUBLIC_ICP_TEXT?.trim() || "";

/**
 * 备案号点击后跳转的地址。
 * 官方备案默认指向工信部备案查询系统；
 * 第三方备案（icp.gov.moe / icp.sakura.ink 这类）填它们给的详情页即可。
 */
export const ICP_URL: string =
  process.env.NEXT_PUBLIC_ICP_URL?.trim() ||
  (ICP_TEXT ? "https://beian.miit.gov.cn/" : "");

/**
 * 备案徽章图片地址（可选）。
 *
 * 第三方备案服务（如 icp.gov.moe、icp.sakura.ink）通常会给一个图标地址，
 * 展示在页脚表示"本站已在该处登记"。填了就显示图片。
 *
 * ⚠️ 图片加载失败时会自动隐藏，不会显示破图。
 */
export const ICP_ICON_URL: string =
  process.env.NEXT_PUBLIC_ICP_ICON_URL?.trim() || "";

/**
 * 页脚额外自定义内容（可选）。
 * 想放版权声明、联系方式、免责说明等都可以。
 */
export const FOOTER_EXTRA: string =
  process.env.NEXT_PUBLIC_FOOTER_EXTRA?.trim() || "";

/* ------------------------------------------------------------------ *
 * 联系方式（页脚「联系站长」）
 *
 * 只给两种：Telegram（频道 / 群链接）和 QQ（号码或群链接）。
 *
 * ⚠️ 为什么做成下拉选择而不是随便填一个链接：
 * 站长需要的是"访客点一下就能找到我"，而不是又一个需要手写的 URL。
 * 选了类型之后，QQ 号码会自动拼成 wpa 会话链接、
 * Telegram 用户名会自动拼成 t.me 链接 —— 少一步出错的机会。
 * ------------------------------------------------------------------ */

export type ContactType = "" | "telegram" | "qq";

/** 环境变量兜底（管理员面板里填的值优先） */
export const CONTACT_TYPE: ContactType = (() => {
  const v = process.env.NEXT_PUBLIC_CONTACT_TYPE?.trim();
  return v === "telegram" || v === "qq" ? v : "";
})();

export const CONTACT_VALUE: string =
  process.env.NEXT_PUBLIC_CONTACT_VALUE?.trim() || "";

/**
 * 把联系方式值解析成可点击的链接。
 *
 * 返回空串表示"填的内容没法用"，此时页脚不渲染这一项
 * —— 宁可不显示，也不要渲染出一个点了报错的链接。
 *
 * 只放行 http / https，避免 javascript: 之类的伪协议被当成链接渲染。
 */
export function contactHref(type: ContactType, value: string): string {
  const v = (value || "").trim();
  if (!v || !type) return "";

  // 已经是完整链接
  if (/^https?:\/\//i.test(v)) return v;

  if (type === "qq") {
    // 纯 QQ 号 → 起会话；其他形态（比如群链接）直接按链接处理
    if (/^\d{5,}$/.test(v)) {
      return `https://wpa.qq.com/msgrd?v=3&uin=${encodeURIComponent(v)}&site=qq&menu=yes`;
    }
    // 没有协议的群链接，补上 https
    if (/^(qun|qm\.)?qq\.com\//i.test(v) || /^(qun|qm\.)?qq\.com$/i.test(v)) {
      return `https://${v}`;
    }
    return "";
  }

  if (type === "telegram") {
    // @username / username / t.me/xxx 三种写法都认
    const m = v.match(/^(?:@?|.*t\.me\/)([A-Za-z0-9_]{4,})$/);
    if (m) return `https://t.me/${m[1]}`;
    if (/^t\.me\/[A-Za-z0-9_+/]{4,}/i.test(v)) return `https://${v}`;
    return "";
  }

  return "";
}

/** 是否有任何自定义页脚内容 */
export const HAS_CUSTOM_FOOTER: boolean =
  Boolean(ICP_TEXT) || Boolean(ICP_ICON_URL) || Boolean(FOOTER_EXTRA);

/**
 * 是否必须登录才能对话。
 *
 * 面向开发者的开关：
 *   NEXT_PUBLIC_REQUIRE_LOGIN=true  → 访客必须注册/登录才能聊天
 *   （默认 false，即免登录可用）
 *
 * 为什么做成 NEXT_PUBLIC_ 前缀：前端也需要知道这个值，好在发送前
 * 就拦住并引导去登录，而不是等服务端返回 401 才知道。
 *
 * ⚠️ 前端拦只是体验优化，真正的校验在服务端 /api/chat 里，
 *    两者都要有 —— 只靠前端拦是可以被绕过的。
 */
export const REQUIRE_LOGIN =
  process.env.NEXT_PUBLIC_REQUIRE_LOGIN?.trim() === "true";
