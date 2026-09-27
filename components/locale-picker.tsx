"use client";

import * as React from "react";

import { useI18n } from "@/components/i18n-provider";
import { LOCALE_META, LOCALES, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * 语言切换器。
 *
 * ⚠️ 为什么是四格横排而不是下拉框：
 * 只有 4 个选项，横排一眼看全，比下拉少两次点击；
 * 而且下拉框在小屏上容易被键盘挡住。
 *
 * ⚠️ 为什么用原生 button + role="radiogroup"：
 * 语言切换本质是单选，用 radio 语义屏幕阅读器能直接播报
 * "已选 简体中文"，比一堆无关联的按钮清晰。
 */
export function LocalePicker({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs font-medium text-fg-secondary">{t("settings.language")}</p>
      <div
        role="radiogroup"
        aria-label={t("settings.language")}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {LOCALES.map((code) => {
          const meta = LOCALE_META[code];
          const active = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setLocale(code as Locale)}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs transition-colors",
                active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-fg-secondary hover:bg-muted",
              )}
            >
              {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 紧凑版：只显示「简 / 繁 / EN / FR」，用在顶栏等空间紧张的地方 */
export function LocalePickerCompact({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      role="radiogroup"
      aria-label={t("settings.language")}
      className={cn("inline-flex overflow-hidden rounded-full border border-border", className)}
    >
      {LOCALES.map((code) => {
        const meta = LOCALE_META[code];
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            title={meta.label}
            onClick={() => setLocale(code as Locale)}
            className={cn(
              "px-2.5 py-1 text-[11px] transition-colors",
              active
                ? "bg-primary font-medium text-primary-foreground"
                : "text-fg-tertiary hover:bg-muted",
            )}
          >
            {meta.short}
          </button>
        );
      })}
    </div>
  );
}
