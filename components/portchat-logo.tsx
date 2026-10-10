import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

/**
 * 品牌标记。
 *
 * ⚠️ 这里是**直接用官方 logo 图**，不是用 SVG 重画一遍。
 * 之前那版是照着 logo 临摹的路径，气泡弧度、眼距、三道闪光的倾斜角
 * 全都对不上，越看越假。重画这件事本身就不该做 —— 品牌图就该用品牌图。
 *
 * 资源来源：public/logo-icon.png（由官方 logo 原图裁出图标区、白底转透明）。
 * 用 <img> 而不是 next/image：这是 512px 的小图，不需要响应式分发，
 * 走 next/image 反而会多一层优化请求，且 favicon/侧边栏尺寸都很固定。
 */

/** 图形标记：气泡本体（不含字标）。 */
export function PortchatIcon({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-icon.png"
      alt={SITE_NAME}
      width={512}
      height={512}
      decoding="async"
      className={cn("h-full w-full select-none object-contain", className)}
    />
  );
}

/**
 * 完整 logo：官方图标 + 双色字标。
 *
 * 字标保留文字而非整张锁框图，是因为这里是**横排**场景（侧边栏顶栏）：
 * 官方那张是图标在上、字标在下的竖排构图，塞进 28px 高的横排里会撑高。
 * "Port" 蓝、"chat" 橙的配色跟官方图一致，断点落在大小写交界处。
 */
export function PortchatLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-foreground", className)}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">
        <PortchatIcon />
      </span>
      <span className="text-[15px] font-semibold leading-none tracking-[-0.01em]">
        <span className="text-[#2E7DF6] dark:text-[#4C9AFF]">Port</span>
        <span className="text-[#FF8A00]">chat</span>
      </span>
    </span>
  );
}
