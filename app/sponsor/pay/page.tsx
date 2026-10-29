/**
 * 付款页。
 *
 * 这是赞助页上那个动态二维码扫下去之后落地的页面：
 * 显示本笔订单的令牌 + 真实的 AlipayHK 收款码，付款人照常付款，
 * 然后把令牌抄进付款备注、把平台交易号填回这里。
 *
 * ⚠️ 为什么服务端这层只做 metadata：
 * 语言切换是客户端状态，文案留在服务端渲染的话切了语言也不会变。
 * 与赞助页同一套做法。
 */

import { PageTitle } from "@/components/page-i18n";
import { PayClient } from "@/components/sponsor/pay-client";
import { SPONSOR_ENABLED, pageTitle } from "@/lib/site";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
  title: pageTitle("付款"),
  description: "扫码后确认订单令牌并完成付款，提交交易号即可完成核销。",
};

export default function PayPage() {
  if (!SPONSOR_ENABLED) notFound();

  return (
    <main className="relative min-h-screen-safe bg-bg-base px-4 py-10">
      <PageTitle titleKey="route.pay" />
      <PayClient />
    </main>
  );
}
