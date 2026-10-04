import { PageTitle } from "@/components/page-i18n";
import { SiteFooter } from "@/components/site-footer";
import { CreateView } from "@/components/create/create-view";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: pageTitle("创作"),
  description: "输入描述生成图片，支持比例、画质与参考图。",
};

export default function CreatePage() {
  return (
    <main className="relative min-h-screen-safe">
      <PageTitle titleKey="route.create" />
      <CreateView />
      <SiteFooter />
    </main>
  );
}
