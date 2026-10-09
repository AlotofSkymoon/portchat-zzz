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

export function ChangelogContent() {
  const { locale, t } = useI18n();
  const zh = locale.startsWith("zh");

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

      <ol className="relative space-y-10 border-l border-border pl-5 sm:pl-6">
        {CHANGELOG.map((day) => (
          <li key={day.date} className="relative">
            <span
              className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent sm:-left-[1.65rem]"
              aria-hidden
            />
            <p className="text-xs font-medium uppercase tracking-widest text-fg-quaternary">
              {day.date}
            </p>
            <h2 className="mt-1 text-lg font-medium">{zh ? day.title.zh : day.title.en}</h2>

            <ul className="mt-3 space-y-2.5">
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
                    {zh ? CHANGELOG_TAG_LABEL[entry.tag].zh : CHANGELOG_TAG_LABEL[entry.tag].en}
                  </span>
                  <span className="min-w-0 flex-1">{zh ? entry.zh : entry.en}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
