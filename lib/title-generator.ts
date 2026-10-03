import { configValue } from "./runtime-config";
import { resolveTarget } from "./config";

/**
 * 用模型给会话起一个短标题。
 *
 * 只走**服务端预设 Key**，不用浏览器里用户填的 Key：
 * - 起标题是站点自己的行为，不该烧用户的额度
 * - 也不用把用户 Key 从前端再传一遍（少一次密钥过网）
 * 没有预设 Key 时返回 null，前端保持默认的「首条消息截断」标题。
 */

const SYSTEM_PROMPT = [
  "你是一个会话标题生成器。",
  "根据用户发的第一条消息，概括出一个简短标题。",
  "规则：",
  "1. 只输出标题本身，不要任何解释、标点、引号、前缀",
  "2. 长度控制在 4 到 12 个字，最多不超过 20 个字",
  "3. 用与用户输入相同的语言",
  "4. 不要出现「对话」「聊天」「用户」这类无信息量的词",
].join("\n");

function sanitize(raw: string): string | null {
  let title = raw.trim();
  // 模型偶尔会带引号或「标题：」前缀，去掉
  title = title.replace(/^["'“”‘’`\s]+/, "").replace(/["'“”‘’`\s]+$/, "");
  title = title.replace(/^(标题|title)\s*[:：]\s*/i, "");
  title = title.replace(/[\r\n]+/g, " ").trim();
  if (!title) return null;
  // 20 字上限：侧边栏宽度有限，超长会被截断成省略号
  if (title.length > 20) title = title.slice(0, 20).trim();
  return title || null;
}

export async function generateConversationTitle(
  firstMessage: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const presetKey = configValue("PRESET_AGNES_API_KEY")?.trim();
  if (!presetKey) return null;

  const model = process.env.UPSTREAM_MODEL?.trim() || "agnes-3.0-flash";
  // 第二个参数是自定义供应商列表：起标题只走内置模型，传空数组
  const target = resolveTarget(model, []);
  if (!target) return null;

  const snippet = firstMessage.trim().slice(0, 500);

  try {
    const res = await fetch(`${target.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${presetKey}`,
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.3,
        max_tokens: 64,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: snippet },
        ],
      }),
      signal,
    });

    if (!res.ok) {
      console.error("[title] 上游返回", res.status);
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return sanitize(content);
  } catch (error) {
    console.error("[title] 生成失败", error instanceof Error ? error.message : error);
    return null;
  }
}
