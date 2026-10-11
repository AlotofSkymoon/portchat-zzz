/** 支持的模型服务商 */
export type ProviderId = "agnes" | "deepseek" | "inkstone" | "atriasi" | "gateway";

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  /** 默认 API Base URL（OpenAI 兼容） */
  baseUrl: string;
  /** 站点是否内置了该服务商的 Key（Agnes 有，DeepSeek 没有，需用户自备） */
  hasPreset: boolean;
  /** 申请 Key 的地址 */
  keyUrl: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  agnes: {
    id: "agnes",
    // 面向用户的显示名。provider id 仍是 agnes（上游服务商标识，改了会打错地址），
    // 但界面上统一叫 Pot —— 访客不需要知道背后接的是哪家。
    label: "Pot",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    // 文生图走独立的 images 端点，不是 chat/completions
    hasPreset: true,
    keyUrl: "https://platform.agnes-ai.com/",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    hasPreset: false,
    keyUrl: "https://platform.deepseek.com/api_keys",
  },
  inkstone: {
    id: "inkstone",
    /**
     * 上海 AI 实验室「书生·端砚」科研模型平台。
     *
     * base URL 结尾必须带 /v1 —— 这是 OpenAI 兼容协议的入口。
     * 平台另有 Anthropic 协议入口 https://discovery-api.intern-ai.org.cn（不带 /v1），
     * 本项目走 OpenAI 兼容协议，所以这里用带 /v1 的那个。
     */
    label: "书生·端砚",
    baseUrl: "https://discovery-api.intern-ai.org.cn/v1",
    hasPreset: false,
    keyUrl: "https://discovery.intern-ai.org.cn/",
  },
  atriasi: {
    id: "atriasi",
    /**
     * 上海 AI 实验室「书生·浦语」通用模型 API。
     *
     * ⚠️ 与「书生·端砚」（inkstone）是两个不同的平台，别合并：
     * - 端砚：科研模型平台 discovery-api.intern-ai.org.cn
     * - 浦语：通用模型平台 api.atria-asi.ai
     * 两者的 Key 不通用，模型列表也不一样。
     */
    label: "书生·浦语",
    baseUrl: "https://api.atria-asi.ai/v1",
    hasPreset: false,
    keyUrl: "https://atria-asi.ai/",
  },
  gateway: {
    id: "gateway",
    /**
     * Vercel AI Gateway —— 统一路由多家模型厂商的 OpenAI 兼容网关。
     *
     * ⚠️ Vercel 不自建/托管模型权重，Gateway 只做「路由 + 计费 + 可观测」，
     * 实际推理仍在 Anthropic / OpenAI / Google 等上游。所以这里不是"部署模型"。
     *
     * - 端点：https://ai-gateway.vercel.sh/v1（OpenAI 兼容）
     * - Key：Vercel 项目里的 AI_GATEWAY_API_KEY（免费档每月 $5 额度，零加价）
     * - 模型名格式：`provider/model`，如 anthropic/claude-sonnet-4.5
     * - 支持 GET /v1/models，所以设置里可以「探测新模型」拉到完整列表
     *
     * 没填 Key 时整组不显示（跟其他内置供应商一致）。
     */
    label: "Vercel AI Gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    hasPreset: false,
    keyUrl: "https://vercel.com/docs/ai-gateway",
  },
};

export interface ModelOption {
  id: string;
  label: string;
  desc: string;
  provider: ProviderId;
  /** 是否支持图片输入（vision-language） */
  vision: boolean;
  /**
   * 是否支持「思考模式」（输出链式推理过程）。
   * Agnes 通过扩展字段 chat_template_kwargs.enable_thinking 开启；
   * deepseek-reasoner 是原生推理模型，始终思考、无需开关。
   */
  thinking?: boolean;
  /** 原生推理模型：思考不可关闭（如 deepseek-reasoner） */
  alwaysThinking?: boolean;
}

