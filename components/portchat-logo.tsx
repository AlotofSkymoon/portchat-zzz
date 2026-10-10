import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

/**
 * 品牌色。
 *
 * 蓝色是气泡主体，橙色只用在右上角那三道闪光上 —— 面积很小但位置在
 * 视觉焦点，所以它承担的是"记点"而不是"铺色"。
 *
 * 深色底上纯 #2E7DF6 会闷，所以深色调亮一档到 #4C9AFF；橙色本身够亮，
 * 两档统一，避免深浅切换时色相漂移。
 */
const BLUE = "text-[#2E7DF6] dark:text-[#4C9AFF]";
const ORANGE = "text-[#FF8A00]";

/** 气泡主体：圆角矩形 + 左下尾巴，右上角三道橙色闪光，内部白色脸与两只竖椭圆眼。 */
const BUBBLE_PATH =
  "M13 12H24A10 10 0 0 1 34 22V30A10 10 0 0 1 24 40H19.5L11 46.5L12.8 40H13A10 10 0 0 1 3 30V22A10 10 0 0 1 13 12Z";

const SPARKS = [
  "M27.5 12.5 L29.5 5.5",
  "M33.2 13.5 L38.8 9.5",
  "M36.8 18.5 L44 16.2",
];

/**
 * 图形标记。
 *
 * 公共形状抽成 <g> 供两个尺寸复用；眼睛与脸用白色实心，因此在深浅底
 * 上都成立 —— 它们靠的是气泡本体的蓝，而不是背景。
 */
function BubbleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label={SITE_NAME}
      className={cn("h-full w-full select-none", className)}
    >
      <path d={BUBBLE_PATH} className={cn("fill-current", BLUE)} />
      <g
        fill="none"
        strokeWidth={3.4}
        strokeLinecap="round"
        className={cn("stroke-current", ORANGE)}
      >
        {SPARKS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <ellipse cx={17} cy={26} rx={9} ry={6.2} fill="#FFFFFF" />
      <ellipse cx={12.8} cy={26} rx={2.1} ry={3.3} className={cn("fill-current", BLUE)} />
      <ellipse cx={21.2} cy={26} rx={2.1} ry={3.3} className={cn("fill-current", BLUE)} />
    </svg>
  );
}

export function PortchatIcon({ className }: { className?: string }) {
  return <BubbleMark className={className} />;
}

/**
 * 完整 logo：气泡标记 + 双色字标。
 *
 * "Port" 用蓝、"chat" 用橙，断点落在大小写交界处 —— 正好是这个词天然的
 * 分节，不需要额外加空格或连字符去硬切。
 */
export function PortchatLogo({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-foreground", className)}
    >
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center">
        <BubbleMark />
      </span>
      <span className="text-[15px] font-semibold leading-none tracking-[-0.01em]">
        <span className={BLUE}>Port</span>
        <span className={ORANGE}>chat</span>
      </span>
    </span>
  );
}
