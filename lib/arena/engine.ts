/**
 * 竞技场编排引擎（跑在浏览器里）。
 *
 * 为什么编排放前端：
 * 一局狼人杀要几十次模型调用，服务端一次请求跑完必然撞上
 * Vercel / Workers 的执行时长上限（本项目 maxDuration 只有 60s）。
 * 放在前端则天然可中断、有实时进度，还能随时点停。
 * 服务端因此只需要提供「单步调用」这个无状态能力。
 */

import type {
  ArenaLine,
  ArenaTransport,
  DebateConfig,
  PlayerState,
  WerewolfConfig,
  WerewolfRole,
  WerewolfStage,
} from "./types";
import { debateSystem, judgeSystem, parseTag, roleName, stanceFor, werewolfSystem } from "./prompts";

export interface ArenaHooks {
  onLine?: (line: ArenaLine) => void;
  onStatus?: (text: string) => void;
  /** 已完成 / 总步数，用于进度条 */
  onProgress?: (done: number, total: number) => void;
}

/** 并发上限：太高容易把上游和自家限流一起打满 */
const POOL = 3;

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new AbortedError();
}

/* ============================ 基础工具 ============================ */

/** 并发池：并发跑但保证结果顺序与输入一致 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      check(signal);
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function callTurn(
  opts: {
    model: string;
    system: string;
    user: string;
    maxTokens?: number;
    transport: ArenaTransport;
    signal?: AbortSignal;
  },
): Promise<{ text: string; ms: number }> {
  const r = await fetch("/api/arena/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      system: opts.system,
      user: opts.user,
      maxTokens: opts.maxTokens ?? 500,
      keys: opts.transport.keys,
      baseUrls: opts.transport.baseUrls,
      customProviders: opts.transport.customProviders,
    }),
    signal: opts.signal,
  });

  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = (await r.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* 忽略 */
    }
    throw new Error(msg);
  }
  const j = (await r.json()) as { text?: string; ms?: number };
  return { text: j.text ?? "", ms: j.ms ?? 0 };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 取票数最多的座位；平票随机。
 * 目标不合法（已死 / 越界）的票直接丢弃。
 */
function majority(votes: number[], valid: (n: number) => boolean): number | null {
  const pool = votes.filter(valid);
  if (!pool.length) return null;
  const count = new Map<number, number>();
  for (const v of pool) count.set(v, (count.get(v) ?? 0) + 1);
  let best = 0;
  let top: number[] = [];
  count.forEach((n, seat) => {
    if (n > best) {
      best = n;
      top = [seat];
    } else if (n === best) top.push(seat);
  });
  return top[Math.floor(Math.random() * top.length)];
}

/* ============================== 辩论 ============================== */

function formatDebate(lines: ArenaLine[], names: Map<string, string>): string {
  return lines
    .filter((l) => !l.error)
    .map((l) => `【${names.get(l.model) ?? l.model}】${l.text}`)
    .join("\n\n");
}

export interface ArenaResult {
  lines: ArenaLine[];
  /** 狼人杀的身份表（辩论模式为空数组） */
  players: PlayerState[];
}

