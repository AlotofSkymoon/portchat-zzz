"use client";

import * as React from "react";
import { QrCode, TriangleAlert } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { GlareCard } from "@/components/ui/glare-card";
import type { SponsorChannel } from "@/lib/site";

/**
 * 单个收款渠道的二维码卡片。
 *
 * ⚠️ 为什么做成客户端组件 + onError 降级：
 * 二维码图片是站长自己放的（public/ 或外链）。
 * 忘了放、或外链过期时，用 <img> 会显示一个破图图标 ——
 * 在赞助页上非常难看，而且访客不知道发生了什么。
 *
 * 加载失败时切成说明卡：访客看到"暂未配置"，站长看到该去哪配。
 */
function ChannelCard({ channel }: { channel: SponsorChannel }) {
  const { t } = useI18n();
  const [failed, setFailed] = React.useState(false);

  /**
   * 图片地址变了要重置失败状态 ——
   * 否则站长从坏地址改成好地址后，组件还记着上次的失败，二维码不再出现。
   */
  React.useEffect(() => {
    setFailed(false);
  }, [channel.qr]);

  /*
   * 卡片底是 Aceternity 的高光卡片：指针附近有柔光 + 边缘亮线。
   *
   * ⚠️ 为什么这一块不用主题色变量：
   * 赞助页背景是深色云层，浅色主题下 text-fg-secondary 是深灰，
   * 放在深色卡片上几乎看不见。所以统一用浅色，不跟主题走。
   */
  return (
    <GlareCard className="glare-surface w-full">
      <div className="w-full p-5">
        {failed ? (
          <div className="flex flex-col items-center gap-2.5 py-6 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white/70">
              <TriangleAlert className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-white">
              {t("sponsor.notConfigured", { name: channel.name })}
            </p>
            <p className="px-2 text-xs leading-relaxed text-white/60">
              {t("sponsor.putFileHere")}{" "}
              <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[11px] text-white/80">
                {channel.qr}
              </code>
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-center gap-1.5 text-xs text-white/65">
              <QrCode className="h-3.5 w-3.5" />
              {channel.name}
            </div>
            {/*
              用原生 img 而不是 next/image ——
              项目已全局关闭图片优化（images.unoptimized），且二维码是本地静态资源，
              用 next/image 反而会多一层无谓的处理与配置约束。
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={channel.qr}
              alt={t("sponsor.qrAlt", { name: channel.name })}
              width={640}
              height={640}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="mx-auto aspect-square w-full rounded-2xl bg-white object-contain"
            />
            {channel.note ? (
              <p className="mt-3 text-center text-xs leading-relaxed text-white/60">
                {channel.note}
              </p>
            ) : null}
          </>
        )}
      </div>
    </GlareCard>
  );
}

/**
 * 收款渠道列表。
 *
 * ⚠️ 为什么支持多个：
 * 访客所在地不同，能用的支付方式也不同 ——
 * 只放 AlipayHK 内地用户扫不了，只放支付宝香港用户也扫不了。
 * 两个都摆出来，各自挑方便的那个。
 */
export function SponsorChannels({ channels }: { channels: SponsorChannel[] }) {
  const { t } = useI18n();
  const list = (channels ?? []).filter((c) => c && c.qr);
  if (list.length === 0) return null;

  const single = list.length === 1;

  return (
    <section className="flex flex-col items-center">
      <div
        className={`grid w-full gap-4 ${
          single ? "max-w-[320px]" : "sm:grid-cols-2"
        } ${single ? "" : "max-w-[680px]"}`}
      >
        {list.map((c) => (
          <ChannelCard key={c.id} channel={c} />
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] text-white/50">
        {single
          ? t("sponsor.hintSingle")
          : t("sponsor.hintMulti")}
      </p>
    </section>
  );
}