/** 可选模型（纯聊天，不含 Agent / 工具调用） */
export const CHAT_MODELS: ModelOption[] = [
  /**
   * Vercel AI Gateway（provider/model 命名）。
   * 这里只列几个常用的；完整列表请在设置里用「探测新模型」拉取
   * （Gateway 支持 GET /v1/models）。
   */
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    desc: "Vercel AI Gateway",
    provider: "gateway" as ProviderId,
    vision: true,
    thinking: true,
  },
  {
    id: "openai/gpt-5",
    label: "GPT-5",
    desc: "Vercel AI Gateway",
    provider: "gateway" as ProviderId,
    vision: true,
    thinking: true,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    desc: "Vercel AI Gateway",
    provider: "gateway" as ProviderId,
    vision: true,
    thinking: true,
  },
  {
    id: "deepseek/deepseek-v3",
    label: "DeepSeek V3",
    desc: "Vercel AI Gateway",
    provider: "gateway" as ProviderId,
    vision: false,
    thinking: true,
  },
  {
    // 2026-09 上线的次世代模型：512K 上下文、65.5K 输出、支持图像 URL 输入，
    // 官方主打 Agent 执行链路（工具编排、长任务上下文、可信交付），当前全免费。
    // 纯聊天同样可用，故设为默认。
    id: "agnes-3.0-flash",
    // 显示名直接用模型代号：熟悉模型的人一眼知道在用哪个，
    // 不熟悉的照着代号去搜也有据可查。
    label: "agnes-3.0-flash",
    desc: "最强档 · 支持识图与思考",
    provider: "agnes",
    vision: true,
    thinking: true,
  },
  {
    id: "agnes-2.5-flash",
    label: "agnes-2.5-flash",
    desc: "均衡档 · 支持识图与思考",
    provider: "agnes",
    vision: true,
    thinking: true,
  },
  {
    id: "agnes-2.0-flash",
    label: "agnes-2.0-flash",
    desc: "轻量档 · 支持识图",
    provider: "agnes",
    vision: true,
    thinking: true,
  },
  {
    id: "deepseek-chat",
    label: "deepseek-chat",
    desc: "DeepSeek V3 · 通用对话",
    provider: "deepseek",
    vision: false,
  },
  {
    id: "deepseek-reasoner",
    label: "deepseek-reasoner",
    desc: "DeepSeek R1 · 始终深度推理",
    provider: "deepseek",
    vision: false,
    thinking: true,
    alwaysThinking: true,
  },

  /* ------------------------- 书生·端砚（Intern InkStone） ------------------------- */
  /* 上海 AI 实验室科研模型平台，墨点计费；标注「限时免费」的三款不扣墨点。 */

  {
    id: "intern-s2",
    label: "Intern S2",
    desc: "书生 S2 · 397B 科学多模态，限时免费",
    provider: "inkstone",
    vision: true,
  },
  {
    id: "atria-dawn-preview",
    label: "Atria Dawn",
    desc: "Atria Dawn · 256K 科学推理，限时免费",
    provider: "inkstone",
    vision: false,
  },
  {
    id: "agents-a1",
    label: "Agents A1",
    desc: "Agents A1 · 多模态 Agent，限时免费",
    provider: "inkstone",
    vision: true,
  },
  {
    id: "deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    desc: "DeepSeek V4 Flash · 1M 上下文，性价比高",
    provider: "inkstone",
    vision: false,
  },
  {
    id: "deepseek-v4-flash-vision",
    label: "DeepSeek V4 Flash Vision",
    desc: "DeepSeek V4 Flash · 1M 上下文，支持识图",
    provider: "inkstone",
    vision: true,
  },
  {
    id: "deepseek-v4-pro-0813",
    label: "DeepSeek V4 Pro",
    desc: "DeepSeek V4 Pro · 1M 上下文，能力更强",
    provider: "inkstone",
    vision: false,
  },
  {
    /**
     * GLM 5.3 是原生推理模型，不论开关都返回 reasoning_content，
     * 前端按同一字段解析即可展示思考过程。
     * ⚠️ 这里刻意不设 thinking —— 设了会发 Agnes 扩展字段
     *    chat_template_kwargs，端砚不一定认，多一个字段多一份风险。
     */
    id: "glm-5.3",
    label: "GLM 5.3",
    desc: "GLM 5.3 · 1M 上下文，始终深度推理",
    provider: "inkstone",
    vision: false,
  },
  {
    id: "kimi-k2.6",
    label: "Kimi K2.6",
    desc: "Kimi K2.6 · 1M 上下文",
    provider: "inkstone",
    vision: false,
  },
  {
    id: "minimax-m3",
    label: "MiniMax M3",
    desc: "MiniMax M3 · 1M 上下文",
    provider: "inkstone",
    vision: false,
  },
  {
    id: "qwen3.8-27b",
    label: "Qwen3.8 27B",
    desc: "Qwen3.8 27B · 轻量通用",
    provider: "inkstone",
    vision: false,
  },

  /* ------------------------- 书生·浦语（InternLM / Atria） ------------------------- */

  /*
   * ⚠️ 模型 id 以官方文档「模型概览与接口选择」为准：
   * 浦语平台当前只提供 Atria-Dawn-Preview 一款模型，上下文 256K tokens。
   * 注意 id 的大小写是官方写法（Atria-Dawn-Preview），与端砚那条
   * atria-dawn-preview 是不同 provider 下的同名模型，别合并。
   *
   * 平台随时会上下架模型。如果调用报 model not found，
   * 用设置里的「管理模型 → 探测」拉取该 Key 实际可用的模型列表，
   * 勾选后即自动加入下拉框，不需要改代码。
   */
  {
    id: "Atria-Dawn-Preview",
    label: "Atria Dawn Preview",
    desc: "书生·浦语 · 256K 科研分析 / 代码 / 多轮 Agent",
    provider: "atriasi",
    vision: false,
  },
];

