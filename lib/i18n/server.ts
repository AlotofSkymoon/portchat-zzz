import { DEFAULT_LOCALE, normalizeLocale, type Locale } from "./config";
import { t as translate } from "./dict";

/**
 * 服务端取语言。
 *
 * ⚠️ 为什么读 Accept-Language：
 * 浏览器发 fetch 时会自动带上这个头，前端不用改任何调用点，
 * 老接口也能跟着变语言。若改成让前端显式传，要么每个 fetch 都加参数，
 * 要么漏掉几个 —— 漏掉的那几个就会永远显示简体。
 *
 * ⚠️ 匹配不到就用 DEFAULT_LOCALE：
 * 服务端拿不到用户设置（语言存在浏览器 localStorage 里），
 * 而且错误提示宁可用站点主语言，也不要返回空串。
 */
export function localeFromRequest(req: Request): Locale {
  // 前端若显式指定，优先用它（比浏览器默认更贴近用户选择）
  const explicit = req.headers.get("x-agnes-locale");
  if (explicit) {
    const norm = normalizeLocale(explicit.trim());
    if (explicit.trim() && norm === explicit.trim()) return norm;
  }

  const header = req.headers.get("accept-language") ?? "";
  if (!header) return DEFAULT_LOCALE;

  const tags = header
    .split(",")
    .map((part) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest
        .map((s) => s.trim())
        .find((s) => s.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number.parseFloat(q);
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    if (tag.startsWith("zh-hant") || tag.startsWith("zh-tw") || tag.startsWith("zh-hk") || tag.startsWith("zh-mo")) {
      return "zh-TW";
    }
    if (tag.startsWith("zh")) return "zh-CN";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

/** 服务端翻译：给 API 路由返回本地化的错误说明用 */
export function serverT(
  req: Request,
  key: string,
  vars?: Record<string, string | number>,
): string {
  return translate(key, localeFromRequest(req), vars);
}
