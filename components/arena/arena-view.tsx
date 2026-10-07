"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Play, Square, Swords, Users } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import {
  CHAT_MODELS,
  LS_KEYS,
  PROVIDERS,
  type CustomProviderConfig,
  type ProviderId,
} from "@/lib/config";
import { runDebate, runWerewolf } from "@/lib/arena/engine";
import type { ArenaLine, ArenaMode, PlayerState } from "@/lib/arena/types";

const PROVIDER_ORDER: ProviderId[] = ["agnes", "atriasi", "inkstone"];

/* ------------------------------ 本地存储读取 ------------------------------ */

interface Transport {
  keys: Record<string, string>;
  baseUrls: Record<string, string>;
  customProviders: CustomProviderConfig[];
  extraModels: Record<string, string[]>;
}

function readTransport(): Transport {
  const empty: Transport = {
    keys: {},
    baseUrls: {},
    customProviders: [],
    extraModels: {},
  };
  if (typeof window === "undefined") return empty;
  try {
    const keys = JSON.parse(localStorage.getItem(LS_KEYS.keys) || "{}");
    const baseUrls = JSON.parse(localStorage.getItem(LS_KEYS.baseUrls) || "{}");
    const customProviders = JSON.parse(
      localStorage.getItem(LS_KEYS.customProviders) || "[]",
    );
    let extraModels: Record<string, string[]> = {};
    const rawExtra = localStorage.getItem(LS_KEYS.extraModels);
    if (rawExtra) {
      try {
        const parsed = JSON.parse(rawExtra) as Record<string, unknown>;
        extraModels = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [
            k,
            Array.isArray(v)
              ? v.filter((x): x is string => typeof x === "string")
              : [],
          ]),
        );
      } catch {
        extraModels = {};
      }
    }
    return {
      keys: typeof keys === "object" && keys ? keys : {},
      baseUrls: typeof baseUrls === "object" && baseUrls ? baseUrls : {},
      customProviders: Array.isArray(customProviders) ? customProviders : [],
      extraModels,
    };
  } catch {
    return empty;
  }
}

/** 内置模型 + 内置供应商追加模型 + 自定义供应商的模型，拼成可选的扁平列表 */
function useModelOptions(
  customProviders: CustomProviderConfig[],
  extraModels: Record<string, string[]>,
  keys: Record<string, string>,
) {
  return React.useMemo(() => {
    const builtin = PROVIDER_ORDER.flatMap((pid) => {
      // 没填 Key 的内置供应商（且无站点内置 Key）整组不显示
      if (!PROVIDERS[pid].hasPreset && !(keys[pid] ?? "").trim()) return [];
      const own = CHAT_MODELS.filter((m) => m.provider === pid).map((m) => ({
        id: m.id,
        label: `${PROVIDERS[pid].label} · ${m.label}`,
      }));
      const extra = (extraModels[pid] ?? [])
        .filter((id) => !own.some((o) => o.id === id))
        .map((id) => ({ id, label: `${PROVIDERS[pid].label} · ${id}` }));
      return [...own, ...extra];
    });
    const custom = (customProviders ?? []).flatMap((c) =>
      (c.models ?? []).map((id) => ({ id, label: `${c.label} · ${id}` })),
    );
    return [...builtin, ...custom];
  }, [customProviders, extraModels, keys]);
}

/* -------------------------------- 主组件 -------------------------------- */

/**
 * 把座位用的模型尽量均匀地轮换分配，避免 12 个座位默认塞满同一个模型。
 * 已选过且仍然可用的模型会保留，只补齐缺的那几个。
 */
function spreadSeatModels(prev: string[], count: number, ids: string[]): string[] {
  if (!ids.length) return Array.from({ length: count }, () => "");
  const next = prev.filter((x) => ids.includes(x));
  for (let i = next.length; i < count; i++) {
    const used = ids.map((id) => next.filter((x) => x === id).length);
    const min = Math.min(...used);
    next.push(ids[used.indexOf(min)]);
  }
  return next.slice(0, count);
}

/** 狼人数量可选范围：至少 1 个，最多留够 3 个好人位，否则一开局好人就没得玩 */
function wolfOptions(seats: number): number[] {
  const max = Math.max(1, seats - 3);
  return Array.from({ length: max }, (_, i) => i + 1);
}

/**
 * 牌桌上的一个座位：圆形编号头像 + 模型名 + 身份。
 * 出局的会整体变暗并打叉。
 */
