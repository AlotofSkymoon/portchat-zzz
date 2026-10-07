/**
 * 竞技场（Arena）数据模型。
 *
 * 设计取向：**服务端只做「单次模型调用」，剧本编排全部在前端**。
 *
 * 为什么不把整局放在一个服务端请求里跑完：
 *   · Vercel / Workers 都有执行时长上限，一局狼人杀几十次调用必然超时
 *   · 一个请求跑完 = 用户全程盯着转圈，看不到任何进展
 *   · 前端编排可以随时中断，服务端编排中断了就是半个死请求
 * 代价是前端复杂一点，但换来「不超时 + 有进度 + 可中断」。
 */

/** 两种玩法 */
export type ArenaMode = "debate" | "werewolf";

/**
 * 调用模型所需的用户侧配置。
 * 实际类型定义在 engine.ts（含 fetch 逻辑），这里只声明形状，
 * 避免 types.ts 反向依赖 engine.ts 造成循环引用。
 */
export interface ArenaTransport {
  keys: Record<string, string>;
  baseUrls: Record<string, string>;
  customProviders: unknown[];
}

/* --------------------------------- 辩论 --------------------------------- */

export interface DebateConfig {
  mode: "debate";
  /** 界面语言，决定指令里要求模型用哪种语言作答 */
  lang: string;
  /** 发起调用所需的用户配置（Key / 服务地址 / 自定义供应商） */
  transport: ArenaTransport;
  /** 辩题 */
  topic: string;
  /** 参与模型 id（2~4 个） */
  models: string[];
  /** 交锋回合数（1~3），不含立论与结辩 */
  rounds: number;
  /**
   * 是否让裁判做总结裁决。
   * 裁判不参与发言，只在最后读全部记录给判定。
   */
  withJudge: boolean;
  /**
   * 裁判用的模型 id。
   * 没指定时引擎会回落到第一个模型。
   */
  judgeModel?: string;
}

/** 辩论的一个阶段 */
export type DebateStage = "opening" | "rebuttal" | "closing" | "verdict";

/* -------------------------------- 狼人杀 -------------------------------- */

/** 狼人杀身份 */
export type WerewolfRole =
  | "werewolf"
  | "seer"
  | "witch"
  | "hunter"
  | "idiot"
  | "villager";

export interface WerewolfConfig {
  mode: "werewolf";
  lang: string;
  transport: ArenaTransport;
  /** 座位数（6~12） */
  seats: number;
  /** 每个座位用的模型 id，长度 = seats */
  models: string[];
  /** 狼人数量（默认 2） */
  wolves: number;
  /** 是否含女巫 */
  withWitch: boolean;
  /** 是否含猎人（死亡时可开枪带走一人） */
  withHunter: boolean;
  /** 是否含白神（被投票放逐时翻牌免死，但从此不能投票） */
  withIdiot: boolean;
  /** 最大天数，到顶判定平局/狼人赢，防死循环 */
  maxDays: number;
}

/** 狼人杀的一个阶段 */
export type WerewolfStage =
  | "night-wolf"
  | "night-seer"
  | "night-witch"
  | "day-speech"
  | "day-vote"
  | "hunter-shot"
  | "settle"
  | "result";

/** 一名玩家的公开状态 */
export interface PlayerState {
  seat: number;
  model: string;
  role: WerewolfRole;
  alive: boolean;
  /** 存活玩家在白天看到的名字（就是座位号，跨语言通用） */
  name: string;
  /** 白神是否已翻牌：翻牌后免死，但失去投票权 */
  revealed?: boolean;
  /** 猎人是否已开过枪 */
  shot?: boolean;
}

/* -------------------------------- 通用 -------------------------------- */

/** 一条发言记录 */
export interface ArenaLine {
  /** 发言者展示名（辩论=模型名，狼人杀=`#座位 · 模型名`） */
  speaker: string;
  /** 模型 id，用于取头像/颜色 */
  model: string;
  /** 阶段标签，UI 分组用 */
  stage: string;
  /** 正文 */
  text: string;
  /** 该次调用的实际耗时（毫秒），用于展示与排查慢模型 */
  ms?: number;
  /** 调用失败时的错误说明（正文为空时展示） */
  error?: string;
}

/** 前端引擎每一步要提交给服务端的请求 */
export interface TurnRequest {
  model: string;
  system: string;
  user: string;
  /** 单次输出上限，控制成本 */
  maxTokens?: number;
}