/** 兼容旧引用的 Agnes 模型列表 */
export const AGNES_MODELS = CHAT_MODELS.filter((m) => m.provider === "agnes");

/**
 * 默认模型。站长可用 UPSTREAM_MODEL 换成自己中转服务的模型名，
 * 这样连"换中转服务"都不用改代码。
 */
/** Agnes 文生图端点 */
export const AGNES_IMAGE_URL =
  process.env.AGNES_IMAGE_URL?.trim() || "https://api.agnes-ai.cn/v1/images/generations";

/**
 * 文生图模型名。
 *
 * ⚠️ 官方文档写死为 agnes-image-2.5-flash（不带日期后缀），
 *    写错会直接 404。站长可用 AGNES_IMAGE_MODEL 覆盖。
 */
export const AGNES_IMAGE_MODEL =
  process.env.AGNES_IMAGE_MODEL?.trim() || "agnes-image-2.5-flash";

/**
 * 生图可选宽高比。
 *
 * ⚠️ 与文档一致：1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 2:3 / 3:2 / 21:9。
 *    注意没有 2:1 —— 横向宽幅要用 21:9 或 16:9。
 */
export const IMAGE_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"] as const;

/** 生图尺寸档位（文档推荐值，也兼容 1024x768 这类历史写法） */
export const IMAGE_SIZES = ["1K", "2K", "3K", "4K"] as const;

/** 单次最多生成张数（文档未明确上限，保守取 4 避免超时） */
export const IMAGE_MAX_COUNT = 4;

/* ------------------------------ 文生视频 ------------------------------ */

/**
 * Agnes 文生视频端点。
 *
 * ⚠️ 视频是**异步任务**，跟图片不一样：这里只负责"创建任务"，
 *    拿到 video_id 后要到 /agnesapi 轮询（见 AGNES_VIDEO_POLL_URL）。
 */
export const AGNES_VIDEO_URL =
  process.env.AGNES_VIDEO_URL?.trim() || "https://api.agnes-ai.cn/v1/videos";

