/**
 * 竞技场的提示词构造。
 *
 * 指令一律用中文写（各模型对中文指令的理解都够），
 * 但明确要求模型**用「议题/玩家使用的语言」作答** ——
 * 否则英文议题会得到中文回复。
 */

import type { DebateStage, PlayerState, WerewolfRole, WerewolfStage } from "./types";

/** 让模型用指定语言输出 */
function langHint(lang: string): string {
  const table: Record<string, string> = {
    "zh-CN": "简体中文",
    "zh-TW": "繁體中文",
    en: "English",
    fr: "Français",
  };
  return `请全程使用${table[lang] ?? "简体中文"}作答。`;
}

/* ================================ 辩论 ================================ */

export function debateSystem(opts: {
  topic: string;
  stance: string;
  stage: DebateStage;
  lang: string;
  round?: number;
  totalRounds?: number;
}): string {
  const { topic, stance, stage, lang, round = 1, totalRounds = 1 } = opts;

  const base = [
    `你正在 Portchat 竞技场参加一场正式辩论。`,
    `辩题：${topic}`,
    `你的立场：${stance}`,
    langHint(lang),
    `要求：观点鲜明、给出具体理由或例证、直接回应对手的论点，不要复述规则。`,
    `篇幅控制在 150 字以内，口语化一点，像真的在辩，不要写成论文。`,
  ].join("\n");

  if (stage === "opening") {
    return `${base}\n现在是你第一次发言（立论），开门见山亮出你的核心主张。`;
  }
  if (stage === "rebuttal") {
    return `${base}\n现在是第 ${round}/${totalRounds} 轮交锋。针对前面其他辩手的发言进行反驳或补充，至少回应其中一个具体观点。`;
  }
  if (stage === "closing") {
    return `${base}\n现在是结辩。总结你的核心立场，回应全场争议，给出最后一句话定调。`;
  }
  return base;
}

export function judgeSystem(opts: { topic: string; lang: string }): string {
  return [
    `你是 Portchat 竞技场这场辩论的裁判，不参与发言。`,
    `辩题：${opts.topic}`,
    langHint(opts.lang),
    `请根据下方完整辩论记录裁决：`,
    `1. 哪一方论证更扎实（结合论据质量、逻辑、对反驳的回应）`,
    `2. 各自最有力的一点`,
    `3. 各自最薄弱的一点`,
    `最后用一行给出结论：「胜方：xxx」。不要和稀泥，必须选边。`,
  ].join("\n");
}

/** 辩论立场：正方 / 反方 / 第三方视角 */
export function stanceFor(index: number, total: number, lang: string): string {
  const zh = lang.startsWith("zh");
  if (total <= 2) {
    return index === 0
      ? zh ? "正方：支持该议题" : "PRO: support the motion"
      : zh ? "反方：反对该议题" : "CON: oppose the motion";
  }
  if (index === 0) return zh ? "正方：支持该议题" : "PRO: support the motion";
  if (index === 1) return zh ? "反方：反对该议题" : "CON: oppose the motion";
  return zh
    ? `第三方：不预设立场，指出双方盲区并提出自己的独立判断`
    : "INDEPENDENT: no preset stance — expose blind spots and give your own view";
}

/* =============================== 狼人杀 =============================== */

export const ROLE_NAMES: Record<WerewolfRole, Record<string, string>> = {
  werewolf: { "zh-CN": "狼人", "zh-TW": "狼人", en: "Werewolf", fr: "Loup-garou" },
  seer: { "zh-CN": "预言家", "zh-TW": "預言家", en: "Seer", fr: "Voyante" },
  witch: { "zh-CN": "女巫", "zh-TW": "女巫", en: "Witch", fr: "Sorcière" },
  hunter: { "zh-CN": "猎人", "zh-TW": "獵人", en: "Hunter", fr: "Chasseur" },
  idiot: { "zh-CN": "白神", "zh-TW": "白神", en: "White Knight", fr: "Chevalier blanc" },
  villager: { "zh-CN": "平民", "zh-TW": "平民", en: "Villager", fr: "Villageois" },
};

export function roleName(role: WerewolfRole, lang: string): string {
  return ROLE_NAMES[role][lang] ?? ROLE_NAMES[role]["zh-CN"];
}

/**
 * 狼人杀的系统提示词。
 *
 * 关键点：每个玩家只拿到**自己该知道的信息** ——
 * 狼人知道同伴、预言家只知道自己的查验结果、平民什么都不知道。
 * 如果把全部身份都塞进 prompt，模型会"作弊"，整个游戏就没意义了。
 */
