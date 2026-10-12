/**
 * UnoCSS 配置 —— 用来替换 Tailwind
 *
 * ⚠️⚠️ 版本锁定：package.json 里 unocss 与 @unocss/postcss 都锁 "0.65.4"。
 * 这个版本导出的预设叫 presetUno，**不是** presetWind3。
 * presetWind3 / presetWind4 是 66.x 才改的名字 —— 在 0.65.4 里写
 * presetWind3 会得到 "(0, _unocss.presetWind3) is not a function"，
 * 且报错发生在 postcss 插件内部，构建日志里根本指不到这一行，极难定位。
 * 要升级到 66.x，必须同时改 import 名并重新验证全部类名覆盖率。
 *
 * presetUno 本身就是 UnoCSS 的 Tailwind/Windi 兼容预设（presetMini + presetWind），
 * 现有 55 个文件里的 lg:flex、gap-3、text-sm 这些类名能原样继续工作，
 * 不用把 4 万行代码一次性重写。这样"分阶段渐进"才成立：
 * 先整体切换过来，再逐个组件把类名换成更语义化的写法。
 *
 * ⚠️ 切换前必读（三处跟 Tailwind 不一样的地方，都得手工补齐）：
 *  1. tailwindcss-animate 插件没有 UnoCSS 版本。项目里用了
 *     animate-in / animate-out / fade-in-0 / zoom-in-95 四个类，
 *     由下面 rules 里的 tw-animate 段手工实现。
 *  2. @apply 需要 transformerDirectives，否则 globals.css 里 16 处
 *     @apply 会原样输出、不生效。
 *  3. data-[state=open]: 这类任意属性变体，presetUno 未必覆盖，
 *     下面 variants 里补了一条规则兜底。
 */
import {
  defineConfig,
  presetUno,
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

/**
 * 项目自定义动画。
 *
 * ⚠️⚠️ 这些**必须写成 rules，不能写进 theme.animation**。
 * 实测（unocss 0.65.4）：theme.animation 里写 "message-in": "message-in 240ms ..."，
 * generate("animate-message-in") 返回空字符串 —— 不报错，动画直接消失。
 * 更坑的是 animate-fade-in：theme.animation 没生效时它会退回到预设自带的
 * keyframes，生成 `animation: fade-in 1s linear 1`（时长、缓动全被吞掉），
 * 看着"有动画"，其实是错的动画。
 *
 * 对应的 @keyframes 写在 app/globals.css 里 —— Tailwind 时代由 config 的
 * keyframes 自动 emit，UnoCSS 不会，必须手写。
 */
/**
 * Tailwind 里由插件/核心提供、但 presetUno 未必覆盖的类，显式补齐。
 *
 * ⚠️ 这类缺失是**静默**的：类名不认识就不产出 CSS，构建照样成功，
 * 页面只是悄悄塌掉。其中 container 全站用了 28 处 —— 它一丢，
 * 首页/落地页的居中限宽整排失效，且日志里不会有任何提示。
 * 所以这里宁可重复定义（config.rules 优先于 preset，语义一致即可）。
 */
const tailwindCompatRules: Rule[] = [
  [
    "container",
    {
      width: "100%",
      "margin-left": "auto",
      "margin-right": "auto",
      "padding-left": "1rem",
      "padding-right": "1rem",
      /* 断点写在 app/globals.css 的 .container 块里 —— Rule 的 CSSObject 类型
         不接受嵌套对象（@media 值），写在这里会报 TS2322。 */
    },
  ],
  [
    "sr-only",
    {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      "white-space": "nowrap",
      "border-width": "0",
    },
  ],
  [
    "not-sr-only",
    {
      position: "static",
      width: "auto",
      height: "auto",
      padding: "0",
      margin: "0",
      overflow: "visible",
      clip: "auto",
      "white-space": "normal",
    },
  ],
];

const projectAnimations: Rule[] = [
  ["animate-fade-in", { animation: "fade-in 0.55s cubic-bezier(0.16, 1, 0.3, 1)" }],
  ["animate-message-in", { animation: "message-in 240ms cubic-bezier(0.16, 1, 0.3, 1)" }],
  ["animate-caret", { animation: "caret 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite" }],
  ["animate-dot", { animation: "dot 1.8s cubic-bezier(0.16, 1, 0.3, 1) infinite" }],
  ["animate-logo-bob", { animation: "logo-bob 4.6s ease-in-out infinite" }],
  ["animate-gradient-pan", { animation: "gradient-pan 14s ease-in-out infinite" }],
  ["animate-accordion-down", { animation: "accordion-down 0.32s cubic-bezier(0.16, 1, 0.3, 1)" }],
  ["animate-accordion-up", { animation: "accordion-up 0.32s cubic-bezier(0.16, 1, 0.3, 1)" }],
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
        /**
         * ⚠️ 属性必须**追加在自身选择器后面**，不能放在前面当祖先。
         * 写成 `[data-state="open"] ${s}` 是后代选择器 —— 要求类名落在
         * 子元素上，Radix 的 data-state 就在元素自身，结果整批展开/收起
         * 过渡静默失效（类名生成了、CSS 也在，但永远匹配不到元素）。
         */
        selector: (s) => `${s}[${m[1]}-${m[2]}="${m[3]}"]`,
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
    presetUno({ dark: "class" }) as Preset,
  ],
  transformers: [
    // globals.css 里有 16 处 @apply
    transformerDirectives(),
    // hover:(bg-x text-y) 这种分组写法（现在没用，先开着免得以后踩坑）
    transformerVariantGroup(),
  ],
  rules: [...tailwindCompatRules, ...animateRules, ...projectAnimations],
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
    /**
     * ⚠️ 键名是 easing，不是 Tailwind 的 transitionTimingFunction。
     * 实测：写在 transitionTimingFunction 下，ease-elegant 生成结果是空字符串 ——
     * 不报错，只是样式静默消失。
     */
    easing: {
      /** 优雅缓出：起步轻快、尾部柔和停靠 */
      elegant: "cubic-bezier(0.16, 1, 0.3, 1)",
    },
  },
});
