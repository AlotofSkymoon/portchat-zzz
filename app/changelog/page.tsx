import { PageTitle } from "@/components/page-i18n";
import { ChangelogContent } from "@/components/changelog/changelog-content";
import { SiteFooter } from "@/components/site-footer";
import { SITE_NAME, pageTitle } from "@/lib/site";

export const metadata = {
  title: pageTitle("更新日志"),
  description: "从 2026-10-09 开始连载，记录 Portchat 每次看得见的变化。",
};

export default function ChangelogPage() {
  return (
    <main className="relative min-h-screen-safe">
      <PageTitle titleKey="route.changelog" />
      <ChangelogContent />
      <SiteFooter />
    </main>
  );
}