/**
 * 查询任务进度。文档要求带 model_name，keyframe/reference 模式必填。
 *
 * ⚠️ 注意域名跟创建任务**不同**：创建走 api.agnes-ai.cn，查询走 apihub.agnes-ai.com。
 *    文档里两个是分开写的，混用会查不到任务。
 */
export const AGNES_VIDEO_POLL_URL =
  process.env.AGNES_VIDEO_POLL_URL?.trim() || "https://apihub.agnes-ai.com/agnesapi";

/**
 * 文生视频模型名。
 *
 * Flash 版固定为 agnes-video-2.5-flash（文档明确）。
 * 站长可用 AGNES_VIDEO_MODEL 覆盖。
 */
export const AGNES_VIDEO_MODEL =
  process.env.AGNES_VIDEO_MODEL?.trim() || "agnes-video-2.5-flash";

/**
 * Flash 只支持纯文本生成，且不支持任何媒体字段（first_frame / last_frame /
 * images / audios / videos 传了就 400）。显式声明比依赖上游默认更稳。
 */
export const VIDEO_MODE = "text";

/** 时长（秒）。文档要求以**字符串**传，范围 "4"–"12"。 */
export const VIDEO_SECONDS = [
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
] as const;

/**
 * 视频画幅。文档给的完整清单（决定输出像素，如 21:9→1680x720、9:16→720x1280）。
 * 传清单外的值上游会拒。
 */
export const VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

/**
 * 分辨率：Flash **强制 720P**，传其他值上游直接返回 400 `size must be 720P`。
 * 所以这里只有一项，UI 也不再让用户选——选了必然失败。
 * 输出尺寸由 aspect_ratio 决定，不是由 size 决定。
 */
export const VIDEO_SIZES = ["720P"] as const;

/**
 * 轮询上限：视频生成通常几十秒到几分钟。
 * 前端按 5 秒一次轮询，上限 90 次 ≈ 7.5 分钟，超了就提示用户去查任务。
 */
export const VIDEO_MAX_POLLS = 90;

export const DEFAULT_MODEL = process.env.UPSTREAM_MODEL?.trim() || "agnes-3.0-flash";

/**
 * 默认上游地址。站长可用 UPSTREAM_BASE_URL 指向自己的中转服务
 * （One API / New API / VoAPI 等 OpenAI 兼容聚合站都行）。
 */
export const DEFAULT_BASE_URL =
  process.env.UPSTREAM_BASE_URL?.trim() || PROVIDERS.agnes.baseUrl;

export const AGENT_TIP = "仅聊天模式。需要 Agent 功能请在设置中填写对应服务商的 API Key。";

export function getModel(modelId: string): ModelOption | undefined {
  return CHAT_MODELS.find((m) => m.id === modelId);
}

export function isAllowedModel(modelId: string): boolean {
  return CHAT_MODELS.some((m) => m.id === modelId);
}

export function getProvider(modelId: string): ProviderId {
  return getModel(modelId)?.provider ?? "agnes";
}

/** 该模型是否支持图片输入 */
export function supportsVision(modelId: string): boolean {
  return getModel(modelId)?.vision ?? false;
}

/** 该模型是否支持思考模式（可开关） */
export function supportsThinking(modelId: string): boolean {
  return getModel(modelId)?.thinking ?? false;
}

/** 该模型是否强制思考（原生推理模型，开关无效） */
export function isAlwaysThinking(modelId: string): boolean {
  return getModel(modelId)?.alwaysThinking ?? false;
}

/* ------------------------------ 思考强度 ------------------------------ */

/**
 * 思考强度档位，从左到右由弱到强。
 *
 * 档位越高，模型推理得越久、**消耗的 token 越多** ——
 * 这不是 UI 上的装饰，是真实计费差异，所以界面上必须写清楚。
 */
export const EFFORT_LEVELS = ["off", "low", "high", "max"] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** 旧版本存的是 medium，读到这里要归并掉，否则滑块找不到位置 */
export function normalizeEffort(raw: unknown): EffortLevel {
  const v = typeof raw === "string" ? raw : "";
  if (v === "off" || v === "low" || v === "high" || v === "max") return v;
  if (v === "medium") return "high";
  return "low";
}

