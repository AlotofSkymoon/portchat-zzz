/**
 * UnoCSS 配置 —— 用来替换 Tailwind
 *
 * 为什么是 presetWind3 而不是 presetUno：
 * presetUno 是 UnoCSS 自己的一套类名（跟 Tailwind 有差异），
 * presetWind3 是 Tailwind v3 的兼容层 —— 现有 55 个文件里的
 * lg:flex、gap-3、text-sm 这些类名能原样继续工作，
 * 不用把 4 万行代码一次性重写。这样"分阶段渐进"才成立：
 * 先整体切换过来，再逐个组件把类名换成更语义化的写法。
 *
 * ⚠️ 切换前必读（三处跟 Tailwind 不一样的地方，都得手工补齐）：
 *  1. tailwindcss-animate 插件没有 UnoCSS 版本。项目里用了
 *     animate-in / animate-out / fade-in-0 / zoom-in-95 四个类，
 *     由下面 rules 里的 tw-animate 段手工实现。
 *  2. @apply 需要 transformerDirectives，否则 globals.css 里 16 处
 *     @apply 会原样输出、不生效。
 *  3. data-[state=open]: 这类任意属性变体，presetWind3 未必覆盖，
 *     下面 variants 里补了一条规则兜底。
 */
import {
  defineConfig,
  presetWind3,
  transformerDirectives,
  transformerVariantGroup,
  type Preset,
  type Rule,
  type Variant,
} from "unocss";

/** tailwindcss-animate 的四个类：进出场动画走 CSS 变量，由 Radix 的 data-state 驱动 */
const animateRules: Rule[] = [
  ["animate-in", { "animation-name": "enter", "animation-duration": "150ms" }],
  ["animate-out", { "animation-name": "exit", "animation-duration": "150ms" }],
  [/^fade-in-(\d+)$/, ([, d]) => ({ "--un-enter-opacity": `${+d / 100}` })],
  [/^fade-out-(\d+)$/, ([, d]) => ({ "--un-exit-opacity": `${+d / 100}` })],
  [/^zoom-in-(\d+)$/, ([, d]) => ({ "--un-enter-scale": `${+d / 100}` })],
  [/^zoom-out-(\d+)$/, ([, d]) => ({ "--un-exit-scale": `${+d / 100}` })],
];

/** data-[state=open]: / aria-[expanded=true]: 这类任意属性变体 */
const arbitraryVariants: Variant[] = [
  {
    name: "arbitrary-attr",
    match(matcher) {
      const m = matcher.match(/^(data|aria)-\[([^\]=]+)=([^\]]+)\]:/);
      if (!m) return;
      return {
        matcher: matcher.slice(m[0].length),
        selector: (s) => `[${m[1]}-${m[2]}="${m[3]}"] ${s}`,
      };
    },
  },
];

