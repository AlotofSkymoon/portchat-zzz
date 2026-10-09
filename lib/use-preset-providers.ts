"use client";

import { useEffect, useState } from "react";

import { PROVIDERS, type ProviderId } from "@/lib/config";

/**
 * 站点「已内置 API Key」的服务商集合。
 *
 * 之前只有 agnes 一家能显示，因为 `hasPreset` 是 lib/config.ts 里写死的常量。
 * 现在站长可以在环境变量或管理员面板里给任意内置服务商配 Key，
 * 具体配了哪些只有服务端知道，所以浏览器要问一次才知道该显示谁。
 *
 * 用模块级 promise 共享：多个组件同时挂载也只会发一次请求。
 */

/** 静态兜底：请求失败时至少保证写死内置的那几家仍然可见 */
const STATIC_PRESET = new Set<string>(
  (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => PROVIDERS[id].hasPreset),
);

let inflight: Promise<Set<string>> | null = null;

async function fetchPresetProviders(): Promise<Set<string>> {
  try {
    const res = await fetch("/api/site-settings", { cache: "no-store" });
    if (!res.ok) return STATIC_PRESET;
    const data = (await res.json()) as { presetProviders?: unknown };
    if (!Array.isArray(data.presetProviders)) return STATIC_PRESET;
    const out = new Set<string>(STATIC_PRESET);
    for (const id of data.presetProviders) {
      if (typeof id === "string" && id in PROVIDERS) out.add(id as ProviderId);
    }
    return out;
  } catch {
    // 拿不到就按静态值显示，总比把模型列表清空好
    return STATIC_PRESET;
  }
}

export function usePresetProviders(): Set<string> {
  const [set, setSet] = useState<Set<string>>(STATIC_PRESET);

  useEffect(() => {
    let alive = true;
    inflight ??= fetchPresetProviders().finally(() => {
      // 失败也缓存住，避免每次挂载都重试
    });
    void inflight.then((v) => {
      if (alive) setSet(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  return set;
}
