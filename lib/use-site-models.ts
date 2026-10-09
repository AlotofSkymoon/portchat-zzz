"use client";

import { useEffect, useState } from "react";

/**
 * 管理员追加的「站点级模型」。
 *
 * 管理员在内置供应商下探测/新增的模型，以前只写进他自己的浏览器，
 * 其他用户一个都看不到。现在存进站点设置，这里负责取下来，
 * 合并进所有人的模型菜单 —— 管理员加完，全站立刻可见。
 *
 * 同样用模块级 promise 共享，多个组件同时挂载只发一次请求。
 */

let inflight: Promise<Record<string, string[]>> | null = null;

async function fetchSiteModels(): Promise<Record<string, string[]>> {
  try {
    const res = await fetch("/api/site-settings", { cache: "no-store" });
    if (!res.ok) return {};
    const data = (await res.json()) as { settings?: { providerModels?: unknown } };
    const raw = data.settings?.providerModels;
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [pid, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const ids = list.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
      if (ids.length > 0) out[pid] = ids;
    }
    return out;
  } catch {
    return {};
  }
}

export function useSiteProviderModels(): Record<string, string[]> {
  const [models, setModels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let alive = true;
    inflight ??= fetchSiteModels();
    void inflight.then((v) => {
      if (alive) setModels(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  return models;
}
