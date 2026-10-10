import { PageTitle } from "@/components/page-i18n";
import { LeaderboardClient } from "@/components/leaderboard-client";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";
export const metadata = { title: pageTitle("排行榜") };

/**
 * 排行榜：聊天次数 / 模型调用次数 / 最垃圾模型投票。
 *
 * ⚠️ 榜单对所有人公开（包括未登录），所以用户名一律走 maskEmail 脱敏，
 * 奖励信息（含域名转移码）只在 /api/stats 里按「本人」返回，这里不渲染他人奖励。
 */
export default function LeaderboardPage() {
  return (
    <>
      <PageTitle titleKey="route.leaderboard" />
      <LeaderboardClient />
    </>
  );
}
