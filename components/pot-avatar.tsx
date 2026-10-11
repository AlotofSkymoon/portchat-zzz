import { cn } from "@/lib/utils";

/**
 * Pot —— 本站的聊天伙伴，头像直接用品牌 logo（气泡 + 橙色闪光）。
 *
 * 用位图而不是 SVG：这是位图素材，做成 data-URI 内联会把包体撑大几十 KB。
 * 透明底 + 蓝橙主体，浅色和深色主题下都能看清，不需要两套图。
 *
 * ⚠️ 不要用 <picture> + <source srcSet="....webp">：
 * 浏览器一旦选中某个 <source>，即使它 404 也**不会**回落到 <img> 的 src，
 * 结果就是整个头像变成破图。要上动图必须先把 webp 文件真的放进 public/。
 */
export function PotAvatar({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-icon.png"
      alt="Pot"
      className={cn("h-full w-full object-contain", className)}
      draggable={false}
    />
  );
}