/**
 * 档位 → 上游 `reasoning_effort` 字段。
 *
 * OpenAI 只认 minimal / low / medium / high 四个值，
 * 所以四档 UI 要落到这上面：
 *   off  → 不发（等于彻底关掉思考，最省）
 *   low  → low
 *   high → high
 *   max  → high，同时由调用方放宽 token 预算（见 EFFORT_TOKEN_BUDGET）
 *
 * 不认识这个字段的上游（Agnes 是 llama.cpp 服务端）会忽略，不报错。
 */
export function effortToUpstream(level: EffortLevel): "low" | "high" | null {
  if (level === "off") return null;
  return level === "low" ? "low" : "high";
}

/**
 * 各档位额外放宽的输出预算倍数。
 *
 * 高強度思考会先吐一大段推理再给答案，预算给少了会被截断 ——
 * 表现为「想到了一半就没了」。所以档位越高，允许输出得越多。
 */
export const EFFORT_TOKEN_BUDGET: Record<EffortLevel, number> = {
  off: 1,
  low: 1.25,
  high: 1.6,
  max: 2.2,
};

/* --------------------------- 自定义供应商（用户自建） --------------------------- */

/**
 * 用户在设置里自行添加的 OpenAI 兼容供应商。
 * 存 localStorage，随聊天请求一起提交给服务端。
 */
export interface CustomProviderConfig {
  /** 稳定唯一 id，形如 custom:myapi */
  id: string;
  /** 显示名 */
  label: string;
  /** OpenAI 兼容根地址，如 https://api.example.com/v1 */
  baseUrl: string;
  /** 该供应商下的模型 id 列表 */
  models: string[];
  /** 这些模型是否支持识图 */
  vision?: boolean;
  /** 这些模型是否支持思考模式（会带上 chat_template_kwargs.enable_thinking） */
  thinking?: boolean;
}

/** 内置服务商 id 不能占用 */
export const BUILTIN_PROVIDER_IDS = ["agnes", "deepseek", "inkstone", "atriasi"] as const;

/**
 * 各内置服务商「站点预设 Key」对应的环境变量名。
 *
 * 之前只有 Agnes 有预设 Key（PRESET_AGNES_API_KEY），其余三家在服务端
 * 一律只认用户自己填的 Key。后果是：站长配了端砚/浦语的 Key，
 * 只有站长自己的浏览器（localStorage 里有 Key）能看到那些模型，
 * 其他访客一个都看不到。
 *
 * 现在四家都支持：配了对应环境变量即全站可用。
 * 端砚/浦语的 Key **不通用**，必须分别配。
 */
export const PRESET_KEY_ENV: Record<ProviderId, string> = {
  agnes: "PRESET_AGNES_API_KEY",
  deepseek: "PRESET_DEEPSEEK_API_KEY",
  inkstone: "PRESET_INKSTONE_API_KEY",
  atriasi: "PRESET_ATRIASI_API_KEY",
  gateway: "AI_GATEWAY_API_KEY",
};

/** 自定义供应商 id 必须以 custom: 开头，避免与内置 id 冲突 */
export const CUSTOM_PROVIDER_PREFIX = "custom:";

export function isCustomProviderId(id: string): boolean {
  return id.startsWith(CUSTOM_PROVIDER_PREFIX);
}

/**
 * 解析请求里携带的自定义供应商，剔除不合法的条目。
 * 任何一条格式不对就整条丢弃，不让脏数据污染后续流程。
 */
