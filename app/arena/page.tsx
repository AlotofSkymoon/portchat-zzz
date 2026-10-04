import { PageTitle } from "@/components/page-i18n";
import { SiteFooter } from "@/components/site-footer";
import { ArenaView } from "@/components/arena/arena-view";
import { SITE_NAME, pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: pageTitle("竞技场"),
  description: "让多个 AI 模型同台辩论，或自动开一局狼人杀。全程无需人工干预。",
};

export default function ArenaPage() {
  return (
    <main className="relative min-h-screen-safe">
      <PageTitle titleKey="route.arena" />
      <ArenaView />
      <SiteFooter />
    </main>
  );
}