export async function runDebate(
  cfg: DebateConfig,
  hooks: ArenaHooks,
  signal?: AbortSignal,
): Promise<ArenaResult> {
  const names = new Map(cfg.models.map((m) => [m, m]));
  const lines: ArenaLine[] = [];

  // 总步数：开场 + 交锋×轮数 + 结辩 + 裁判
  const total = cfg.models.length * (2 + cfg.rounds) + (cfg.withJudge ? 1 : 0);
  let done = 0;

  const emit = (l: ArenaLine) => {
    lines.push(l);
    hooks.onLine?.(l);
    hooks.onProgress?.(++done, total);
  };

  const speak = async (model: string, stage: "opening" | "rebuttal" | "closing", round: number) => {
    const idx = cfg.models.indexOf(model);
    const sys = debateSystem({
      topic: cfg.topic,
      stance: stanceFor(idx, cfg.models.length, cfg.lang),
      stage,
      lang: cfg.lang,
      round,
      totalRounds: cfg.rounds,
    });
    const prior = formatDebate(lines, names);
    const user = prior
      ? `辩题：${cfg.topic}\n\n以下是目前的发言记录：\n\n${prior}\n\n现在轮到你（${stage === "opening" ? "立论" : stage === "rebuttal" ? `第${round}轮交锋` : "结辩"}）。请只输出你的发言本身，不要带前缀。`
      : `辩题：${cfg.topic}\n\n你第一个发言（立论）。请只输出你的发言本身，不要带前缀。`;

    try {
      const { text, ms } = await callTurn({
        model,
        system: sys,
        user,
        maxTokens: stage === "opening" ? 400 : 350,
        transport: cfg.transport,
        signal,
      });
      emit({ speaker: model, model, stage, text, ms });
    } catch (e) {
      if ((e as Error)?.name === "AbortedError") throw e;
      emit({
        speaker: model,
        model,
        stage,
        text: "",
        ms: 0,
        error: (e as Error)?.message ?? "failed",
      });
    }
  };

  hooks.onStatus?.("arena.status.opening");
  await mapPool(cfg.models, POOL, (m) => speak(m, "opening", 1), signal);

  for (let r = 1; r <= cfg.rounds; r++) {
    check(signal);
    hooks.onStatus?.("arena.status.rebuttal");
    /**
     * 同一轮内并发：所有人基于「本轮开始前」的记录发言。
     * 若串行，后发言的人能看到前面人的话，既不公平也让等待时间翻倍。
     */
    const snapshot = [...lines];
    const saved = lines.length;
    await mapPool(
      cfg.models,
      POOL,
      async (m) => {
        const idx = cfg.models.indexOf(m);
        const sys = debateSystem({
          topic: cfg.topic,
          stance: stanceFor(idx, cfg.models.length, cfg.lang),
          stage: "rebuttal",
          lang: cfg.lang,
          round: r,
          totalRounds: cfg.rounds,
        });
        const prior = formatDebate(snapshot, names);
        try {
          const { text, ms } = await callTurn({
            model: m,
            system: sys,
            user: `辩题：${cfg.topic}\n\n当前发言记录：\n\n${prior}\n\n现在轮到你（第${r}轮交锋）。只输出你的发言本身。`,
            maxTokens: 350,
            transport: cfg.transport,
            signal,
          });
          return { line: { speaker: m, model: m, stage: "rebuttal" as const, text, ms } };
        } catch (e) {
          if ((e as Error)?.name === "AbortedError") throw e;
          return {
            line: {
              speaker: m,
              model: m,
              stage: "rebuttal" as const,
              text: "",
              ms: 0,
              error: (e as Error)?.message ?? "failed",
            },
          };
        }
      },
      signal,
    ).then((rs) => {
      // 池内顺序已完成，统一按原顺序落盘，展示更稳定
      void saved;
      rs.forEach((x) => emit(x.line));
    });
  }

  check(signal);
  hooks.onStatus?.("arena.status.closing");
  await mapPool(cfg.models, POOL, (m) => speak(m, "closing", cfg.rounds), signal);

  if (cfg.withJudge) {
    check(signal);
    hooks.onStatus?.("arena.status.verdict");
    const judge = cfg.judgeModel || cfg.models[0];
    try {
      const { text, ms } = await callTurn({
        model: judge,
        system: judgeSystem({ topic: cfg.topic, lang: cfg.lang }),
        user: `完整辩论记录：\n\n${formatDebate(lines, names)}\n\n请给出裁决。`,
        maxTokens: 700,
        transport: cfg.transport,
        signal,
      });
      emit({ speaker: "judge", model: judge, stage: "verdict", text, ms });
    } catch (e) {
      if ((e as Error)?.name === "AbortedError") throw e;
      emit({
        speaker: "judge",
        model: judge,
        stage: "verdict",
        text: "",
        ms: 0,
        error: (e as Error)?.message ?? "failed",
      });
    }
  }

  return { lines, players: [] };
}

/* ============================= 狼人杀 ============================= */

function dealRoles(seats: number, wolves: number, withWitch: boolean): WerewolfRole[] {
  const roles: WerewolfRole[] = [];
  for (let i = 0; i < wolves; i++) roles.push("werewolf");
  roles.push("seer");
  if (withWitch) roles.push("witch");
  while (roles.length < seats) roles.push("villager");
  return shuffle(roles);
}

