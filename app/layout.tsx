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
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_TITLE,
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
    shortcut: [{ url: "/favicon.ico" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#4D6BFE",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