export function sanitizeCustomProviders(input: unknown): CustomProviderConfig[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: CustomProviderConfig[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;

    const id = typeof c.id === "string" ? c.id.trim() : "";
    // 必须带 custom: 前缀，防止有人伪造 agnes/deepseek 覆盖内置配置
    if (!isCustomProviderId(id) || seen.has(id)) continue;

    const baseUrl = typeof c.baseUrl === "string" ? c.baseUrl.trim().replace(/\/+$/, "") : "";
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) continue;

    let hostnameOk = false;
    try {
      hostnameOk = Boolean(new URL(baseUrl).hostname);
    } catch {
      hostnameOk = false;
    }
    if (!hostnameOk) continue;

    // SSRF 防护：挡掉内网 / 本机 / 云元数据地址
    if (isBlockedBaseUrl(baseUrl)) continue;

    const models = Array.isArray(c.models)
      ? c.models
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
          .map((m) => m.trim())
          .slice(0, 50)
      : [];
    if (models.length === 0) continue;

    const label =
      (typeof c.label === "string" ? c.label.trim() : "") || id.replace(CUSTOM_PROVIDER_PREFIX, "");

    seen.add(id);
    out.push({
      id,
      label,
      baseUrl,
      models,
      vision: c.vision === true,
      thinking: c.thinking === true,
    });
  }

  // 最多 10 个自定义供应商，防止请求体被撑爆
  return out.slice(0, 10);
}

/* -------------------------- 站点级模型清单（全站可见） -------------------------- */

/**
 * 清洗「管理员追加的站点级模型」。
 *
 * 键只认内置服务商 id（agnes / deepseek / inkstone / atriasi），
 * 值只保留非空字符串、去重、每家最多 50 个，超过的直接丢弃 ——
 * 这是管理员自己填的数据，仍要防脏数据把全站模型菜单撑爆。
 */
export function sanitizeProviderModels(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [pid, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!(BUILTIN_PROVIDER_IDS as readonly string[]).includes(pid)) continue;
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const models: string[] = [];
    for (const m of list) {
      if (typeof m !== "string") continue;
      const id = m.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push(id.slice(0, 200));
      if (models.length >= 50) break;
    }
    if (models.length > 0) out[pid] = models;
  }
  return out;
}

/* ---------------------------- 按供应商解析模型 ---------------------------- */

export interface ResolvedTarget {
  /** 供应商 id（内置或 custom:xxx） */
  providerId: string;
  label: string;
  baseUrl: string;
  vision: boolean;
  /** 该供应商/模型是否支持思考模式 */
  thinking: boolean;
  isCustom: boolean;
}

/**
 * 解析某个模型该打到哪里。
 *
 * @param modelId    模型 id
 * @param custom     请求携带的自定义供应商
 * @param baseUrls   用户为各供应商单独配置的 Base URL 覆盖值
 * @param siteModels 管理员追加的站点级模型（按服务商分组）
 */
export function resolveTarget(
  modelId: string,
  custom: CustomProviderConfig[],
  baseUrls: Record<string, string> = {},
  siteModels: Record<string, string[]> = {},
): ResolvedTarget | null {
  // 1) 先在内置模型里找
  const builtin = CHAT_MODELS.find((m) => m.id === modelId);
  if (builtin) {
    const cfg = PROVIDERS[builtin.provider];
    const override = (baseUrls[builtin.provider] ?? "").trim().replace(/\/+$/, "");
    return {
      providerId: builtin.provider,
      label: cfg.label,
      baseUrl: override || cfg.baseUrl,
      vision: builtin.vision,
      thinking: builtin.thinking === true,
      isCustom: false,
    };
  }

  // 2) 再在自定义供应商里找
  for (const c of custom) {
    if (!c.models.includes(modelId)) continue;
    const override = (baseUrls[c.id] ?? "").trim().replace(/\/+$/, "");
    return {
      providerId: c.id,
      label: c.label,
      baseUrl: override || c.baseUrl,
      vision: c.vision === true,
      thinking: c.thinking === true,
      isCustom: true,
    };
  }

  // 3) 最后查管理员追加的站点级模型
  for (const [pid, list] of Object.entries(siteModels)) {
    if (!list.includes(modelId)) continue;
    const cfg = PROVIDERS[pid as ProviderId];
    if (!cfg) continue;
    const override = (baseUrls[pid] ?? "").trim().replace(/\/+$/, "");
    return {
      providerId: pid,
      label: cfg.label,
      baseUrl: override || cfg.baseUrl,
      // 管理员追加时不知道上游是否支持视觉/思考，保守按不支持处理
      vision: false,
      thinking: false,
      isCustom: false,
    };
  }

  return null;
}

