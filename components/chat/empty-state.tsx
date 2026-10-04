"use client";

import { useI18n } from "@/components/i18n-provider";
import { Sparkles, TextShimmer, Vortex } from "@/components/ui/aceternity";

/**
 * 推荐问题。
 *
 * ⚠️ 这里存的是词典 key 而不是现成文案 ——
 * 语言切换后要跟着变，写死的话切到英文还是中文题。
 */
const SUGGESTION_KEYS = [
  { titleKey: "empty.q1", subKey: "empty.q1s" },
  { titleKey: "empty.q2", subKey: "empty.q2s" },
  { titleKey: "empty.q3", subKey: "empty.q3s" },
  { titleKey: "empty.q4", subKey: "empty.q4s" },
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {

  const { t } = useI18n();
  const suggestions = SUGGESTION_KEYS.map((k) => ({
    title: t(k.titleKey),
    sub: t(k.subKey),
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5">
      {/* 主标题区 */}
      <div className="relative mt-4 flex flex-col items-center text-center">
        {/* Aceternity：旋涡背景 + 星点，只在标题区铺，不干扰正文 */}
        <Vortex className="-z-10 h-56 w-56 rounded-full" />
        <Sparkles count={12} className="-z-10 h-40 w-72" />

        {/* 空状态：Coffing（可颂吉祥物）。
            尺寸给足（172px）才看得清酥皮纹理和表情，
            小尺寸下会糊成一团黄影子。 */}
        <span className="mb-5 inline-flex h-[172px] w-[172px] items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/croissant.png"
            alt={t("chat.emptyAlt")}
            className="h-[172px] w-[172px] animate-croissant-bob object-contain drop-shadow-[0_10px_24px_rgba(120,72,24,0.28)]"
            draggable={false}
          />
        </span>
        <h1 className="ios-large-title">
          <TextShimmer>{t("chat.greeting")}</TextShimmer>
        </h1>
        <p className="mt-2.5 text-[15px] text-fg-secondary">{t("chat.whatCanHelp")}</p>
        <p className="mt-3 inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
          {t("chat.onlyChat")}
        </p>
      </div>

      {/* 推荐问题 */}
      <div className="mt-10 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.title)}
            onMouseMove={(e) => {
              const el = e.currentTarget as HTMLElement;
              const r = el.getBoundingClientRect();
              el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
              el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
            }}
            className="acet-spotlight group rounded-xl border border-border bg-card px-4 py-3 text-left transition-all hover:border-primary/50 hover:bg-accent/60"
          >
            <span className="block text-sm font-medium text-foreground">{s.title}</span>
            <span className="mt-0.5 block text-xs text-fg-tertiary">{s.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
