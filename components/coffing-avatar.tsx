import { cn } from "@/lib/utils";

/**
 * Coffing —— Portchat 的聊天伙伴。
 *
 * 透明的甜甜圈小人（端着咖啡杯），直接用 <img> 而不是 SVG：
 * 这是位图素材，做成 data-URI 内联会把包体撑大几十 KB。
 * 透明底 + 暖黄色主体，浅色和深色主题下都能看清，不需要两套图。
 */
export function CoffingAvatar({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/coffing.png"
      alt="Coffing"
      className={cn("h-full w-full object-contain", className)}
      draggable={false}
    />
  );
}
