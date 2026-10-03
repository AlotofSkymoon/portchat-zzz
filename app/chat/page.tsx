import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { getCurrentSafeUser } from "@/lib/auth";
import { hasRedisConfig } from "@/lib/redis";
import { pageTitle } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * 聊天主界面。
 *
 * 路由从 `/` 挪到了 `/chat` —— 根路径让给落地页（先介绍站点、再进入聊天）。
 *
 * ⚠️ 为什么聊天页不做 SEO 索引：
 * 它是纯应用界面，被搜索引擎收录没有意义，
 * 反而会让没登录的访客从搜索结果直接掉进一个空界面。
 */
export const metadata: Metadata = {
  title: pageTitle("聊天"),
  robots: { index: false, follow: true },
};

export default async function ChatPage() {
  // 未配置 Redis 时也能聊天（只是不能注册/登录）
  const user = hasRedisConfig() ? await getCurrentSafeUser() : null;

  return (
    <ChatWorkspace
      user={user ? { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt } : null}
    />
  );
}
