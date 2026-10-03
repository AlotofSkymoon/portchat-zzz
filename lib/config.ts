/** 支持的模型服务商 */
export type ProviderId = "agnes" | "deepseek";

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
    // 但界面上统一叫 Portchat —— 访客不需要知道背后接的是哪家。
    label: "Portchat",
    baseUrl: "https://apihub.agnes-ai.com/v1",
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
  {
    // 2026-09 上线的次世代模型：512K 上下文、65.5K 输出、支持图像 URL 输入，
    // 官方主打 Agent 执行链路（工具编排、长任务上下文、可信交付），当前全免费。
    // 纯聊天同样可用，故设为默认。
    id: "agnes-3.0-flash",
    label: "agnes-3.0-flash",
    desc: "最新一代 · Agent 执行强，支持识图",
    provider: "agnes",
    vision: true,
    thinking: true,
  },
  {
    id: "agnes-2.5-flash",
    label: "agnes-2.5-flash",
    desc: "编码 / 推理见长，支持识图",
    provider: "agnes",
    vision: true,
    thinking: true,
  },
  {
    id: "agnes-2.0-flash",
    label: "agnes-2.0-flash",
    desc: "稳定版，支持识图",
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
];

/** 兼容旧引用的 Agnes 模型列表 */
export const AGNES_MODELS = CHAT_MODELS.filter((m) => m.provider === "agnes");

/**
 * 默认模型。站长可用 UPSTREAM_MODEL 换成自己中转服务的模型名，
 * 这样连"换中转服务"都不用改代码。
 */
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
export const BUILTIN_PROVIDER_IDS = ["agnes", "deepseek"] as const;

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
 */
export function resolveTarget(
  modelId: string,
  custom: CustomProviderConfig[],
  baseUrls: Record<string, string> = {},
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

  return null;
}

/** 模型是否可用（内置 + 自定义） */
export function isAllowedModelWith(
  modelId: string,
  custom: CustomProviderConfig[],
): boolean {
  if (CHAT_MODELS.some((m) => m.id === modelId)) return true;
  return custom.some((c) => c.models.includes(modelId));
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
  keys: "agnes:keys", // JSON: { agnes?: string; deepseek?: string }
  apiKey: "agnes:apiKey",
  baseUrl: "agnes:baseUrl", // 旧字段，仅用于迁移
  baseUrls: "agnes:baseUrls", // JSON: { agnes?: string; deepseek?: string; "custom:x"?: string }
  customProviders: "agnes:customProviders", // JSON: CustomProviderConfig[]
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
  /** 联网搜索开关 */
  webSearch: "agnes:webSearch",
} as const;