/** 模型是否可用（内置 + 自定义 + 站点级） */
export function isAllowedModelWith(
  modelId: string,
  custom: CustomProviderConfig[],
  siteModels: Record<string, string[]> = {},
): boolean {
  if (CHAT_MODELS.some((m) => m.id === modelId)) return true;
  if (custom.some((c) => c.models.includes(modelId))) return true;
  return Object.values(siteModels).some((list) => list.includes(modelId));
}

/* ------------------------------ SSRF 防护 ------------------------------ */

/**
 * 判断 Base URL 是否指向内网 / 本机 / 云元数据服务。
 *
 * 自定义供应商允许用户填任意地址，若不设防，攻击者可以借本站做跳板去打
 * 内网服务或 `169.254.169.254`（云厂商元数据，能拿到临时凭证）。
 * 这里是 SSRF 防护，不是功能限制 —— 正常的公网 API 地址都不受影响。
 */
export function isBlockedBaseUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return true;
  }

  // 只允许 http/https，挡掉 file://、gopher:// 等危险协议
  if (u.protocol !== "http:" && u.protocol !== "https:") return true;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  // 云元数据地址
  if (host === "169.254.169.254" || host === "metadata.google.internal" || host === "metadata") {
    return true;
  }

  // 本机
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    return true;
  }
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  // IPv4 私有网段 10/8、172.16/12、192.168/16，以及 169.254/16 链路本地
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 127) return true;
    if (a === 0) return true;
  }

  // IPv6 私有 / 链路本地
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;

  return false;
}

/* ---------------------------- localStorage Keys ---------------------------- */

export const LS_KEYS = {
  // 各服务商的 Key 分开存
  keys: "agnes:keys", // JSON: { agnes?: string; deepseek?: string; inkstone?: string; atriasi?: string }
  apiKey: "agnes:apiKey",
  baseUrl: "agnes:baseUrl", // 旧字段，仅用于迁移
  baseUrls: "agnes:baseUrls", // JSON: { agnes?: string; deepseek?: string; "custom:x"?: string }
  customProviders: "agnes:customProviders", // JSON: CustomProviderConfig[]
  /**
   * 内置供应商的额外模型。
   *
   * 结构：{ [providerId]: string[] }，例如 { inkstone: ["new-model-id"] }。
   *
   * 为什么需要：内置供应商的模型是写死在 CHAT_MODELS 里的，
   * 上游一加新模型，用户就只能等发版。
   * 有了这个字段，「管理模型 → 探测」可以把上游新增的模型 id 追加到这里，
   * ModelPicker 展示时会把它并进该供应商的分组里。
   *
   * 注意：这里只额外**增加**，不会覆盖 CHAT_MODELS 里已有的内置模型。
   */
  extraModels: "agnes:extraModels",
  model: "agnes:model",
  messages: "agnes:messages",
  conversationId: "agnes:conversationId",
  theme: "agnes:theme",
  cloudSync: "agnes:cloudSync",
  /**
   * 用户是否**手动**设置过云端保存。
   *
   * 存在这个标记时，说明用户有自己的偏好，
   * 管理员的「默认开启」就不能再覆盖他 —— 否则用户关掉后一刷新又变回开启。
   */
  cloudSyncSetByUser: "agnes:cloudSyncSetByUser",
  sidebarCollapsed: "agnes:sidebarCollapsed",
  s3: "agnes:s3",
  /** 思考模式开关 */
  thinking: "agnes:thinking",
  /** 思考强度：low / medium / high（对应 OpenAI 的 reasoning_effort） */
  effort: "agnes:effort",
  /** 联网搜索开关 */
  webSearch: "agnes:webSearch",
} as const;
