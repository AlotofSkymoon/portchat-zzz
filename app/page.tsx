import { redirect } from "next/navigation";

/**
 * 根路径直达聊天。
 *
 * ⚠️ 为什么这里没有落地页了：
 * 原来的落地页（components/landing/landing-content.tsx）已移除，
 * 那份介绍页改由一个独立的静态 HTML 承载（可部署到任意静态托管），
 * 所有入口按钮指向 https://chat.xyz.ci/chat。
 * 本项目只保留聊天本身，访问 `/` 直接进 `/chat`，少一次跳转犹豫。
 */
export default function HomePage() {
  redirect("/chat");
}
