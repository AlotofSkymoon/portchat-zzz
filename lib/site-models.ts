/**
 * 站点级模型清单的读取 —— **服务端专用**。
 *
 * 管理员给内置服务商追加的模型 id 存在站点设置里（Redis），
 * 所有用户的模型菜单都会看到它们。这里负责把它们读出来，
 * 交给 resolveTarget / isAllowedModelWith 做解析与校验。
 *
 * 没配存储或读失败时返回空对象 —— 站点照常可用，只是没有追加模型。
 */

import { sanitizeProviderModels } from "@/lib/config";
import { hasRedisConfig } from "@/lib/redis";
import { readSiteSettings } from "@/lib/site-settings-store";

/** 取管理员追加的站点级模型（按服务商分组） */
export async function loadSiteProviderModels(): Promise<Record<string, string[]>> {
  if (!hasRedisConfig()) return {};
  try {
    return sanitizeProviderModels((await readSiteSettings()).providerModels);
  } catch {
    return {};
  }
}
