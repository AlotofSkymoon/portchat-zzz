import { PageTitle } from "@/components/page-i18n";
import { SiteFooter } from "@/components/site-footer";
import { MembershipPage } from "@/components/membership/membership-page";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: pageTitle("会员"),
  description: "初级 / 中级 / 高级三档会员，付款后在 App 核对流水，站长手动开通。",
};

export default function Page() {
  /*
   * 文案主体在 MembershipPage（客户端组件）里 ——
   * 语言切换是客户端状态，文案留在服务端渲染的话切了语言也不会变。
   */
  return (
    <main className="relative min-h-screen-safe">
      <PageTitle titleKey="route.membership" />
      <MembershipPage />
      <SiteFooter />
    </main>
  );
}
