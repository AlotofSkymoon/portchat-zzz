import { cn } from "@/lib/utils";

/**
 * Coffing —— Portchat 的聊天伙伴。
 *
 * 透明的甜甜圈小人（端着咖啡杯），用位图而不是 SVG：
 * 这是位图素材，做成 data-URI 内联会把包体撑大几十 KB。
 * 透明底 + 暖黄色主体，浅色和深色主题下都能看清，不需要两套图。
 *
 * ⚠️ 不要用 <picture> + <source srcSet="/coffing.webp">：
 * 浏览器一旦选中某个 <source>，即使它 404 也**不会**回落到 <img> 的 src，
 * 结果就是整个头像变成破图。要上动图必须先把 webp 文件真的放进 public/。
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
