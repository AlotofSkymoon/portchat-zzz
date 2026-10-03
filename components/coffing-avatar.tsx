import { cn } from "@/lib/utils";

/**
 * Coffing —— Portchat 的聊天伙伴。
 *
 * 透明的甜甜圈小人（端着咖啡杯），用位图而不是 SVG：
 * 这是位图素材，做成 data-URI 内联会把包体撑大几十 KB。
 * 透明底 + 暖黄色主体，浅色和深色主题下都能看清，不需要两套图。
 *
 * ⚠️ 为什么用 <picture>：
 * 官方素材是 webp（由 mp4 转来，很可能是动图），动图头像会更生动。
 * 但浏览器对 animated webp 的支持不如 png 稳（尤其老 Safari），
 * 所以让 webp 优先、png 兜底 —— 有动图就用动图，没有也不会开天窗。
 */
export function CoffingAvatar({ className }: { className?: string }) {
  return (
    <picture className={cn("flex h-full w-full items-center justify-center", className)}>
      <source srcSet="/coffing.webp" type="image/webp" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/coffing.png"
        alt="Coffing"
        className="h-full w-full object-contain"
        draggable={false}
      />
    </picture>
  );
}