function SeatBadge({
  seat,
  label,
  roleText,
  dim,
}: {
  seat: number;
  label: string;
  roleText: string;
  dim: boolean;
}) {
  return (
    <div
      className={`flex w-20 flex-col items-center gap-1 ${dim ? "opacity-40" : ""}`}
    >
      <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted/40 text-sm font-semibold">
        {seat}
        {dim ? (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] leading-none text-white">
            ✕
          </span>
        ) : null}
      </div>
      <span className="w-full truncate text-center text-[11px] text-fg-secondary">
        {label}
      </span>
      <span className="text-[10px] text-fg-tertiary">{roleText}</span>
    </div>
  );
}

export function ArenaView() {
  const { t, locale } = useI18n();

  const [transport, setTransport] = React.useState<Transport>({
    keys: {},
    baseUrls: {},
    customProviders: [],
    extraModels: {},
  });
  const [mode, setMode] = React.useState<ArenaMode>("debate");

  // 辩论配置
  const [topic, setTopic] = React.useState("");
  const [debateModels, setDebateModels] = React.useState<string[]>([
    CHAT_MODELS[0]?.id ?? "",
    CHAT_MODELS[1]?.id ?? CHAT_MODELS[0]?.id ?? "",
  ]);
  const [rounds, setRounds] = React.useState(1);
  const [withJudge, setWithJudge] = React.useState(false);
  const [judgeModel, setJudgeModel] = React.useState<string>(
    CHAT_MODELS[0]?.id ?? "",
  );

  // 狼人杀配置
  const [seats, setSeats] = React.useState(12);
  const [wolves, setWolves] = React.useState(4);
  const [withWitch, setWithWitch] = React.useState(true);
  const [withHunter, setWithHunter] = React.useState(true);
  const [withIdiot, setWithIdiot] = React.useState(true);
  const [seatModels, setSeatModels] = React.useState<string[]>(() =>
    spreadSeatModels([], 12, CHAT_MODELS.map((m) => m.id)),
  );

  const [lines, setLines] = React.useState<ArenaLine[]>([]);
  const [players, setPlayers] = React.useState<PlayerState[]>([]);
  const [status, setStatus] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [err, setErr] = React.useState("");

  const abortRef = React.useRef<AbortController | null>(null);
  const outRef = React.useRef<HTMLDivElement>(null);

  const options = useModelOptions(
    transport.customProviders,
    transport.extraModels,
    transport.keys,
  );

  // 座位数调小后，原来选的狼人数可能超限，这里夹到合法范围再显示
  const wolvesClamped = Math.min(wolves, Math.max(1, seats - 3));

  React.useEffect(() => {
    setTransport(readTransport());
  }, []);

  React.useEffect(() => {
    const ids = options.map((o) => o.id);
    if (!ids.length) return;
    setSeatModels((prev) => spreadSeatModels(prev, seats, ids));
    // 依赖里刻意只放 ids.length：座位数变了、或可用模型数量变了才重排，
    // 避免因 options 每次渲染都是新数组而无限触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, options.length]);

  React.useEffect(() => {
    outRef.current?.scrollTo({
      top: outRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [lines.length]);

  const canStart = React.useMemo(() => {
    if (mode === "debate") {
      const ms = debateModels.filter(Boolean);
      return ms.length >= 2 && topic.trim().length > 0;
    }
    return seatModels.filter(Boolean).length === seats && seats >= 6 && seats <= 12;
  }, [mode, debateModels, topic, seatModels, seats]);

  async function start() {
    setErr("");
    setLines([]);
    setPlayers([]);
    setRunning(true);

    const ac = new AbortController();
    abortRef.current = ac;

    const hooks = {
      onLine: (line: ArenaLine) => setLines((prev) => [...prev, line]),
      onStatus: (s: string) => setStatus(s),
      onProgress: (_done: number, _total: number) => {},
    };

    try {
      if (mode === "debate") {
        const res = await runDebate(
          {
            mode: "debate",
            lang: locale,
            transport,
            topic: topic.trim(),
            models: debateModels.filter(Boolean),
            rounds,
            withJudge,
          },
          hooks,
          ac.signal,
        );
        setLines(res.lines);
      } else {
        const res = await runWerewolf(
          {
            mode: "werewolf",
            lang: locale,
            transport,
            seats,
            models: seatModels,
            wolves: Math.min(wolves, Math.max(1, seats - 3)),
            withWitch,
            withHunter,
            withIdiot,
            maxDays: 5,
          },
          hooks,
          ac.signal,
        );
        setLines(res.lines);
        setPlayers(res.players);
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
      setStatus("");
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  const modelLabel = (id: string) =>
    options.find((o) => o.id === id)?.label ?? id;

  // 牌桌数据：一选好座位就铺出来，跑完（players 有值）才揭晓身份
  const board: { seat: number; model: string; role: string; alive: boolean }[] =
    players.length
      ? players
      : seatModels.map((m, i) => ({
          seat: i + 1,
          model: m,
          role: "",
          alive: true,
        }));
  const revealed = players.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* 返回聊天：竞技场是独立页面，没有侧边栏可点，必须给一个出口 */}
      <Link
        href="/chat"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("auth.backToChat")}
      </Link>

      <header className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Swords className="h-5 w-5" />
          {t("arena.title")}
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">{t("arena.subtitle")}</p>
        <p className="mt-1 text-xs text-fg-quaternary">{t("arena.hint")}</p>
      </header>

      {/* 模式切换 */}
      <div className="mb-5 flex gap-2">
        {(["debate", "werewolf"] as ArenaMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={running}
            className={`rounded-full px-4 py-1.5 text-sm transition ${
              mode === m
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-fg-secondary hover:bg-muted/60"
            }`}
          >
            {t(m === "debate" ? "arena.mode.debate" : "arena.mode.werewolf")}
          </button>
        ))}
      </div>

      {/* -------- 配置区 -------- */}
      <section className="rounded-xl border border-border bg-muted/30 p-4">
        {mode === "debate" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("arena.topic")}
              </label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={t("arena.topicPlaceholder")}
                disabled={running}
                className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("arena.participants")}
              </label>
              <div className="space-y-2">
                {debateModels.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={m}
                      onChange={(e) =>
                        setDebateModels((prev) =>
                          prev.map((x, j) => (j === i ? e.target.value : x)),
                        )
                      }
                      disabled={running}
                      className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none"
                    >
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {debateModels.length > 2 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDebateModels((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        disabled={running}
                      >
                        {t("arena.remove")}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              {debateModels.length < 4 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    setDebateModels((prev) => [
                      ...prev,
                      options.find((o) => !prev.includes(o.id))?.id ?? prev[0],
                    ])
                  }
                  disabled={running}
                >
                  + {t("arena.addModel")}
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                {t("arena.rounds")}
                <select
                  value={rounds}
                  onChange={(e) => setRounds(Number(e.target.value))}
                  disabled={running}
                  className="rounded-lg border border-border bg-transparent px-2 py-1"
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withJudge}
                  onChange={(e) => setWithJudge(e.target.checked)}
                  disabled={running}
                />
                {t("arena.withJudge")}
              </label>

              {withJudge ? (
                <label className="flex items-center gap-2">
                  {t("arena.judgeModel")}
                  <select
                    value={judgeModel}
                    onChange={(e) => setJudgeModel(e.target.value)}
                    disabled={running}
                    className="rounded-lg border border-border bg-transparent px-2 py-1"
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                {t("arena.seats")}
                <select
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  disabled={running}
                  className="rounded-lg border border-border bg-transparent px-2 py-1"
                >
                  {[6, 7, 8, 9, 10, 11, 12].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                {t("arena.wolves")}
                <select
                  value={wolvesClamped}
                  onChange={(e) => setWolves(Number(e.target.value))}
                  disabled={running}
                  className="rounded-lg border border-border bg-transparent px-2 py-1"
                >
                  {wolfOptions(seats).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withWitch}
                  onChange={(e) => setWithWitch(e.target.checked)}
                  disabled={running}
                />
                {t("arena.withWitch")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withHunter}
                  onChange={(e) => setWithHunter(e.target.checked)}
                  disabled={running}
                />
                {t("arena.withHunter")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={withIdiot}
                  onChange={(e) => setWithIdiot(e.target.checked)}
                  disabled={running}
                />
                {t("arena.withIdiot")}
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {seatModels.map((m, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-10 shrink-0 text-fg-tertiary">
                    {t("arena.seat", { n: i + 1 })}
                  </span>
                  <select
                    value={m}
                    onChange={(e) =>
                      setSeatModels((prev) =>
                        prev.map((x, j) => (j === i ? e.target.value : x)),
                      )
                    }
                    disabled={running}
                    className="flex-1 rounded-lg border border-border bg-transparent px-2 py-1.5"
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          {running ? (
            <Button onClick={stop} variant="secondary">
              <Square className="mr-1.5 h-4 w-4" />
              {t("arena.stop")}
            </Button>
          ) : (
            <Button onClick={start} disabled={!canStart}>
              <Play className="mr-1.5 h-4 w-4" />
              {t("arena.start")}
            </Button>
          )}
          <span className="flex items-center gap-1.5 text-xs text-fg-tertiary">
            <Users className="h-3.5 w-3.5" />
            {t("arena.auto")}
          </span>
          {status ? (
            <span className="text-xs text-fg-tertiary">{t(status)}</span>
          ) : null}
        </div>

        {!canStart && !running ? (
          <p className="mt-2 text-xs text-fg-quaternary">
            {mode === "debate" ? t("arena.noModel") : null}
          </p>
        ) : null}
      </section>

      {err ? (
        <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {err}
        </p>
      ) : null}

      {/* -------- 狼人杀牌桌 -------- */}
      {mode === "werewolf" && board.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-red-500/25 bg-gradient-to-b from-red-950/30 via-muted/10 to-transparent p-5">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-center">
            <div className="grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-2">
              {board.slice(0, Math.ceil(board.length / 2)).map((p) => (
                <SeatBadge
                  key={p.seat}
                  seat={p.seat}
                  label={modelLabel(p.model)}
                  roleText={revealed ? t(`arena.role.${p.role}`) : "?"}
                  dim={revealed && !p.alive}
                />
              ))}
            </div>

            {/* 中央发光核心：两个菱形叠成八面体感，外圈光晕负责"发光" */}
            <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-red-500/25 blur-2xl" />
              <div className="h-20 w-20 animate-pulse rotate-45 rounded-2xl border border-red-400/60 bg-gradient-to-br from-red-500/80 via-red-600/40 to-red-900/60 shadow-[0_0_50px_rgba(239,68,68,0.55)]" />
              <div className="absolute h-20 w-20 -rotate-45 rounded-2xl border border-red-300/30" />
            </div>

            <div className="grid grid-cols-3 gap-x-4 gap-y-4 sm:grid-cols-2">
              {board.slice(Math.ceil(board.length / 2)).map((p) => (
                <SeatBadge
                  key={p.seat}
                  seat={p.seat}
                  label={modelLabel(p.model)}
                  roleText={revealed ? t(`arena.role.${p.role}`) : "?"}
                  dim={revealed && !p.alive}
                />
              ))}
            </div>
          </div>

          <p className="mt-5 text-center text-sm font-medium text-amber-400">
            {t("arena.tableSlogan", { n: board.length })}
          </p>
        </section>
      ) : null}

      {/* -------- 输出区 -------- */}
      <section
        ref={outRef}
        className="mt-6 max-h-[60vh] space-y-3 overflow-y-auto pr-1"
      >
        {lines.length === 0 ? (
          <p className="py-10 text-center text-sm text-fg-quaternary">
            {t("arena.empty")}
          </p>
        ) : (
          lines.map((l, i) => (
            <article
              key={i}
              className="rounded-xl border border-border/60 bg-muted/20 p-3"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-fg-tertiary">
                <span className="font-medium text-fg-secondary">
                  {l.speaker}
                </span>
                <span className="rounded bg-muted/40 px-1.5 py-0.5">
                  {t(`arena.stage.${l.stage}`)}
                </span>
                {l.ms ? <span>{l.ms}ms</span> : null}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {l.error
                  ? l.error
                  : l.stage === "result"
                    ? t(l.text)
                    : l.text}
              </p>
            </article>
          ))
        )}
      </section>

      {/* -------- 狼人杀结束后揭身份 -------- */}
      {players.length > 0 && !running ? (
        <section className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
          <h2 className="mb-3 text-sm font-medium">
            {t("arena.stage.result")}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {players.map((p) => (
              <div
                key={p.seat}
                className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <span>
                  {t("arena.seat", { n: p.seat })} · {modelLabel(p.model)}
                </span>
                <span className="text-xs text-fg-tertiary">
                  {t(`arena.role.${p.role}`)} ·{" "}
                  {p.alive ? t("arena.alive") : t("arena.dead")}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
