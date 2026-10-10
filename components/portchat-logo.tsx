import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

/**
 * Portchat 图形标记。
 *
 * 造型取自 "Portchat" 的首字母 P，纯几何构造：一条竖干 + 一段半圆环，
 * 碗内 counter 用 evenodd 挖空。没有渐变、没有发光、没有拟人眼睛，
 * 也没有对话气泡 —— 那些是 AI 产品的通用符号，看久了都一样。
 *
 * 颜色用 currentColor，跟随所在容器的前景色，深浅主题自动适配，
 * 不需要维护两套位图。
 */
const MARK_PATH =
  "M16 40 L16 8 L23 8 A10 10 0 0 1 23 28 L23 40 Z M23 13.5 A4.5 4.5 0 0 1 23 22.5 Z";

export function PortchatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={SITE_NAME}
      className={cn("h-full w-full select-none", className)}
    >
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * 完整 logo：图形标记 + 站点名字样。
 *
 * 字标走单色、字距收紧，不叠渐变也不做双色 —— 站名本身够短，
 * 不需要额外的视觉噱头。站名取自 SITE_NAME，换环境变量即跟着换。
 */
export function PortchatLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-foreground",
        className,
      )}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">
        <PortchatIcon />
      </span>
      <span className="text-[15px] font-medium leading-none tracking-[-0.01em]">
        {SITE_NAME}
      </span>
    </span>
  );
}
