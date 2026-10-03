import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { NavBoard } from "@/components/nav/nav-board";
import { I18nText, PageTitle } from "@/components/page-i18n";
import { NavChrome } from "@/components/nav/nav-chrome";
import { Beams, GridBackground, Meteors, Noise } from "@/components/ui/aceternity";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = {
  title: pageTitle("导航"),
  description: "站长工具、免费资源导航与全球域名后缀速查",
};

export default function NavPage() {
  return (
    <>
      <PageTitle titleKey="route.nav" />
    <main className="relative min-h-screen-safe">
      {/* Aceternity 风格背景：极光 + 网格 + 落下的光束 + 流星 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 aurora" />
      <GridBackground className="h-96" />
      <Beams count={10} className="h-96" />
      <Meteors count={12} className="h-96" />
      <Noise className="h-96" />
      <NavChrome />
      <div className="relative">
        <NavBoard />
      </div>
      <div className="pb-10 text-center">
        <Link
          href="/chat"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageSquare className="h-4 w-4" />
          <I18nText k="auth.backToChat" />
        </Link>
      </div>
    </main>
    </>
  );
}
