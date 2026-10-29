/**
 * 赞助订单的 AI 审核。
 *
 * 为什么需要它：
 * 交易号是付款人自己填的，可以随手编一个。管理员人工核销要逐笔去
 * AlipayHK 订单里翻，几百笔下来根本做不完。所以先让模型做一轮
 * **合理性判断**：格式是不是真的交易号、跟金额和令牌对不对得上、
 * 有没有明显编造痕迹。
 *
 * ⚠️ 关键取舍 —— AI 只做「筛」，不做「判」：
 * - 判 pass：自动标记已赞助（但仍可在后台驳回）
 * - 判 suspicious：**转人工**，绝不自动驳回
 * 让模型直接拒掉一笔真付款，比漏过一笔假付款伤害大得多。
 *
 * ⚠️ 供应商与模型的挑法：
 * 从**站点预设 Key**里自动挑第一个可用的供应商，模型取该供应商
 * 最便宜的那一档（审核是纯分类任务，用旗舰纯属浪费）。
 * 完全没配预设 Key 时返回 null —— 调用方会把订单标成「待人工」，
 * 不会因此卡住流程。
 */

import {
  BUILTIN_PROVIDER_IDS,
  CHAT_MODELS,
  PROVIDERS,
  type ProviderId,
} from "@/lib/config";
import { loadStoredPresetKeys, resolvePresetKey } from "@/lib/preset-keys";
import { loadSiteProviderModels } from "@/lib/site-models";
import type { AiVerdict, SponsorOrder } from "@/lib/sponsor-pay";

export interface ReviewResult {
  verdict: AiVerdict;
  reason: string;
  model: string;
  provider: string;
}

/** 审核超时：这是后台辅助功能，宁可超时转人工也不该让请求挂住 */
const REVIEW_TIMEOUT_MS = 20_000;

/**
 * 挑一个能用的（供应商, 模型, Key）。
 *
 * 模型选该供应商在 CHAT_MODELS 里**第一个**条目 —— 列表是精心排过的，
 * 便宜的在前、旗舰在后，而审核不需要旗舰。
 */
async function pickReviewTarget(): Promise<{
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
} | null> {
  const stored = await loadStoredPresetKeys();
  const siteModels = await loadSiteProviderModels().catch(() => ({} as Record<string, string[]>));

  for (const pid of BUILTIN_PROVIDER_IDS) {
    const apiKey = resolvePresetKey(pid, stored);
    if (!apiKey) continue;

    // 优先用管理员「保存到站点」的模型，其次内置列表
    const saved = (siteModels[pid] ?? []).filter((m) => typeof m === "string" && m.trim());
    const builtin = CHAT_MODELS.filter((m) => m.provider === pid).map((m) => m.id);
    const model = saved[0] ?? builtin[0];
    if (!model) continue;

    return { providerId: pid, baseUrl: PROVIDERS[pid].baseUrl, model, apiKey };
  }
  return null;
}

/** 审核提示词：给足上下文，明确只要 JSON */
function buildPrompt(order: SponsorOrder): string {
  return [
    "你是一个支付订单审核助手，负责判断一笔用户自助提交的赞助付款是否可信。",
    "",
    "已知信息：",
    `- 站点固定收款金额：${order.amount} ${order.currency}`,
    `- 该订单的令牌：${order.token}`,
    `- 用户提交的平台交易号：${order.tradeNo ?? "（空）"}`,
    `- 用户留下的联系方式：${order.contact ?? "（未填）"}`,
    `- 二维码被扫时间：${order.scannedAt ? new Date(order.scannedAt).toISOString() : "未扫码"}`,
    `- 提交交易号时间：${order.claimedAt ? new Date(order.claimedAt).toISOString() : "未提交"}`,
    "",
    "判断要点：",
    "1. 交易号是否像一个真实支付平台的订单流水号（而非随手乱敲的键盘序列、重复字符、纯递增数字、明显占位文本）",
    "2. 交易号是否与本订单令牌有混淆痕迹（例如把令牌当交易号填了）",
    "3. 扫码时间与提交时间是否合理（先扫后付；间隔不至于离谱）",
    "",
    "输出要求：只输出一行 JSON，不要解释、不要 markdown 代码块。",
    '格式：{"verdict":"pass|suspicious","reason":"不超过 40 字的中文理由"}',
    "",
    "⚠️ 判定纪律：只有当你**相当确信这是一笔真实付款**时才判 pass；",
    "任何拿不准的情况一律判 suspicious —— 可疑订单会转人工，不会误伤用户。",
  ].join("\n");
}

/**
 * 调模型审核。
 *
 * @returns 审核结果；没有可用 Key / 上游出错 / 解析失败时返回 null
 *          （调用方会把订单留在「待人工」）
 */
export async function reviewOrder(order: SponsorOrder): Promise<ReviewResult | null> {
  const target = await pickReviewTarget().catch(() => null);
  if (!target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVIEW_TIMEOUT_MS);

  try {
    const res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify({
        model: target.model,
        messages: [{ role: "user", content: buildPrompt(order) }],
        // 审核不需要流式：一整个 JSON 回来更好解析，也省掉 SSE 解析的复杂度
        stream: false,
        temperature: 0,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : "";
    if (!text.trim()) return null;

    const parsed = extractJson(text);
    if (!parsed) return null;

    const verdict: AiVerdict = parsed.verdict === "pass" ? "pass" : "suspicious";
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 200)
        : verdict === "pass"
          ? "未说明理由"
          : "未说明理由";

    return {
      verdict,
      reason,
      model: target.model,
      provider: PROVIDERS[target.providerId].label,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从模型输出里抠出 JSON。
 *
 * 模型经常无视"不要代码块"的要求，返回 ```json {...} ```，
 * 也可能前后带一句废话。所以不能直接 JSON.parse 整段 ——
 * 逐字符做括号配平，取第一个完整的 {...} 更稳。
 */
function extractJson(text: string): { verdict?: string; reason?: string } | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as { verdict?: string; reason?: string };
  } catch {
    return null;
  }
}
