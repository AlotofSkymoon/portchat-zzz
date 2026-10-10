import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: { "2xl": "1200px" },
    },
    extend: {
      fontFamily: {
        // Montserrat（英文/数字）+ 昭源環方 Chiron GoRound TC（中文）
        sans: ["var(--font-sans)"],
      serif: ["var(--font-serif)"],
        // SuperSFMonoV1 = SF Mono（拉丁）+ 苹方（中日韩）
        mono: ["var(--font-mono)"],
      },
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
      /*
       * 圆角走 CSS 变量，而不是写死 rem。
       *
       * 之前这里是固定值，导致各主题虽然定义了 --radius-card 之类，
       * 但组件里大量使用的 rounded-lg / rounded-xl 仍然是同一个尺寸 ——
       * 换主题时卡片圆角纹丝不动，"换个风格还是不够圆润"。
       *
       * 改成变量后，每套主题可以真正定义自己的圆角语言：
       * fuwari 最圆、anthropic 克制、sidefolio 面板感、minimalist 近直角。
       * 变量在 globals.css 的 :root 与各 [data-theme] 里定义。
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
        "gradient-pan": {
          "0%,100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
        /** 打字光标：比 pulse 更从容，像真实光标呼吸 */
        "caret": {
          "0%, 45%": { opacity: "1" },
          "55%, 100%": { opacity: "0.15" },
        },
        /** 加载三点：幅度收小、节奏放慢，不再弹跳 */
        "dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.45" },
          "30%": { transform: "translateY(-4px)", opacity: "1" },
        },
        /**
         * 空状态 logo：轻微上下浮动 + 极小幅摆动。
         * 只做「呼吸感」，不做旋转翻滚 —— 大图旋转会显得廉价且晃眼。
         */
        "logo-bob": {
          "0%, 100%": { transform: "translateY(0) rotate(-1.2deg)" },
          "50%": { transform: "translateY(-7px) rotate(1.2deg)" },
        },
        /** 过渡遮罩里的小鲸鱼 —— keyframes 直接写在 app/globals.css，
            因为鲸鱼由 .pt-whale 原生 CSS 驱动，不走 Tailwind 的 animate-* 类，
            写在 config 里不会被 emit。 */
      },
      transitionTimingFunction: {
        /** 优雅缓出：起步轻快、尾部柔和停靠 */
        elegant: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      animation: {
        "accordion-down": "accordion-down 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
        "accordion-up": "accordion-up 0.32s cubic-bezier(0.16, 1, 0.3, 1)",
        "fade-in": "fade-in 0.55s cubic-bezier(0.16, 1, 0.3, 1)",
        "gradient-pan": "gradient-pan 14s ease-in-out infinite",
        "caret": "caret 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "dot": "dot 1.8s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "logo-bob": "logo-bob 4.6s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