export function werewolfSystem(opts: {
  me: PlayerState;
  players: PlayerState[];
  stage: WerewolfStage;
  lang: string;
  day: number;
  /** 狼人同伴座位号 */
  wolfMates?: number[];
  /** 预言家已查验的结果：seat → 阵营 */
  seen?: Record<number, string>;
  /** 女巫是否已用过解药 / 毒药 */
  witchUsed?: { heal: boolean; poison: boolean };
  /** 当晚被狼人袭击的座位（女巫判断是否救） */
  attacked?: number | null;
}): string {
  const { me, players, stage, lang, day } = opts;
  const L = (r: WerewolfRole) => roleName(r, lang);

  const head = [
    `你在玩一局 ${players.length} 人狼人杀，你是 ${me.name}（${L(me.role)}）。`,
    langHint(lang),
    `玩家编号：${players.map((p) => p.name).join("、")}。`,
  ];

  // ---- 身份私密信息 ----
  if (me.role === "werewolf") {
    const mates = (opts.wolfMates ?? []).filter((s) => s !== me.seat);
    head.push(
      mates.length
        ? `你的狼人同伴是：${mates.map((s) => `#${s}`).join("、")}。你们每晚共同决定袭击一人。`
        : `你是唯一的狼人，每晚独自决定袭击一人。`,
    );
    head.push(`白天你要隐藏身份，误导好人，把怀疑引向别人。`);
  } else if (me.role === "seer") {
    const seen = opts.seen ?? {};
    const lines = Object.entries(seen).map(
      ([s, camp]) => `第${Number(s) >= 0 ? "" : ""}晚你查验过 #${s}，结果是：${camp}`,
    );
    head.push(`你是预言家，每晚可查验一名存活玩家的阵营。`);
    if (lines.length) head.push(...lines);
    head.push(`白天你要在不暴露自己的前提下，引导好人找出狼人。`);
  } else if (me.role === "witch") {
    head.push(`你是女巫，有一瓶解药和一瓶毒药，各能用一次。`);
    head.push(
      `已用：解药${opts.witchUsed?.heal ? "（已用）" : "（可用）"}、毒药${
        opts.witchUsed?.poison ? "（已用）" : "（可用）"
      }。`,
    );
  } else if (me.role === "hunter") {
    head.push(
      me.shot
        ? `你是猎人，你的枪已经用过了。`
        : `你是猎人。你出局时可以开枪带走一名玩家（被女巫毒杀则不能开枪）。`,
    );
  } else if (me.role === "idiot") {
    head.push(
      me.revealed
        ? `你是白神，你已经翻牌了：不会被放逐出局，但从此不能再投票。`
        : `你是白神。若你在白天被投票放逐，你会翻牌并留在场上，但从此不能再投票（也不能再被投票放逐）。`,
    );
  } else {
    head.push(`你是平民，没有特殊能力，靠发言和投票找出狼人。`);
  }

  const alive = players.filter((p) => p.alive).map((p) => p.name);
  const dead = players.filter((p) => !p.alive).map((p) => p.name);
  if (dead.length) head.push(`已出局：${dead.join("、")}。当前存活：${alive.join("、")}。`);

  const tail: string[] = [];
  switch (stage) {
    case "night-wolf":
      tail.push(
        `【夜晚·狼人行动】现在是第 ${day} 晚。`,
        `先简短磋商（50 字内），然后在最后一行输出袭击目标，格式严格为：[[KILL:#座位号]]`,
      );
      break;
    case "night-seer":
      tail.push(
        `【夜晚·预言家查验】现在是第 ${day} 晚。`,
        `在最后一行输出你要查验的目标，格式严格为：[[CHECK:#座位号]]`,
        `只输出标记，不要解释。`,
      );
      break;
    case "night-witch":
      tail.push(
        `【夜晚·女巫行动】现在是第 ${day} 晚。`,
        opts.attacked != null
          ? `今晚狼人袭击了 #${opts.attacked}。`
          : `今晚无人被袭击。`,
        `你可以选择：救（[[HEAL]]）、毒杀某人（[[POISON:#座位号]]）、或什么都不做（[[PASS]]）。`,
        `在最后一行输出其中一个标记，格式严格。只输出标记，不要解释。`,
      );
      break;
    case "day-speech":
      // 发言与投票合并成一次调用：白天一轮内大家信息相同，
      // 再单独跑一轮投票只是把调用次数翻倍、把等待时间拉长。
      tail.push(
        `【白天·第 ${day} 天自由发言】`,
        `根据已知信息发表你的判断与怀疑，80 字以内。不要暴露你是预言家（如果你是）。`,
        `最后一行输出你要投出的一票，格式严格为：[[VOTE:#座位号]]`,
      );
      break;
    case "day-vote":
      tail.push(
        `【白天·投票放逐】`,
        `在最后一行输出你要投给谁，格式严格为：[[VOTE:#座位号]]`,
        `前面可以有一句简短理由（40 字内）。`,
      );
      break;
    case "hunter-shot":
      tail.push(
        `【猎人开枪】你出局了，现在可以开枪带走一名存活玩家。`,
        `在最后一行输出目标，格式严格为：[[SHOOT:#座位号]]`,
        `前面可以有一句简短理由（40 字内）。`,
      );
      break;
  }

  return [...head, ...tail].join("\n");
}

/**
 * 从狼人杀发言里解析结构化标记。
 *
 * 模型经常不老实：写成 `[[VOTE: #3]]`、`` `[[KILL:#2]]` ``、甚至把标记放在句子中间。
 * 所以这里宽容处理：忽略空格、忽略反引号、全文搜索而不只看最后一行。
 * 解析不出来由调用方随机兜底 —— 不能因为一个模型不守格式就让整局卡死。
 */
export function parseTag(
  text: string,
  kind: "KILL" | "CHECK" | "VOTE" | "HEAL" | "POISON" | "PASS" | "SHOOT",
): number | "PASS" | "HEAL" | null {
  const clean = text.replace(/`/g, "").replace(/\s+/g, "");
  const re = new RegExp(`\\[\\[${kind}(?::#?(\\d+))?\\]\\]`);
  const m = clean.match(re);
  if (!m) return null;
  if (kind === "PASS" || kind === "HEAL") return kind;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
