/**
 * 兼容层：历史上这里直接连 Upstash Redis。
 *
 * 现在存储已抽象成 @/lib/storage，会根据部署平台自动选择后端：
 *   - Cloudflare Workers → KV + D1（无需 Redis）
 *   - Vercel / 本地      → Upstash Redis
 *
 * 本文件保留原导出名，让上层业务代码无需改动即可双平台工作。
 * 新代码请直接使用 @/lib/storage。
 */

import {
  backendKind,
  getCloudflareEnv,
  getStore,
  hasStore as hasStoreBackend,
} from "@/lib/storage";
import { detectPlatform } from "@/lib/platform";
import type { Store, UserRecord } from "@/lib/storage/types";

export const KEYS = {
  usersCount: "users:count",
  user: (userId: string) => `user:${userId}`,
  userEmail: (email: string) => `user:email:${email.toLowerCase()}`,
  session: (sessionId: string) => `session:${sessionId}`,
  userSessions: (userId: string) => `user:sessions:${userId}`,
  chat: (userId: string, conversationId: string) => `chat:${userId}:${conversationId}`,
  chatIndex: (userId: string) => `chat:index:${userId}`,
  loginRateLimit: (ip: string) => `ratelimit:login:${ip}`,
  ratelimitUpload: (ip: string) => `ratelimit:upload:${ip}`,
  navData: "nav:data",
  tlds: "tlds:list",
  announcement: "site:announcement",
  siteSettings: "site:settings",
  /** 用户个人设置（含自带 API Key，服务端加密后存储） */
  userSettings: (userId: string) => `user:${userId}:settings`,
  statMessages: "stat:messages",
  /** 邮箱验证码（存的是 code 的 hash，不存明文） */
  emailVerify: (email: string) => `verify:email:${email.toLowerCase()}`,
  /** 发信限流：同一邮箱 / 同一 IP 的重发间隔 */
  ratelimitVerifyEmail: (email: string) => `ratelimit:verify:email:${email.toLowerCase()}`,
  ratelimitVerifyIp: (ip: string) => `ratelimit:verify:ip:${ip}`,
  /** 聊天限流：按用户 id 或 IP 计数的固定 60 秒窗口 */
  ratelimitChat: (subject: string) => `ratelimit:chat:${subject}`,
  /** 创作记录（生图 / 生影片）本体 */
  creation: (userId: string, id: string) => `create:${userId}:${id}`,
  /** 创作记录索引：只存 id，取列表时不加载全部内容 */
  creationIndex: (userId: string) => `create:index:${userId}`,
  /**
   * 竞技场限流。
   *
   * 单独计数、且比聊天宽松：一局辩论/狼人杀会连打几十次模型，
   * 若和普通聊天共用一个 30 次/分钟的窗口，开局没多久就被自己限死了。
   */
  ratelimitArena: (subject: string) => `ratelimit:arena:${subject}`,
} as const;

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天

/** 是否配置了任意可用的存储后端 */
export function hasRedisConfig(): boolean {
  return hasStoreBackend();
}

/**
 * 存储不可用时的提示文案。
 *
 * Upstash 是跨平台统一存储（Vercel / Cloudflare Workers 都用它），
 * 所以两边主提示一致；只有在 Workers 上明确检测到 KV/D1 绑定、
 * 且完全没配 Upstash 时，才给出 KV/D1 的排查方向。
 */
export function storageErrorMessage(): string {
  const cfBindings = Boolean(getCloudflareEnv());
  if (!cfBindings) {
    return "服务端未配置 Upstash Redis，无法完成此操作。请检查环境变量 UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN。";
  }
  return detectPlatform() === "cloudflare"
    ? "未检测到可用存储。请配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（推荐，可与 Vercel 部署共用数据）；或检查 wrangler.jsonc 里的 kv_namespaces 与 d1_databases，ID 需填真实值（不能留 __KV_ID__ / __D1_ID__ 占位符）。"
    : "服务端未配置 Upstash Redis，无法完成此操作。请检查环境变量 UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN。";
}

/** 当前生效的后端名称，用于 /admin 展示与排障 */
export function storageBackend(): string {
  return backendKind();
}

/**
 * 获取存储实例。
 * 命名保留 getRedis 以兼容既有调用点，实际可能是 KV/D1 实现。
 */
export function getRedis(): Store {
  return getStore();
}

/** Hash 全量读取（封装泛型，避免各后端签名差异） */
export async function hgetAll<T>(key: string): Promise<T | null> {
  return getStore().hgetall<T>(key);
}

/** 读取字符串/JSON 值 */
export async function getValue<T = string>(key: string): Promise<T | null> {
  return getStore().get<T>(key);
}

/**
 * 归一化「JSON 值」：不管存储后端返回字符串还是已解析的对象，都返回对象。
 *
 * ⚠️ 为什么需要这个：两个后端的返回形态天然不一致。
 * - Upstash：客户端默认开启 automaticDeserialization，`get` 直接返回**对象**
 * - Cloudflare KV：`get(key, "json")` 也已经解析过，同样是**对象**
 *
 * 于是 `const raw = await getValue(key); JSON.parse(raw)` 等价于
 * `JSON.parse(object)` —— 抛 SyntaxError，且被路由里的 catch 吞掉返回 null。
 * 表现是「对话记录全部消失」，但数据其实一直好好躺在 Redis 里。
 *
 * 只用于**存的是 JSON** 的 key（会话、公告、TLD 缓存等）。
 * 存的是裸字符串（如 userEmail 值）的 key 请继续用 getValue。
 */
export async function getJsonValue<T>(key: string): Promise<T | null> {
  const raw = await getValue<unknown>(key);
  return parseJsonValue<T>(raw);
}

/** 同步版归一化，供已拿到原始值的场景复用 */
export function parseJsonValue<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 读取 Set 成员 */
export async function setMembers(key: string): Promise<string[]> {
  return getStore().smembers(key);
}

/** 按 pattern 列 key */
export async function listKeys(pattern: string): Promise<string[]> {
  return getStore().keys(pattern);
}

/**
 * 列出「用户记录」的 key，即严格匹配 `user:<id>`（id 里不含冒号）。
 *
 * ⚠️ 为什么不能只排除 email / sessions：
 * `user:*` 里还混着 `user:<id>:settings`（自带 Key 同步，存的是加密后的**字符串**）。
 * 对它执行 HGETALL 会触发 Redis 的 WRONGTYPE 错误并抛异常 ——
 * 结果不是"少一条数据"，而是整个用户列表接口 500，
 * 后台表现为「共 0 位用户」+「服务器错误」，管理员完全无法管理账号。
 */
export async function listUserKeys(): Promise<string[]> {
  const keys = await listKeys("user:*");
  return keys.filter((k) => /^user:[^:]+$/.test(k));
}

/**
 * 安全读取用户 hash。
 *
 * 个别脏 key（类型不对、历史遗留数据）不该让整个列表陪葬，
 * 读不出来就跳过这一条。
 */
export async function readUserRecord<T>(key: string): Promise<T | null> {
  try {
    const u = await hgetAll<T>(key);
    return u && (u as unknown as { id?: unknown }).id ? u : null;
  } catch {
    return null;
  }
}

export { hasUpstashConfig } from "@/lib/storage";
export type { Store, UserRecord };
