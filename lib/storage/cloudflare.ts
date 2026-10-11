import type { Pipeline, SetOptions, Store, UserRecord } from "@/lib/storage/types";
import { pickBinding } from "./binding";

/**
 * Cloudflare 后端：KV + D1。
 *
 * 数据分布：
 * - D1 users 表：用户（需要按 email 反查、需要列全部用户，关系型更合适）
 * - D1 meta 表：users:count 自增计数器（保证"第一个用户是管理员"的原子性）
 * - KV：session、限流计数、会话记录、导航数据、缓存 —— 都是纯 KV 场景
 */

/** KVNamespace 最小类型（避免依赖 @cloudflare/workers-types 造成构建耦合） */
export interface KVLike {
  get(key: string, options?: unknown): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<unknown>;
  delete(key: string): Promise<unknown>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

/** D1 最小类型 */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ success: boolean; error?: string }>;
      first<T = unknown>(col?: string): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[]; success: boolean }>;
    };
    run(): Promise<{ success: boolean }>;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[] }>;
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

export interface CloudflareEnv {
  KV?: KVLike;
  DB?: D1Like;
  /**
   * R2 对象存储绑定（wrangler.jsonc 里的 binding 名固定为 R2）。
   *
   * 有了它，Worker 可以直接读写桶，**完全不需要 Access Key / Secret Key** ——
   * 权限来自 binding 本身，桶是用户自己的，用户天然拥有全部使用权。
   * 这正是 Workers 部署比走 S3 兼容 API 更省事的地方。
   */
  R2?: R2BucketLike;
}

/** R2Bucket 的最小可用接口（R2ObjectBody / head 等只用到这几个方法） */
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<{ body?: ReadableStream; size?: number } | null>;
  head(key: string): Promise<unknown | null>;
  delete(key: string | string[]): Promise<unknown>;
  list?(options?: Record<string, unknown>): Promise<{ objects?: { key: string }[] }>;
}

/* --------------------------- key 路由判断 --------------------------- */

const P_USER_EMAIL = "user:email:";
const P_USER_SESSIONS = "user:sessions:";
const P_USER = "user:";
const P_SESSION = "session:";
const P_RATELIMIT = "ratelimit:";
const P_CHAT = "chat:";
const P_CHAT_INDEX = "chat:index:";
const KEY_USERS_COUNT = "users:count";

/** 是否为 user:{id}（排除 user:email: / user:sessions:） */
function isUserKey(key: string): boolean {
  return (
    key.startsWith(P_USER) && !key.startsWith(P_USER_EMAIL) && !key.startsWith(P_USER_SESSIONS)
  );
}

function isUserEmailKey(key: string): boolean {
  return key.startsWith(P_USER_EMAIL);
}

/** chat:{userId}:{conversationId} —— 单条会话，存 D1 */
function isChatKey(key: string): boolean {
  return key.startsWith(P_CHAT) && !key.startsWith(P_CHAT_INDEX);
}

/** chat:index:{userId} —— 会话索引，由 conversations 表查询得出 */
function isChatIndexKey(key: string): boolean {
  return key.startsWith(P_CHAT_INDEX);
}

/** 从 chat:{userId}:{conversationId} 拆出两段 */
function splitChatKey(key: string): { userId: string; conversationId: string } | null {
  const rest = key.slice(P_CHAT.length);
  const i = rest.indexOf(":");
  if (i <= 0) return null;
  return { userId: rest.slice(0, i), conversationId: rest.slice(i + 1) };
}

/* ------------------------------ 实现 ------------------------------ */

export class CloudflareStore implements Store {
  constructor(private env: CloudflareEnv) {}

  /**
   * 建表 Promise 缓存。
   *
   * ⚠️ 为什么要运行时自动建表：
   * 以前建表只能靠人工访问一次 /api/d1/cshsjk/<token>——
   * GitHub Actions 部署会顺带执行 schema.sql，但**界面部署不会**，
   * 于是走界面部署的人注册时直接报"表不存在"，而且完全不知道该做什么。
   *
   * 建表语句全是 CREATE TABLE / INDEX IF NOT EXISTS，天然幂等，
   * 每次冷启动跑一遍也无害。
   */
  private schemaReady: Promise<void> | null = null;

