/**
 * Agent 工具调用层 —— 让「AI 自己调接口」在各平台都能跑。
 *
 * ============ 为什么单独抽一层 ============
 *
 * 本项目的所有上游（agnes / deepseek / 书生·端砚 / 书生·浦语）都是
 * **OpenAI 兼容**的 `/v1/chat/completions`。理论上统一用 `tools` 参数就行，
 * 但**兼容 ≠ 完整实现**，实测各家差异很大：
 *
 *   1. 有的网关**根本不认** `tools` 字段 —— 静默忽略，照常出普通文本
 *   2. 有的认 `tools` 但**不支持 `tool_choice`**，传了直接 400
 *   3. DeepSeek 在 **thinking 模式**（reasoner）下：
 *      `tool_choice: "required"` 和「强制指定某个函数名」会 **400**
 *      （官方明确列为不支持项）
 *   4. `arguments` 字段：标准规定是 **JSON 字符串**，但部分网关直接
 *      返回**已解析的对象**，甚至返回空串
 *
 * 所以这里的策略是 **探测 + 降级**，而不是硬套一种格式：
 *
 *   - 先按 OpenAI 标准发 `tools`
 *   - 上游 400 且错误信息含 tools/function/tool_choice → 记进黑名单，换 JSON 引导
 *   - 上游 200 但没返回 tool_calls → 同样降级（说明它忽略了 tools）
 *   - 降级后走 `lib/search-agent.ts` 里原有的「提示词要求输出 JSON」方案
 *
 * ============ 回灌结果的格式（最容易错的地方） ============
 *
 * OpenAI 兼容格式要求：
 *   - 必须**保留那条带 tool_calls 的 assistant 消息**原样回传，
 *     不能只留文本、不能丢 tool_calls —— 否则上游报「找不到对应的调用」
 *   - 结果消息 role 是 `"tool"`，且**每条都要带 `tool_call_id`**
 *     （多条结果不能用一条消息塞完，必须一个调用一条消息）
 *
 * 这些细节写错的话，上游要么 400，要么模型看不到工具结果继续瞎编。
 */

/** 工具的 JSON Schema 定义 */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema（object 类型） */
  parameters: Record<string, unknown>;
}

/** 归一化后的工具调用：屏蔽各家在字段类型上的差异 */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** 对话消息（够用即可，不重复定义完整 ChatCompletion 类型） */
export interface ToolMsg {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
}

/**
 * 转成 OpenAI 的 tools 数组。
 *
 * 注意：这里**不设 `tool_choice`**。
 * 默认行为就是 auto（模型自己决定要不要调工具），
 * 而这恰好绕开了 DeepSeek thinking 模式下「required / 指定函数名 → 400」的坑。
 */
export function openAITools(specs: ToolSpec[]): unknown[] {
  return specs.map((s) => ({
    type: "function",
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters,
    },
  }));
}

/**
 * 解析响应里的工具调用。
 *
 * 容错点：
 * - `arguments` 可能是字符串（标准），也可能是对象（部分网关）
 * - 可能是空串 / 非法 JSON → 当成无参数
 * - 没有 id 时造一个稳定的（靠索引），保证回灌能对上
 */
export function parseToolCalls(message: unknown): ToolCall[] {
  if (!message || typeof message !== "object") return [];
  const raw = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const out: ToolCall[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const rec = item as Record<string, unknown>;
    const fn = (rec.function ?? {}) as Record<string, unknown>;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) return;

    const id = typeof rec.id === "string" && rec.id ? rec.id : `call_${index}`;
    out.push({ id, name, args: parseArgs(fn.arguments) });
  });
  return out;
}

/** arguments 可能是字符串、对象、空 —— 都归一成对象 */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * 构造「工具结果」回灌消息。
 *
 * **一个调用一条消息**，不能合并 —— 上游靠 `tool_call_id` 对号入座，
 * 合并会导致「调用数与结果数不匹配」的 400。
 */
export function toolResultMessages(
  calls: ToolCall[],
  resultOf: (call: ToolCall) => string,
): ToolMsg[] {
  return calls.map((call) => ({
    role: "tool" as const,
    tool_call_id: call.id,
    name: call.name,
    content: resultOf(call),
  }));
}

/* ==================== 能力探测 ==================== */

/**
 * 上游「不支持 tools」的黑名单。
 *
 * 只在**进程内**缓存 —— Vercel 是短生命周期实例，缓存随实例消亡，
 * 不会永久错杀某个上游（万一它哪天支持了呢）。
 */
const unsupported = new Set<string>();

export function markToolsUnsupported(key: string): void {
  unsupported.add(key);
}

export function toolsLikelySupported(key: string): boolean {
  return !unsupported.has(key);
}

/**
 * 判断一次失败是不是「上游不支持 tools」造成的。
 *
 * 光看 400 不够 —— 400 也可能是 Key 无效、参数超长。
 * 所以同时要求错误体里出现 tools / tool_choice / function 之类的关键词。
 */
export function isToolsRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 404 && status !== 422) return false;
  return /tool|function[_ ]?call/i.test(body ?? "");
}