function campOf(role: WerewolfRole): string {
  return role === "werewolf" ? "狼人" : "好人";
}

export async function runWerewolf(
  cfg: WerewolfConfig,
  hooks: ArenaHooks,
  signal?: AbortSignal,
): Promise<ArenaResult> {
  const lang = cfg.lang;
  const roles = dealRoles(cfg.seats, cfg.wolves, cfg.withWitch);

  const players: PlayerState[] = roles.map((role, i) => ({
    seat: i + 1,
    model: cfg.models[i % cfg.models.length],
    role,
    alive: true,
    name: `#${i + 1}`,
  }));

  const lines: ArenaLine[] = [];
  /** 公开记录：所有人可见的发言与事件 */
  const publicLog: string[] = [];
  const seen: Record<number, string> = {};
  const witchUsed = { heal: false, poison: false };

  const total = cfg.seats * cfg.maxDays + cfg.maxDays * 4;
  let done = 0;

  const emit = (l: ArenaLine) => {
    lines.push(l);
    hooks.onLine?.(l);
    hooks.onProgress?.(++done, total);
  };

  const alivePlayers = () => players.filter((p) => p.alive);
  const bySeat = (n: number) => players.find((p) => p.seat === n);
  const validTarget = (n: number | null): boolean =>
    typeof n === "number" && !!bySeat(n)?.alive;

  const say = async (
    p: PlayerState,
    stage: ArenaLine["stage"],
    user: string,
    sysExtra: Partial<Parameters<typeof werewolfSystem>[0]> = {},
    maxTokens = 300,
  ): Promise<ArenaLine> => {
    const sys = werewolfSystem({
      me: p,
      players,
      stage: stage as WerewolfStage,
      lang,
      day: 0,
      wolfMates: players.filter((x) => x.role === "werewolf").map((x) => x.seat),
      seen: p.role === "seer" ? seen : undefined,
      witchUsed: p.role === "witch" ? witchUsed : undefined,
      ...sysExtra,
    });
    try {
      const { text, ms } = await callTurn({
        model: p.model,
        system: sys,
        user,
        maxTokens,
        transport: cfg.transport,
        signal,
      });
      return { speaker: p.name, model: p.model, stage, text, ms };
    } catch (e) {
      if ((e as Error)?.name === "AbortedError") throw e;
      return {
        speaker: p.name,
        model: p.model,
        stage,
        text: "",
        ms: 0,
        error: (e as Error)?.message ?? "failed",
      };
    }
  };

  const contextFor = (p: PlayerState) =>
    publicLog.length ? `公开信息：\n${publicLog.join("\n")}` : `游戏刚刚开始，还没有任何公开信息。`;

  let winner: "good" | "wolf" | null = null;

  for (let day = 1; day <= cfg.maxDays; day++) {
    check(signal);

    /* ---------------- 夜晚 ---------------- */
    hooks.onStatus?.("arena.status.night");

    // 1) 狼人行动
    const wolves = alivePlayers().filter((p) => p.role === "werewolf");
    let attacked: number | null = null;
    if (wolves.length) {
      const wl = await mapPool(
        wolves,
        POOL,
        (w) =>
          say(
            w,
            "night-wolf",
            `${contextFor(w)}\n\n你是狼人，与同伴磋商后决定今晚袭击谁。先说一句（50字内），最后一行输出 [[KILL:#座位号]]。`,
            { day },
            200,
          ),
        signal,
      );
      wl.forEach((l) => emit(l));
      // 夜里的话不进公开记录 —— 否则平民就知道狼人聊了什么
      const votes = wl.map((l) => parseTag(l.text, "KILL")).filter((v): v is number => typeof v === "number");
      attacked = majority(votes, validTarget) ?? randomAlive(wolves.map((w) => w.seat));
    }

    check(signal);
    // 2) 预言家查验
    const seer = alivePlayers().find((p) => p.role === "seer");
    if (seer) {
      const l = await say(
        seer,
        "night-seer",
        `${contextFor(seer)}\n\n选择今晚要查验的存活玩家，只输出 [[CHECK:#座位号]]。`,
        { day },
        80,
      );
      emit(l);
      let target = parseTag(l.text, "CHECK");
      if (typeof target !== "number" || !validTarget(target)) target = randomAlive([seer.seat]);
      if (typeof target === "number" && validTarget(target)) {
        seen[target] = campOf(bySeat(target)!.role);
      }
    }

    check(signal);
    // 3) 女巫
    const witch = alivePlayers().find((p) => p.role === "witch");
    if (witch) {
      const l = await say(
        witch,
        "night-witch",
        `${contextFor(witch)}\n\n今晚狼人袭击了 ${attacked != null ? `#${attacked}` : "无人"}。选择 [[HEAL]] / [[POISON:#座位号]] / [[PASS]]，只输出标记。`,
        { day, attacked },
        80,
      );
      emit(l);
      const heal = parseTag(l.text, "HEAL");
      const poison = parseTag(l.text, "POISON");
      if (heal === "HEAL" && !witchUsed.heal && attacked != null) {
        witchUsed.heal = true;
        attacked = null; // 救活
      } else if (typeof poison === "number" && !witchUsed.poison && validTarget(poison)) {
        witchUsed.poison = true;
        kill(poison);
      }
    }

    // 结算夜晚死亡
    if (attacked != null) kill(attacked);

    /* ---------------- 白天 ---------------- */
    check(signal);
    if (checkWin()) break;

    hooks.onStatus?.("arena.status.day");
    publicLog.push(`—— 第 ${day} 天白天 ——`);

    const speakers = alivePlayers();
    const sl = await mapPool(
      speakers,
      POOL,
      (p) =>
        say(
          p,
          "day-speech",
          `${contextFor(p)}\n\n${
            p.role === "seer" && Object.keys(seen).length
              ? `（你查验过：${Object.entries(seen)
                  .map(([s, c]) => `#${s}=${c}`)
                  .join("、")}）`
              : ""
          }发表你的判断（80字内），最后一行输出 [[VOTE:#座位号]]。`,
          { day },
          260,
        ),
      signal,
    );
    sl.forEach((l) => {
      emit(l);
      if (!l.error) publicLog.push(`${l.speaker}：${stripTag(l.text)}`);
    });

    check(signal);
    // 投票：从发言里取标记，取不到就随机
    const votes = sl.map((l, i) => {
      const v = parseTag(l.text, "VOTE");
      return typeof v === "number" ? v : randomAlive([speakers[i]?.seat ?? 0]);
    });
    const voted = majority(votes, validTarget);
    if (voted != null) {
      kill(voted);
      publicLog.push(`#${voted} 被投票放逐。`);
    } else {
      publicLog.push(`本轮无人出局。`);
    }

    if (checkWin()) break;
  }

  if (!winner) winner = alivePlayers().some((p) => p.role === "werewolf") ? "wolf" : "good";

  emit({
    speaker: "system",
    model: "-",
    stage: "result",
    text: winner === "good" ? "arena.result.good" : "arena.result.wolf",
    ms: 0,
  });

  return { lines, players };

  /* ---- 内部工具 ---- */
  function kill(seat: number) {
    const p = bySeat(seat);
    if (!p || !p.alive) return;
    p.alive = false;
  }

  function randomAlive(exclude: number[]): number {
    const pool = alivePlayers().filter((p) => !exclude.includes(p.seat)).map((p) => p.seat);
    if (!pool.length) return 1;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function checkWin(): boolean {
    const alive = alivePlayers();
    const wolves = alive.filter((p) => p.role === "werewolf").length;
    const good = alive.length - wolves;
    if (wolves === 0) {
      winner = "good";
      return true;
    }
    if (wolves >= good) {
      winner = "wolf";
      return true;
    }
    return false;
  }
}

/** 展示时去掉行尾的结构化标记，别让用户看到 [[VOTE:#3]] 这种东西 */
export function stripTag(text: string): string {
  return text
    .replace(/\[\[(KILL|CHECK|VOTE|POISON)(?::\s*#?\d+)?\]\]/gi, "")
    .replace(/\[\[(HEAL|PASS)\]\]/gi, "")
    .replace(/`+/g, "")
    .trim();
}

export { AbortedError, roleName };
