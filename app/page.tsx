import type { Metadata } from "next";

import { LandingContent } from "@/components/landing/landing-content";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * 落地页（首页）。
 *
 * ⚠️ 为什么聊天界面不再是首页：
 * 直接把聊天界面放在 `/`，新访客第一眼只看到一个空输入框 ——
 * 不知道这站能干什么、要不要注册、要不要自备 API Key。
 * 首页先讲清楚「免费、开箱即用、能做什么、怎么联系站长」，再点进 `/chat`。
 */
export const metadata: Metadata = {
  title: `${SITE_NAME} · ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
};

export default function HomePage() {
  return <LandingContent />;
}
