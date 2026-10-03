import { cn } from "@/lib/utils";

/** Portchat 品牌图标（官方 logo 的图形部分，透明底 PNG） */
export function PortchatIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-icon.png"
      alt="Portchat"
      className={cn("h-full w-full object-contain", className)}
      draggable={false}
    />
  );
}

/**
 * 完整 logo（图形 + Portchat 字样）。
 * 深浅两套：深色主题下原图深蓝文字会糊在暗背景上，用白色文字版本。
 */
export function PortchatLogo({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Portchat"
        className="h-full w-full object-contain dark:hidden"
        draggable={false}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-dark.png"
        alt="Portchat"
        className="hidden h-full w-full object-contain dark:block"
        draggable={false}
      />
    </span>
  );
}
