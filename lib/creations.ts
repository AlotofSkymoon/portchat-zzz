/**
 * 创作记录（生图 / 生影片）。
 *
 * 用户诉求很直接：生成完的图片刷新一下就没了，得留下来。
 *
 * 两条存储路径：
 *   - 已登录 → 云端（KV / Redis），换设备也在
 *   - 未登录 → localStorage，至少刷新不丢
 *
 * 判断走哪条不靠前端猜登录态，而是直接请求云端接口：
 * 返回 401 就说明没登录（存储不可用时也回落本地），逻辑不会和实际状态脱节。
 */

export type CreationKind = "image" | "video";

export interface CreationRecord {
  id: string;
  kind: CreationKind;
  prompt: string;
  /** 上游实际用的模型，用于事后排查怪图 */
  model: string;
  urls: string[];
  ratio?: string;
  size?: string;
  /** 仅视频：时长（秒） */
  seconds?: string;
  createdAt: number;
}

/** 单用户最多保留多少条。超了淘汰最旧的，避免 KV 无限膨胀。 */
export const CREATION_LIMIT = 100;
/** 未登录时本地最多保留多少条 */
export const LOCAL_CREATION_LIMIT = 50;

const LS_KEY = "portchat:creations";

function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeCreationId(): string {
  return newId();
}

/* ---------------------------- 本地（兜底） ---------------------------- */

function readLocal(): CreationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as CreationRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: CreationRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, LOCAL_CREATION_LIMIT)));
  } catch {
    /* 隐私模式或配额满，忽略：记录功能降级，不打断生成 */
  }
}

/* ------------------------------ 对外 API ------------------------------ */

/**
 * 列出创作记录。
 * 云端可用就用云端；未登录或存储异常时静默回落本地，不弹错——
 * 记录是附加能力，不该因为它让整个创作页看起来"坏了"。
 */
export async function listCreations(): Promise<{
  list: CreationRecord[];
  source: "cloud" | "local";
}> {
  try {
    const res = await fetch("/api/creations", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { creations?: CreationRecord[] };
      return { list: data.creations ?? [], source: "cloud" };
    }
  } catch {
    /* 网络异常，走本地 */
  }
  return { list: readLocal(), source: "local" };
}

/** 保存一条。返回实际落在哪里，便于界面提示。 */
export async function saveCreation(
  input: Omit<CreationRecord, "id" | "createdAt"> & { id?: string; createdAt?: number },
): Promise<{ ok: boolean; source: "cloud" | "local" }> {
  const rec: CreationRecord = {
    id: input.id ?? newId(),
    createdAt: input.createdAt ?? Date.now(),
    kind: input.kind,
    prompt: input.prompt,
    model: input.model,
    urls: input.urls,
    ratio: input.ratio,
    size: input.size,
    seconds: input.seconds,
  };

  try {
    const res = await fetch("/api/creations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ record: rec }),
    });
    if (res.ok) return { ok: true, source: "cloud" };
  } catch {
    /* 走本地 */
  }

  const list = readLocal();
  list.unshift(rec);
  writeLocal(list);
  return { ok: true, source: "local" };
}

/** 删除一条。同时清本地——登录前后可能两条路上都有残留。 */
export async function deleteCreation(id: string): Promise<void> {
  try {
    await fetch(`/api/creations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* 忽略：本地仍会清 */
  }
  writeLocal(readLocal().filter((r) => r.id !== id));
}

/** 清空全部。 */
export async function clearCreations(): Promise<void> {
  try {
    await fetch("/api/creations?all=1", { method: "DELETE" });
  } catch {
    /* 忽略 */
  }
  writeLocal([]);
}
