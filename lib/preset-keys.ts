/**
 * 站点预设 Key 的解析 —— **服务端专用，不要被客户端引入**。
 *
 * 两级来源，环境变量优先：
 *  1. 环境变量 / Worker binding：PRESET_<PROVIDER>_API_KEY
 *  2. 管理员面板里存的（存在站点设置里，需要配了存储才可用）
 *
 * 为什么面板存的要放在第二级：环境变量一旦配了就压过面板，
 * 否则站长会遇到「我在面板改了却没生效」，跟 GitHub OAuth 一个道理。
 */

import { BUILTIN_PROVIDER_IDS, PRESET_KEY_ENV, type ProviderId } from "@/lib/config";
import { configValue } from "@/lib/runtime-config";
import { hasRedisConfig } from "@/lib/redis";
import { readSiteSettings } from "@/lib/site-settings-store";

/** 管理员面板里存的预设 Key（按服务商） */
export type PresetKeyMap = Partial<Record<ProviderId, string>>;

function isProviderId(value: unknown): value is ProviderId {
  return (
    typeof value === "string" && (BUILTIN_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

/** 只保留内置服务商的键，值去空白，空串丢弃 */
export function sanitizePresetKeys(raw: unknown): PresetKeyMap {
  const out: PresetKeyMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isProviderId(k)) continue;
    const value = typeof v === "string" ? v.trim() : "";
    if (value) out[k] = value.slice(0, 500);
  }
  return out;
}

/** 环境变量里配了预设 Key 的服务商 */
export function presetProvidersFromEnv(): ProviderId[] {
  return BUILTIN_PROVIDER_IDS.filter((pid) => Boolean(configValue(PRESET_KEY_ENV[pid])));
}

/** 站点设置里存了预设 Key 的服务商（由调用方传入已读好的 map） */
export function presetKeysFromStore(stored: PresetKeyMap): ProviderId[] {
  return BUILTIN_PROVIDER_IDS.filter((pid) => Boolean(stored[pid]));
}

/**
 * 取某个服务商最终生效的预设 Key。
 * 环境变量优先，其次面板。都没有返回空串。
 */
export function resolvePresetKey(pid: ProviderId, stored: PresetKeyMap = {}): string {
  const fromEnv = configValue(PRESET_KEY_ENV[pid]);
  if (fromEnv) return fromEnv;
  return stored[pid] ?? "";
}

/** 读取面板里存的预设 Key。没配存储或读失败时返回空，站点照常可用 */
export async function loadStoredPresetKeys(): Promise<PresetKeyMap> {
  if (!hasRedisConfig()) return {};
  try {
    return sanitizePresetKeys((await readSiteSettings()).presetKeys);
  } catch {
    return {};
  }
}
