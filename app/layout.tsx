import type { Metadata, Viewport } from "next";

import { I18nProvider } from "@/components/i18n-provider";
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_TITLE,
} from "@/lib/site";
import { PageTransition } from "@/components/page-transition";
import { ThemeAwareToaster } from "@/components/theme-aware-toaster";
import { ThemeProvider, themeInitScript, variantInitScript } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_TITLE,
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  // iOS：加到主屏幕后以全屏 App 运行，状态栏用半透明黑（内容延伸到顶部）
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/pwa-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "256x256" },
      { url: "/pwa-192.png", sizes: "192x192" },
    ],
    shortcut: [{ url: "/favicon.ico" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4D6BFE",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // viewport-fit=cover：让内容延伸到刘海/圆角之下，配合 env(safe-area-inset-*)
  // 做安全区内边距。不加这个，iOS 上左右会有两条黑边。
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* 界面变体必须在首帧前定下来，否则会先渲染 web 观感再跳成 iOS 观感 */}
        <script dangerouslySetInnerHTML={{ __html: variantInitScript }} />
        {/* apple-mobile-web-app-* 三个标签已由 metadata.appleWebApp 生成，这里只补它不管的 */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="format-detection" content="telephone=no" />
        {/* 拉丁字形是首屏必需的（SF Pro），优先预加载；中日韩部分按需加载 */}
        <link
          rel="preload"
          href="/fonts/Montserrat-400.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-sans">
        {/* I18nProvider 包在最外层：语言切换会重渲染整棵子树 */}
        <I18nProvider>
        <ThemeProvider>
          {children}
          {/*
            theme 跟随站点明暗：sonner 默认 theme="light"，
            不传的话深色模式下弹出提示会是白底深字的一块亮斑。
            这里由 ThemeAwareToaster 读取当前 theme 再传给 Toaster。
          */}
          <ThemeAwareToaster />
          {/* 页面切换过渡：挂在最外层，全站生效 */}
          <PageTransition />
        </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
