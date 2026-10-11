"use client";

import * as React from "react";
import Link from "next/link";

import { useI18n } from "@/components/i18n-provider";
import {
  CHANGELOG,
  CHANGELOG_START_DATE,
  CHANGELOG_TAG_LABEL,
  type ChangelogTag,
} from "@/lib/changelog";
import { cn } from "@/lib/utils";

const TAG_STYLE: Record<ChangelogTag, string> = {
  new: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  improve: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  fix: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function FoldArrow({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "mt-0.5 shrink-0 text-fg-quaternary transition-transform duration-150",
        open && "rotate-90",
      )}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function ChangelogContent() {
  const { locale, t } = useI18n();
  const zh = locale.startsWith("zh");

  // 默认只展开最新一天，其余收起
  const [openMap, setOpenMap] = React.useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    CHANGELOG.forEach((day, i) => {
      init[day.date] = i === 0;
    });
    return init;
  });

  const allOpen = CHANGELOG.every((day) => openMap[day.date]);

  const toggleDay = React.useCallback((date: string) => {
    setOpenMap((prev) => ({ ...prev, [date]: !prev[date] }));
  }, []);

  const setAll = React.useCallback((value: boolean) => {
    setOpenMap(() => {
      const next: Record<string, boolean> = {};
      CHANGELOG.forEach((day) => {
        next[day.date] = value;
      });
      return next;
    });
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <Link
          href="/chat"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-fg-tertiary transition-colors hover:text-fg-primary"
        >
          {t("auth.backToChat")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("route.changelog")}
        </h1>
        <p className="mt-2 text-sm text-fg-tertiary">
          {zh
            ? `自 ${CHANGELOG_START_DATE} 起连载，记录每次看得见的变化。`
            : `Serialised since ${CHANGELOG_START_DATE}, one entry per visible change.`}
        </p>
      </header>

      <div className="mb-6 flex justify-end">
        <button
          type="button"
          onClick={() => setAll(!allOpen)}
          className="pot-ctrl rounded-full px-3 py-1 text-xs font-medium text-fg-tertiary hover:text-fg-primary"
        >
          {allOpen ? t("changelog.collapseAll") : t("changelog.expandAll")}
        </button>
      </div>

      <ol className="relative space-y-6 border-l border-border pl-5 sm:pl-6">
        {CHANGELOG.map((day) => {
          const open = !!openMap[day.date];
          return (
            <li key={day.date} className="relative">
              <span
                className="absolute -left-[1.4rem] top-2 h-2.5 w-2.5 rounded-full bg-accent sm:-left-[1.65rem]"
                aria-hidden
              />
              <button
                type="button"
                onClick={() => toggleDay(day.date)}
                aria-expanded={open}
                className="group flex w-full items-start gap-2.5 text-left"
              >
                <FoldArrow open={open} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium uppercase tracking-widest text-fg-quaternary">
                    {day.date}
                  </span>
                  <span className="mt-0.5 block text-lg font-medium transition-colors group-hover:text-accent">
                    {zh ? day.title.zh : day.title.en}
                  </span>
                </span>
                <span className="mt-1 shrink-0 text-xs tabular-nums text-fg-quaternary">
                  {day.entries.length}
                </span>
              </button>

              <div
                className={cn("cl-fold grid", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
                aria-hidden={!open}
              >
                <div className="overflow-hidden">
                  <ul className="mt-3 space-y-2.5 pb-1">
                    {day.entries.map((entry, i) => (
                      <li
                        key={`${day.date}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm leading-relaxed text-fg-secondary"
                      >
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            TAG_STYLE[entry.tag],
                          )}
                        >
                          {zh
                            ? CHANGELOG_TAG_LABEL[entry.tag].zh
                            : CHANGELOG_TAG_LABEL[entry.tag].en}
                        </span>
                        <span className="min-w-0 flex-1">{zh ? entry.zh : entry.en}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
