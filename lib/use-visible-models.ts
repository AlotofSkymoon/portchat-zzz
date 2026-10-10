"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CHAT_MODELS,
  LS_KEYS,
  PROVIDERS,
  sanitizeCustomProviders,
  type CustomProviderConfig,
  type ProviderId,
} from "@/lib/config";
import { usePresetProviders } from "@/lib/use-preset-providers";
import { useSiteProviderModels } from "@/lib/use-site-models";

/**
 * 「站点实际可用的模型」统一口径。
 *
 * 之前每个页面各算各的：投票候选直接拿 CHAT_MODELS 全量渲染，
 * 于是把 anthropic/claude-sonnet-4.5、openai/gpt-5 这些**本站点根本没配**
 * 的模型也摆出来给人投票 —— 一堆点不动的按钮。
 *
 * 现在收敛到这一处，和输入框里的模型菜单用同一套规则：
 *   1. 内置供应商没配站点 Key、用户也没自己填 Key → 整组不显示
 *   2. 用户自建供应商 → 列进各自的分组
 *   3. 用户自己探测追加的 + 管理员「保存到站点」的 → 并进对应供应商分组
 *
 * 规则只写一遍，模型菜单和排行榜共用，不会再出现两边不一致。
 */

// DeepSeek 入口已移除：站点不提供 DeepSeek Key，界面不再列出
export const PROVIDER_ORDER: ProviderId[] = ["agnes", "atriasi", "inkstone", "gateway"];

export interface VisibleModel {
  id: string;
  label: string;
  desc: string;
  providerLabel: string;
}

export interface VisibleGroup {
  key: string;
  label: string;
  items: VisibleModel[];
}

export interface LocalModelConfig {
  keys: Record<string, string>;
  customProviders: CustomProviderConfig[];
  extraModels: Record<string, string[]>;
}

const EMPTY: LocalModelConfig = { keys: {}, customProviders: [], extraModels: {} };

/** 读浏览器里存的私有配置（Key / 自建供应商 / 追加模型） */
function useLocalModelConfig(): LocalModelConfig {
  const [cfg, setCfg] = useState<LocalModelConfig>(EMPTY);

  useEffect(() => {
    let keys: Record<string, string> = {};
    let customProviders: CustomProviderConfig[] = [];
    let extraModels: Record<string, string[]> = {};

    try {
      const rawKeys = localStorage.getItem(LS_KEYS.keys);
      if (rawKeys) {
        const parsed: unknown = JSON.parse(rawKeys);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string") keys[k] = v;
          }
        }
      }
    } catch {
      keys = {};
    }

    try {
      const rawCustom = localStorage.getItem(LS_KEYS.customProviders);
      if (rawCustom) customProviders = sanitizeCustomProviders(JSON.parse(rawCustom));
    } catch {
      customProviders = [];
    }

    try {
      const rawExtra = localStorage.getItem(LS_KEYS.extraModels);
      if (rawExtra) {
        const parsed: unknown = JSON.parse(rawExtra);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(v)) {
              extraModels[k] = v.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
            }
          }
        }
      }
    } catch {
      extraModels = {};
    }

    setCfg({ keys, customProviders, extraModels });
  }, []);

  return cfg;
}

/**
 * 按当前用户视角算出可见模型分组。
 *
 * @param override 调用方已有配置时直接传（输入框里是父组件统一读的），
 *                 不传就自己从 localStorage 读。
 */
export function useVisibleModelGroups(override?: Partial<LocalModelConfig>): VisibleGroup[] {
  const presetProviders = usePresetProviders();
  const siteModels = useSiteProviderModels();
  const local = useLocalModelConfig();

  const keys = override?.keys ?? local.keys;
  const customProviders = override?.customProviders ?? local.customProviders;
  const extraModels = override?.extraModels ?? local.extraModels;

  return useMemo(() => {
    const builtin = PROVIDER_ORDER
      // 没填 Key 的内置供应商整个不显示 —— 列出来也调不通，点了就是报错
      .filter((pid) => presetProviders.has(pid) || Boolean((keys[pid] ?? "").trim()))
      .map((pid) => {
        const pl = PROVIDERS[pid].label;
        const base = CHAT_MODELS.filter((m) => m.provider === pid).map((m) => ({
          id: m.id,
          label: m.label,
          desc: m.desc,
          providerLabel: pl,
        }));
        // 用户自己探测/手填追加的模型 + 管理员加到站点上的，去掉与内置重复的再并进去
        const extras = Array.from(new Set([...(extraModels[pid] ?? []), ...(siteModels[pid] ?? [])]))
          .filter((id) => !base.some((m) => m.id === id))
          // 追加模型的说明写具体供应商名，别笼统写「自定义供应商」
          .map((id) => ({ id, label: id, desc: pl, providerLabel: pl }));
        return { key: pid as string, label: pl, items: [...base, ...extras] };
      });

    const custom = customProviders.map((c) => ({
      key: c.id,
      label: c.label,
      items: c.models.map((id) => ({ id, label: id, desc: c.label, providerLabel: c.label })),
    }));

    return [...builtin, ...custom].filter((g) => g.items.length > 0);
  }, [customProviders, keys, extraModels, siteModels, presetProviders]);
}
