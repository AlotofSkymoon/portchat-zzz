"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/components/i18n-provider";
import * as React from "react";

/** 用户切走（换标签页 / 切窗口 / 最小化）时显示的标题 */
const AWAY_FALLBACK = "别走啊～～(´･Д･)」";

/**
 * 页面离开时改标题。
 * 会自动记住各页面原本的 title（Next 的 metadata 写入），切回来再还原。
 */
export function DynamicTitle() {
  const pathname = usePathname();
  const { t } = useI18n();
  const AWAY_TITLE = t("title.away") || AWAY_FALLBACK;

  const baseRef = React.useRef<string>("");

  // 路由变化后，Next 会把 metadata 的 title 写回 <title>，此时重新取一次基准值
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      const docTitle = document.title;
      if (docTitle && docTitle !== AWAY_TITLE) baseRef.current = docTitle;
      if (document.hidden) document.title = AWAY_TITLE;
    }, 0);
    return () => window.clearTimeout(id);
  }, [pathname, AWAY_TITLE]);

  React.useEffect(() => {
    const setAway = (away: boolean) => {
      if (away) {
        if (document.title !== AWAY_TITLE) {
          baseRef.current = document.title;
          document.title = AWAY_TITLE;
        }
      } else if (baseRef.current && document.title === AWAY_TITLE) {
        document.title = baseRef.current;
      }
    };

    const onVisibility = () => setAway(document.hidden);
    const onBlur = () => setAway(true);
    const onFocus = () => setAway(false);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
