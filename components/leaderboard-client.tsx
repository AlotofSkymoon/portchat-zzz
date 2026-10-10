"use client";

/**
 * 排行榜：三张榜 + 最垃圾模型投票 + 本人奖励。
 *
 * 几个刻意的取舍：
 *   1. 榜单公开，但只显示脱敏后的名字 —— 不把邮箱摆到公开页面
 *   2. 「最垃圾模型」投票每人每月一票，改投自动减掉旧票（服务端已处理）
 *   3. 投票只是民意，不会真的下架模型；真正隐藏由管理员在后台用 hiddenModels 手动做
 *   4. 奖励卡片只在本人获奖时出现，转移码不进榜单数据
 */

import * as React from "react";
import { Award, Download, Loader2, ThumbsDown, Trophy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/i18n-provider";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { CHAT_MODELS } from "@/lib/config";

type Row = { subject: string; count: number; label?: string; isAdmin?: boolean };

type StatsData = {
  period: string;
  msUntilReset: number;
  chat: Row[];
  model: Row[];
  worst: Row[];
  myWorstVote: string | null;
  myReward: {
    period: string;
    domain: string;
    note: string;
    imageUrl: string;
    count: number;
  } | null;
};

function fmtReset(ms: number): string {
  const d = Math.max(0, Math.floor(ms / 86_400_000));
  const h = Math.max(0, Math.floor((ms % 86_400_000) / 3_600_000));
  return `${d} 天 ${h} 小时`;
}

export function LeaderboardClient() {
  const { t } = useI18n();
  const [data, setData] = React.useState<StatsData | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  /*
   * 投票面板里能选的模型。
   *
   * ⚠️ 这里用**全量内置模型**，不做「没填 Key 就不显示」的过滤：
   * 榜单统计的是全站口径，投票口径跟着收窄会让「被投最多」失去可比性；
   * 而且没 Key 的人照样有资格评价某个模型难用。
   */
  const options = React.useMemo(
    () => CHAT_MODELS.map((m) => ({ id: m.id, label: m.label })),
    [],
  );

  const load = React.useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/stats", { signal: timeoutSignal(8_000) });
      const json = (await res.json().catch(() => ({}))) as StatsData & { error?: string };
      if (!res.ok || json.error) {
        setError(json.error ?? t("common.retryLater"));
        return;
      }
      setData(json);
    } catch {
      setError(t("common.retryLater"));
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function vote(modelId: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeoutSignal(8_000),
        body: JSON.stringify({ modelId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || json.error) {
        toast.error(json.error ?? t("common.retryLater"));
        return;
      }
      toast.success(t("leaderboard.voted"));
      await load();
    } catch {
      toast.error(t("common.retryLater"));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="text-sm text-muted-foreground">{error}</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">{t("leaderboard.title")}</h1>
        <p className="text-xs text-muted-foreground">
          {t("leaderboard.period")} {data.period} · {t("leaderboard.resetIn")} {fmtReset(data.msUntilReset)}
        </p>
      </header>

      {/* 本人奖励：只在获奖时出现，含转移码的 PDF 只有本人能下载 */}
      {data.myReward ? (
        <section className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
            <Award className="h-4 w-4" />
            {t("leaderboard.myReward")}
          </div>
          <p className="text-xs text-muted-foreground">
            {data.myReward.period} · {t("leaderboard.rewardCount")} {data.myReward.count}
          </p>
          <p className="font-mono text-sm">{data.myReward.domain}</p>
          {data.myReward.note ? (
            <p className="text-xs text-muted-foreground">{data.myReward.note}</p>
          ) : null}
          <Button asChild size="sm" variant="secondary">
            <a href="/api/reward?format=pdf" download>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {t("leaderboard.downloadPdf")}
            </a>
          </Button>
        </section>
      ) : null}

      {/* 聊天次数榜 */}
      <Board
        title={t("leaderboard.chatBoard")}
        icon={<Trophy className="h-4 w-4" />}
        rows={data.chat}
        empty={t("leaderboard.empty")}
        renderLabel={(r) => (
          <>
            {r.label ?? r.subject}
            {r.isAdmin ? (
              <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                {t("leaderboard.admin")}
              </span>
            ) : null}
          </>
        )}
      />

      {/* 模型调用次数榜 */}
      <Board
        title={t("leaderboard.modelBoard")}
        icon={<Trophy className="h-4 w-4" />}
        rows={data.model}
        empty={t("leaderboard.empty")}
        renderLabel={(r) => <span className="font-mono text-xs">{r.subject}</span>}
      />

      {/* 最垃圾模型：榜单 + 投票 */}
      <section className="space-y-3 rounded-xl border border-border/70 bg-card/40 px-4 py-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ThumbsDown className="h-4 w-4 text-muted-foreground" />
          {t("leaderboard.worstBoard")}
        </div>
        <p className="text-xs text-muted-foreground">{t("leaderboard.worstDesc")}</p>

        {data.worst.length > 0 ? (
          <ol className="space-y-1 text-sm">
            {data.worst.map((r, i) => (
              <li key={r.subject} className="flex items-center justify-between gap-3">
                <span className="truncate">
                  <span className="mr-2 text-xs text-muted-foreground">{i + 1}.</span>
                  <span className="font-mono text-xs">{r.subject}</span>
                </span>
                <span className="text-xs text-muted-foreground">{r.count}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">{t("leaderboard.empty")}</p>
        )}

        <div className="space-y-2 border-t border-border/60 pt-3">
          <p className="text-xs text-muted-foreground">
            {data.myWorstVote
              ? `${t("leaderboard.myVote")} ${data.myWorstVote}`
              : t("leaderboard.noVote")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {options.slice(0, 24).map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={busy}
                onClick={() => void vote(m.id)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                  data.myWorstVote === m.id
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border/70 text-muted-foreground hover:bg-muted"
                }`}
              >
                {m.id}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Board({
  title,
  icon,
  rows,
  empty,
  renderLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Row[];
  empty: string;
  renderLabel: (r: Row) => React.ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-border/70 bg-card/40 px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      {rows.length > 0 ? (
        <ol className="space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={r.subject} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center truncate">
                <span className="mr-2 w-5 shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
                <span className="truncate">{renderLabel(r)}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{r.count}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}