  private async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        try {
          const statements = D1_SCHEMA.split(";")
            .map((x) => x.trim())
            .filter(Boolean);
          for (const sql of statements) {
            await this.dbBinding.prepare(sql).run();
          }
        } catch {
          /*
           * 建表失败不阻断主流程。
           * 常见原因：库已建好但当前令牌没有 DDL 权限、
           * 或绑定的是只读副本。这时表大概率已存在，硬失败反而更糟。
           */
        }
      })();
    }
    return this.schemaReady;
  }

  private get kv(): KVLike {
    const kv = pickBinding(this.env as unknown as Record<string, unknown>, "kv") as
      | NonNullable<CloudflareEnv["KV"]>
      | undefined;
    if (!kv) throw new Error("Cloudflare 部署缺少 KV 绑定（binding 名应为 KV 或 kv）");
    return kv;
  }

  private get dbBinding(): D1Like {
    const db = pickBinding(this.env as unknown as Record<string, unknown>, "db") as
      | NonNullable<CloudflareEnv["DB"]>
      | undefined;
    if (!db) throw new Error("Cloudflare 部署缺少 D1 绑定（binding 名应为 DB 或 db）");
    return db;
  }

  /** 取 D1 句柄，顺带确保表已建好（首次调用时才真正执行建表） */
  private async db(): Promise<D1Like> {
    await this.ensureSchema();
    return this.dbBinding;
  }

  /* ------------------------------ get ------------------------------ */
  async get<T = unknown>(key: string): Promise<T | null> {
    // 邮箱反查：直接查 users 表（email 已经是 UNIQUE 索引）
    if (isUserEmailKey(key)) {
      const email = key.slice(P_USER_EMAIL.length);
      const row = await (await this.db())
        .prepare("SELECT id FROM users WHERE email = ?")
        .bind(email)
        .first<{ id: string }>();
      return (row?.id as unknown as T) ?? null;
    }

    // 会话正文：conversations + messages 两张表拼回原结构
    if (isChatKey(key)) {
      const parts = splitChatKey(key);
      if (!parts) return null;
      const conv = await (await this.db())
        .prepare(
          "SELECT id, title, model, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?",
        )
        .bind(parts.conversationId, parts.userId)
        .first<{
          id: string;
          title: string;
          model: string;
          created_at: number;
          updated_at: number;
        }>();
      if (!conv) return null;

      const { results } = await (await this.db())
        .prepare("SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC")
        .bind(parts.conversationId)
        .all<{ role: string; content: string; created_at: number }>();

      const messages = (results ?? []).map((m) => {
        // content 可能是 JSON（多模态片段数组），尽量还原；失败则当纯文本
        let content: unknown = m.content;
        try {
          const parsed = JSON.parse(m.content);
          if (Array.isArray(parsed) || typeof parsed === "object") content = parsed;
        } catch {
          /* 纯文本，保持原样 */
        }
        return { role: m.role, content, createdAt: m.created_at };
      });

      return {
        conversationId: conv.id,
        title: conv.title ?? "",
        model: conv.model ?? "",
        createdAt: conv.created_at,
        updatedAt: conv.updated_at,
        messages,
      } as unknown as T;
    }

    const raw = await this.kv.get(key, "json");
    return (raw as T) ?? null;
  }

  /* ------------------------------ set ------------------------------ */
  async set(key: string, value: unknown, opts?: SetOptions): Promise<void> {
    // user:email: 不需要单独存 —— users 表里的 email 列就是索引
    if (isUserEmailKey(key)) return;

    if (isUserKey(key)) {
      // hset 已经负责写 D1；这里若传的是完整用户对象也兼容
      const rec = value as Partial<UserRecord> | null;
      if (rec && typeof rec === "object" && rec.id && rec.email) {
        await this.hset(key, rec as Record<string, unknown>);
      }
      return;
    }

    // 会话正文 → D1：先 upsert 会话，再整段替换消息
    if (isChatKey(key)) {
      const parts = splitChatKey(key);
      if (!parts) return;
      const data = value as
        | { messages?: { role: string; content: unknown; createdAt?: number }[]; model?: string; title?: string; updatedAt?: number; createdAt?: number }
        | null;
      const list = Array.isArray(data?.messages) ? data!.messages! : [];
      const now = Date.now();
      const updatedAt = typeof data?.updatedAt === "number" ? data.updatedAt : now;
      const createdAt = typeof data?.createdAt === "number" ? data.createdAt : now;
      const title = String(data?.title ?? "").slice(0, 200);
      const model = String(data?.model ?? "");

      await (await this.db())
        .prepare(
          `INSERT INTO conversations (id, user_id, title, model, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE conversations.title END,
             model = excluded.model,
             updated_at = excluded.updated_at`,
        )
        .bind(parts.conversationId, parts.userId, title, model, createdAt, updatedAt)
        .run();

      // 整段替换：先清该会话旧消息，再批量写入。
      // 聊天记录是「整体覆盖式保存」，不是增量追加，这样最简单也最不容易不一致。
      const db = await this.db();
      await db.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(parts.conversationId).run();

      if (list.length > 0) {
        const stmts = list.map((m) =>
          db
            .prepare("INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)")
            .bind(
              parts.conversationId,
              String(m.role ?? "user"),
              typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
              typeof m.createdAt === "number" ? m.createdAt : now,
            ),
        );
        // D1 每次 batch 有语句数上限，分片提交
        for (let i = 0; i < stmts.length; i += 50) {
          await db.batch(stmts.slice(i, i + 50));
        }
      }
      return;
    }

    await this.kv.put(key, JSON.stringify(value), opts?.ex ? { expirationTtl: opts.ex } : undefined);
  }

  /* ------------------------------ del ------------------------------ */
  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (isUserKey(key)) {
        const id = key.slice(P_USER.length);
        const res = await (await this.db()).prepare("DELETE FROM users WHERE id = ?").bind(id).run();
        if (res.success) count += 1;
        continue;
      }
      if (isUserEmailKey(key)) {
        const email = key.slice(P_USER_EMAIL.length);
        const res = await (await this.db()).prepare("DELETE FROM users WHERE email = ?").bind(email).run();
        if (res.success) count += 1;
        continue;
      }
      if (isChatKey(key)) {
        const parts = splitChatKey(key);
        if (parts) {
          await (await this.db()).prepare("DELETE FROM messages WHERE conversation_id = ?").bind(parts.conversationId).run();
          await (await this.db())
            .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
            .bind(parts.conversationId, parts.userId)
            .run();
          count += 1;
          continue;
        }
      }
      if (isChatIndexKey(key)) {
        // 清空该用户全部会话：先删消息，再删会话
        const userId = key.slice(P_CHAT_INDEX.length);
        await (await this.db())
          .prepare(
            "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)",
          )
          .bind(userId)
          .run();
        await (await this.db()).prepare("DELETE FROM conversations WHERE user_id = ?").bind(userId).run();
        count += 1;
        continue;
      }
      await this.kv.delete(key);
      count += 1;
    }
    return count;
  }

  /* ----------------------------- exists ---------------------------- */
  async exists(key: string): Promise<number> {
    if (isUserEmailKey(key)) {
      const email = key.slice(P_USER_EMAIL.length);
      const row = await (await this.db())
        .prepare("SELECT 1 AS ok FROM users WHERE email = ?")
        .bind(email)
        .first<{ ok: number }>();
      return row ? 1 : 0;
    }
    if (isUserKey(key)) {
      const id = key.slice(P_USER.length);
      const row = await (await this.db())
        .prepare("SELECT 1 AS ok FROM users WHERE id = ?")
        .bind(id)
        .first<{ ok: number }>();
      return row ? 1 : 0;
    }
    const v = await this.kv.get(key);
    return v === null || v === undefined ? 0 : 1;
  }

  /* ----------------------------- expire ---------------------------- */
  async expire(key: string, seconds: number): Promise<number> {
    if (isUserKey(key) || isUserEmailKey(key)) return 1; // 关系型数据不走 TTL
    const v = await this.kv.get(key, "json");
    if (v === null || v === undefined) return 0;
    await this.kv.put(key, JSON.stringify(v), { expirationTtl: Math.max(60, seconds) });
    return 1;
  }

  /* ------------------------------ incr ----------------------------- */
  async incr(key: string): Promise<number> {
    // users:count 必须原子 —— 用 D1 的 UPDATE ... RETURNING（SQLite 写事务串行化）
    if (key === KEY_USERS_COUNT) {
      await (await this.db())
        .prepare("INSERT INTO meta (k, v) VALUES ('users_count', 0) ON CONFLICT(k) DO NOTHING")
        .run();
      const row = await (await this.db())
        .prepare("UPDATE meta SET v = v + 1 WHERE k = 'users_count' RETURNING v")
        .first<{ v: number }>();
      if (!row) throw new Error("自增 users:count 失败");
      return row.v;
    }

    // 限流计数等：KV 读改写（单 key 低频，可接受）
    const cur = (await this.kv.get(key, "json")) as number | null;
    const next = (typeof cur === "number" ? cur : 0) + 1;
    await this.kv.put(key, JSON.stringify(next));
    return next;
  }

  /* ------------------------------ hset ----------------------------- */
  /**
   * ⚠️ 用户 key 走 D1 的固定列映射，**只认下面这几列**：
   *    id / email / password_hash / role / created_at
   *
   * 任何没在映射里的字段（passkeys、twoFactor、nickname、emailVerified…）
   * 都会被**静默丢弃** —— 写入不报错、读取永远是空。已经踩过一次：
   * Passkey 早先存在用户记录里，绑定返回成功、列表却空、登录永远说
   * 「没有对应的账号」，三个症状一个根因，日志上完全看不出异常。
   *
   * 所以这类数据请**单独存 key**（走下面「非用户 hash → 整体存 JSON」的分支），
   * 不要塞进用户记录。要给用户表加字段的话，必须同步改：
   * schema.sql、这里的 hset 映射、以及 hgetall 的 SELECT 列表，三处缺一不可。
   */
  async hset(key: string, obj: Record<string, unknown>): Promise<number> {
    if (isUserKey(key)) {
      const id = key.slice(P_USER.length);
      const email = String(obj.email ?? "");

      // 拒绝创建「没有邮箱的用户」：会产生脏行，且多个空邮箱会撞 UNIQUE 约束。
      // 正常注册一定会带 email；只更新密码 / 角色时用户必然已存在。
      if (!email) {
        const existing = await (await this.db())
          .prepare("SELECT id FROM users WHERE id = ?")
          .bind(id)
          .first<{ id: string }>();
        if (!existing) return 0;
      }
      const passwordHash = String(obj.passwordHash ?? "");
      // 关键：未提供时必须为空字符串，绝不能给默认值。
      // 否则「改密码」时 role 默认值 "user" 会把管理员降级成普通用户。
      const role = obj.role === undefined || obj.role === null ? "" : String(obj.role);
      const createdAt =
        typeof obj.createdAt === "number"
          ? obj.createdAt
          : Number(obj.createdAt ?? Date.now()) || Date.now();

      // 局部更新要保留未提供的字段：
      // 「改密码」只传 passwordHash，不能把 email / role 冲成空字符串
      await (await this.db())
        .prepare(
          `INSERT INTO users (id, email, password_hash, role, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             email         = CASE WHEN excluded.email <> ''         THEN excluded.email         ELSE users.email END,
             password_hash = CASE WHEN excluded.password_hash <> '' THEN excluded.password_hash ELSE users.password_hash END,
             role          = CASE WHEN excluded.role <> ''          THEN excluded.role          ELSE users.role END,
             created_at    = CASE WHEN excluded.created_at > 0      THEN users.created_at       ELSE users.created_at END`,
        )
        .bind(id, email, passwordHash, role, createdAt)
        .run();
      return 1;
    }

    // 非用户 hash：整体存 JSON
    await this.kv.put(key, JSON.stringify(obj));
    return 1;
  }

  /* ---------------------------- hgetall ---------------------------- */
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    if (isUserKey(key)) {
      const id = key.slice(P_USER.length);
      const row = await (await this.db())
        .prepare("SELECT id, email, password_hash, role, created_at FROM users WHERE id = ?")
        .bind(id)
        .first<{
          id: string;
          email: string;
          password_hash: string;
          role: string;
          created_at: number;
        }>();
      if (!row) return null;
      return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role,
        createdAt: row.created_at,
      } as unknown as T;
    }
    const raw = await this.kv.get(key, "json");
    return (raw as T) ?? null;
  }

  /* ------------------------------ keys ----------------------------- */
  async keys(pattern: string): Promise<string[]> {
    // user:* → 直接查 D1 全表
    if (pattern.startsWith(P_USER) && !pattern.startsWith(P_USER_EMAIL)) {
      const { results } = await (await this.db()).prepare("SELECT id FROM users").all<{ id: string }>();
      return (results ?? []).map((r) => `${P_USER}${r.id}`);
    }
    if (pattern.startsWith(P_USER_EMAIL)) {
      const { results } = await (await this.db()).prepare("SELECT email FROM users").all<{ email: string }>();
      return (results ?? []).map((r) => `${P_USER_EMAIL}${r.email}`);
    }

    // KV：只支持前缀列举，取 "user:*" 的 * 之前部分
    const prefix = pattern.replace(/\*+$/, "");
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix, cursor, limit: 1000 });
      for (const k of page.keys ?? []) out.push(k.name);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
  }

  /* ------------------------------ sadd ----------------------------- */
  async sadd(key: string, ...members: string[]): Promise<number> {
    // 会话索引由 conversations 表天然维护（写会话时已 upsert），无需额外记 Set
    if (isChatIndexKey(key)) return members.length;

    const cur = (await this.kv.get(key, "json")) as string[] | null;
    const set = new Set(Array.isArray(cur) ? cur : []);
    let added = 0;
    for (const m of members) {
      if (!set.has(m)) {
        set.add(m);
        added += 1;
      }
    }
    await this.kv.put(key, JSON.stringify(Array.from(set)));
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    // 会话索引：直接查 conversations 表，按更新时间倒序
    if (isChatIndexKey(key)) {
      const userId = key.slice(P_CHAT_INDEX.length);
      const { results } = await (await this.db())
        .prepare("SELECT id FROM conversations WHERE user_id = ? ORDER BY updated_at DESC")
        .bind(userId)
        .all<{ id: string }>();
      return (results ?? []).map((r) => r.id);
    }
    const cur = (await this.kv.get(key, "json")) as string[] | null;
    return Array.isArray(cur) ? cur : [];
  }

  /* ------------------------------ srem ----------------------------- */
  async srem(key: string, ...members: string[]): Promise<number> {
    const cur = (await this.kv.get(key, "json")) as string[] | null;
    const set = new Set(Array.isArray(cur) ? cur : []);
    let removed = 0;
    for (const m of members) {
      if (set.delete(m)) removed += 1;
    }
    if (removed > 0) await this.kv.put(key, JSON.stringify(Array.from(set)));
    return removed;
  }

  /* ---------------------------- pipeline --------------------------- */
  pipeline(): Pipeline {
    const tasks: (() => Promise<unknown>)[] = [];
    const self = this;
    const pipe: Pipeline = {
      set(key: string, value: unknown, opts?: SetOptions) {
        tasks.push(() => self.set(key, value, opts));
        return pipe;
      },
      del(...keys: string[]) {
        tasks.push(() => self.del(...keys));
        return pipe;
      },
      sadd(key: string, ...members: string[]) {
        tasks.push(() => self.sadd(key, ...members));
        return pipe;
      },
      srem(key: string, ...members: string[]) {
        tasks.push(() => self.srem(key, ...members));
        return pipe;
      },
      hset(key: string, obj: Record<string, unknown>) {
        tasks.push(() => self.hset(key, obj));
        return pipe;
      },
      async exec() {
        const out: unknown[] = [];
        // 顺序执行（D1 batch 需要预编译语句，这里简单顺序执行更易维护）
        for (const t of tasks) out.push(await t());
        return out;
      },
    };
    return pipe;
  }
}

/* --------------------------- D1 建表语句 --------------------------- */

export const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT DEFAULT '',
  model       TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS site_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;
