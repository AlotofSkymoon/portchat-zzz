import { notFound } from "next/navigation";

import { PageTitle } from "@/components/page-i18n";
import { SiteFooter } from "@/components/site-footer";
import { SponsorContent } from "@/components/sponsor/sponsor-content";
import { CloudShader } from "@/components/ui/cloud-shader";
import { SPONSOR_ENABLED, SITE_NAME, pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata = {
  title: pageTitle("赞助"),
  description: "服务器、域名、API 额度用的都是免费额度，站长不担心这块 —— 赞助会直接变成他的生活经费和购物基金。",
};

export default function SponsorPage() {
  if (!SPONSOR_ENABLED) notFound();

  /*
   * 文案主体在 SponsorContent（客户端组件）里 ——
   * 语言切换是客户端状态，文案留在服务端渲染的话切了语言也不会变。
   * 这一层只负责背景、metadata 与页脚。
   */
  return (
    <main className="relative min-h-screen-safe">
      <PageTitle titleKey="route.sponsor" />
      {/*
        整页背景：WebGL 云层（fbm noise），蓝天白云，三层不同速度产生视差。
        WebGL 不可用时由组件内部的 CSS 云团兜底，一样是蓝天白云且会飘。
      */}
      <CloudShader className="pointer-events-none fixed inset-0 -z-10" />

      <SponsorContent />

      {/*
        页脚默认是主题色（浅色主题下是深灰），压在蓝天上会看不清。
        这里整体覆盖成白色系，配合 .on-sky 的投影。
      */}
      <SiteFooter className="on-sky border-white/25! text-white/75 [&_*]:text-white/75 [&_span]:text-white [&_a:hover]:text-white" />
    </main>
  );
}