export default defineConfig({
  /**
   * 提取范围必须明确写出来。
   * @unocss/postcss 默认只扫 .tsx/.vue/.html 这一类，.ts 不在默认列表里，
   * 而项目有相当一部分类名写在 .ts 生成的字符串里 —— 不列出来就会漏提取，
   * 表现为"某些页面的样式整个没了"，而且是静默的，构建照样过。
   */
  content: {
    filesystem: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "lib/**/*.{ts,tsx}",
      "uno.config.ts",
    ],
  },
  presets: [
    // dark 走 class 模式：项目用 [data-theme] + .dark 切换，不是跟随系统
    presetWind3({ dark: "class" }) as Preset,
  ],
  transformers: [
    // globals.css 里有 16 处 @apply
    transformerDirectives(),
    // hover:(bg-x text-y) 这种分组写法（现在没用，先开着免得以后踩坑）
    transformerVariantGroup(),
  ],
  rules: animateRules,
  variants: arbitraryVariants,
  theme: {
    colors: {
      brand: {
        DEFAULT: "#4D6BFE",
        hover: "#3757E4",
        light: "#EDF1FF",
        dark: "#2E45C4",
      },
      sidebar: {
        DEFAULT: "hsl(var(--sidebar))",
        foreground: "hsl(var(--sidebar-foreground))",
      },
      border: "hsl(var(--border))",
      input: "hsl(var(--input))",
      ring: "hsl(var(--ring))",
      background: "hsl(var(--background))",
      foreground: "hsl(var(--foreground))",
      primary: {
        DEFAULT: "hsl(var(--primary))",
        foreground: "hsl(var(--primary-foreground))",
      },
      secondary: {
        DEFAULT: "hsl(var(--secondary))",
        foreground: "hsl(var(--secondary-foreground))",
      },
      fg: {
        DEFAULT: "hsl(var(--foreground))",
        secondary: "hsl(var(--text-secondary))",
        tertiary: "hsl(var(--text-tertiary))",
        quaternary: "hsl(var(--text-quaternary))",
      },
      destructive: {
        DEFAULT: "hsl(var(--destructive))",
        foreground: "hsl(var(--destructive-foreground))",
      },
      muted: {
        DEFAULT: "hsl(var(--muted))",
        foreground: "hsl(var(--muted-foreground))",
      },
      accent: {
        DEFAULT: "hsl(var(--accent))",
        foreground: "hsl(var(--accent-foreground))",
      },
      card: {
        DEFAULT: "hsl(var(--card))",
        foreground: "hsl(var(--card-foreground))",
      },
      popover: {
        DEFAULT: "hsl(var(--popover))",
        foreground: "hsl(var(--popover-foreground))",
      },
    },
    fontFamily: {
      sans: "var(--font-sans)",
      serif: "var(--font-serif)",
      mono: "var(--font-mono)",
    },
    /**
     * 圆角全部走 CSS 变量 —— 这是上一轮刚修好的东西，别写回固定值。
     * 写死 rem 的话各主题定义的 --radius-* 就失效了，
     * 换主题时卡片圆角纹丝不动。
     */
    borderRadius: {
      none: "0",
      sm: "var(--r-sm)",
      DEFAULT: "var(--r-default)",
      md: "var(--r-md)",
      lg: "var(--r-lg)",
      xl: "var(--r-xl)",
      "2xl": "var(--r-2xl)",
      "3xl": "var(--r-3xl)",
      "4xl": "var(--r-4xl)",
      full: "9999px",
    },
    animation: {
      "accordion-down": "accordion-down 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
      "accordion-up": "accordion-up 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
      "fade-in": "fade-in 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
      // 消息是高频事件，240ms 是"新内容需要被看见"的下限，再慢就显得迟钝
      "message-in": "message-in 240ms cubic-bezier(0.16, 1, 0.3, 1)",
      "gradient-pan": "gradient-pan 14s ease-in-out infinite",
      caret: "caret 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      dot: "dot 1.8s cubic-bezier(0.16, 1, 0.3, 1) infinite",
      "logo-bob": "logo-bob 4.6s ease-in-out infinite",
    },
    keyframes: {
      "accordion-down": {
        from: { height: "0" },
        to: { height: "var(--radix-accordion-content-height)" },
      },
      "accordion-up": {
        from: { height: "var(--radix-accordion-content-height)" },
        to: { height: "0" },
      },
      "fade-in": {
        from: { opacity: "0", transform: "translateY(10px)" },
        to: { opacity: "1", transform: "translateY(0)" },
      },
      "message-in": {
        from: { opacity: "0", transform: "translateY(6px)" },
        to: { opacity: "1", transform: "translateY(0)" },
      },
      "gradient-pan": {
        "0%,100%": { backgroundPosition: "0% 50%" },
        "50%": { backgroundPosition: "100% 50%" },
      },
      caret: { "0%, 45%": { opacity: "1" }, "55%, 100%": { opacity: "0.15" } },
      dot: {
        "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.45" },
        "30%": { transform: "translateY(-4px)", opacity: "1" },
      },
      "logo-bob": {
        "0%, 100%": { transform: "translateY(0) rotate(-1.2deg)" },
        "50%": { transform: "translateY(-7px) rotate(1.2deg)" },
      },
      /** tailwindcss-animate 的进出场：变量由 fade-in-0 / zoom-in-95 这类类设置 */
      enter: {
        from: {
          opacity: "var(--un-enter-opacity, 1)",
          transform:
            "translate3d(var(--un-enter-translate-x, 0), var(--un-enter-translate-y, 0), 0) scale3d(var(--un-enter-scale, 1), var(--un-enter-scale, 1), 1)",
        },
      },
      exit: {
        to: {
          opacity: "var(--un-exit-opacity, 1)",
          transform:
            "translate3d(var(--un-exit-translate-x, 0), var(--un-exit-translate-y, 0), 0) scale3d(var(--un-exit-scale, 1), var(--un-exit-scale, 1), 1)",
        },
      },
    },
    transitionTimingFunction: {
      elegant: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
  },
});
