import { QrClaimClient } from "@/components/qr-claim-client";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: pageTitle("扫码登录") };

/**
 * 二维码登录落地页。
 *
 * 扫二维码的那台设备会打开 `/qr?id=...&s=...`，
 * 这个页面拿到参数后**自动**完成兑换，不需要再点任何按钮 ——
 * 扫码就是为了快，多一步确认都是多余的。
 *
 * ⚠️ secret 出现在地址栏里，这是二维码登录的固有形态
 * （Google / 微信的扫码登录同样如此）。缓解手段是：
 * 令牌 5 分钟过期、一次兑换即销毁、服务端只存 hash。
 */
export default function QrPage() {
  return <QrClaimClient />;
}
