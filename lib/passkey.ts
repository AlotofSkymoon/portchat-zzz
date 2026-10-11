/**
 * 通行密钥（Passkey）的存取。
 *
 * ⚠️ 为什么独立存、不挂在用户 hash 上（踩过坑，改过一次）：
 *
 * 早期整份列表序列化进用户记录的 `passkeys` 字段。但 Cloudflare 后端把用户
 * 记录映射成 D1 users 表的固定几列 —— 没在映射里的字段会被**静默丢弃**，
 * 写入不报错、读取永远是空。表现就是：绑定返回成功、列表却空、登录永远
 * 说「没有对应的账号」，三个症状一个根因，而且从日志上看不出任何异常。
 *
 * 参考 Cloudreve 的做法：passkey 是**独立表**，有自己的主键，不挂在用户行上。
 * 这里同理 —— 独立 key 存列表，用户记录里那份只作旧数据回退。
 *
 * 另一处对齐 Cloudreve：登录时用 **userHandle 反查用户**作为主路径
 * （对应它的 `ValidateDiscoverableLogin(discoverUserHandle, ...)`），
 * credId 索引只作兜底。userHandle 是 WebAuthn 标准自带的机制，
 * 不依赖任何我们自己建的索引 —— 索引丢了照样能登录。
 */
import { updateUser, type UserRecord } from "@/lib/auth";
import { getRedis, hgetAll, KEYS } from "@/lib/redis";

export type PasskeyCredential = {
  /** 本地主键（随机），用于删除 */
  id: string;
  /** WebAuthn credential id（base64url） */
  credId: string;
  /** 公钥 SPKI（base64url） */
  spki: string;
  alg: "ES256" | "RS256";
  signCount: number;
  label: string;
  createdAt: number;
  lastUsedAt?: number;
  backupEligible: boolean;
  backupState: boolean;
  transports?: string[];
  /**
   * 浏览器在注册时回传的 `credential.id`。
   * 与我们自己从 authData 解出的 credId 字节相同、写法可能不同（填充 / 字符集），
   * 登录时浏览器带回的是**这个**字符串，所以一并存下来做精确比对。
   */
  rawId?: string;
  /** 所属账号 id —— 独立存储后每条凭据自带归属，不依赖索引也能认人 */
  userId?: string;
};

/** 独立存储键：一个用户一份列表 */
const listKey = (userId: string) => `passkeys:${userId}`;
const credKey = (credId: string) => `passkey:cred:${credId}`;

function parseList(raw: unknown): PasskeyCredential[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as PasskeyCredential[];
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PasskeyCredential[]) : [];
  } catch {
    return [];
  }
}

/**
 * 读取某用户绑定的凭据。
 *
 * 先读独立 key；没有则回退到用户记录里的旧字段并**顺手迁移**过来，
 * 老用户不用重新绑定。
 */
export function readPasskeys(user: UserRecord | null | undefined): PasskeyCredential[] {
  return parseList((user as (UserRecord & { passkeys?: string }) | null | undefined)?.passkeys);
}

/** 异步版：走独立存储，并把旧字段的数据迁移过来。 */
export async function loadPasskeys(user: UserRecord): Promise<PasskeyCredential[]> {
  const redis = getRedis();
  let list: PasskeyCredential[] = [];
  try {
    list = parseList(await redis.get(listKey(user.id)));
  } catch {
    list = [];
  }

  // 迁移：独立 key 为空但用户记录里有旧数据 → 搬过来
  if (list.length === 0) {
    const legacy = readPasskeys(user);
    if (legacy.length > 0) {
      list = legacy;
      try {
        await redis.set(
          listKey(user.id),
          JSON.stringify(legacy.map((c) => ({ ...c, userId: user.id }))),
        );
      } catch {
        /* 迁移失败不影响本次读取 */
      }
    }
  }
  return list;
}

/** 写回列表（独立 key 为准，用户记录里的旧字段同步一份以兼容旧读取路径）。 */
export async function writePasskeys(
  userId: string,
  list: PasskeyCredential[],
): Promise<void> {
  const redis = getRedis();
  const stamped = list.map((c) => ({ ...c, userId }));

  // 1) 独立存储 —— 唯一可信来源
  try {
    await redis.set(listKey(userId), JSON.stringify(stamped));
  } catch {
    /* 落到下面兼容写入，不阻断 */
  }

  // 2) 索引：credId → userId（字节相同即视为同一把钥匙）
  for (const c of stamped) {
    try {
      await redis.set(credKey(c.credId), userId);
      if (c.rawId && c.rawId !== c.credId) await redis.set(credKey(c.rawId), userId);
    } catch {
      /* 索引失败不阻断 —— 登录还有 userHandle 兜底 */
    }
  }

  // 3) 兼容：同步写回用户记录字段（旧读取路径 + 数据导出）
  try {
    await updateUser(userId, { passkeys: JSON.stringify(stamped) });
  } catch {
    /* 用户记录写失败无所谓，独立 key 已经存住了 */
  }
}

/**
 * 索引同步：替换列表时清掉已删除的、补上新增的。
 * 签名保持 (userId, before, after)。
 */
export async function syncIndexes(
  userId: string,
  before: PasskeyCredential[],
  after: PasskeyCredential[],
): Promise<void> {
  const redis = getRedis();
  const nextIds = new Set<string>();
  for (const c of after) {
    nextIds.add(c.credId);
    if (c.rawId) nextIds.add(c.rawId);
  }
  for (const c of before) {
    const gone = !nextIds.has(c.credId) && !(c.rawId && nextIds.has(c.rawId));
    if (!gone) continue;
    try {
      await redis.del(credKey(c.credId));
      if (c.rawId) await redis.del(credKey(c.rawId));
    } catch {
      /* 忽略 */
    }
  }
  // 新增的索引由 writePasskeys 统一建
  void userId;
}

/** 单独补写一条 credId → userId 索引。 */
export async function indexCred(credId: string, userId: string): Promise<void> {
  if (!credId) return;
  try {
    await getRedis().set(credKey(credId), userId);
  } catch {
    /* 索引失败不阻断 —— 登录还有 userHandle 兜底 */
  }
}

/** 凭凭证 id 反查用户 id。 */
export async function findUserByCredId(credId: string): Promise<string | null> {
  if (!credId) return null;
  try {
    const uid = await getRedis().get<string>(credKey(credId));
    return uid || null;
  } catch {
    return null;
  }
}

/**
 * 凭 userHandle 反查用户 —— 对应 Cloudreve 的 discoverUserHandle。
 *
 * 注册时写进凭据的 userHandle 就是账号 id 原文，所以这里解出来直接查。
 * 不依赖任何自建索引，是登录时最可靠的一条路。
 */
export async function findUserByHandle(handle: string | null | undefined): Promise<UserRecord | null> {
  if (!handle) return null;
  const id = handle.trim();
  if (!id) return null;
  try {
    const direct = await hgetAll<UserRecord>(KEYS.user(id));
    if (direct?.id) return direct;
  } catch {
    /* 落到下面按邮箱查 */
  }
  try {
    const byEmail = await getRedis().get<string>(KEYS.userEmail(id.toLowerCase()));
    if (byEmail) {
      const u = await hgetAll<UserRecord>(KEYS.user(byEmail));
      if (u?.id) return u;
    }
  } catch {
    /* 都查不到就返回 null */
  }
  return null;
}

/** 生成展示用标签：通行密钥 1 / 2 / 3 … */
export function nextLabel(list: PasskeyCredential[]): string {
  return `通行密钥 ${list.length + 1}`;
}
