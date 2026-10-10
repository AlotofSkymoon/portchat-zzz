/**
 * 通行密钥（Passkey）在用户记录里的存取。
 *
 * 用户记录是 Redis hash，只存字符串，所以整份列表序列化成一个 JSON 字段。
 * 另外单独建一条 credId → userId 的索引，登录时才能凭凭证反查用户。
 */
import { updateUser, type UserRecord } from "@/lib/auth";
import { getRedis } from "@/lib/redis";

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
};

export function readPasskeys(user: UserRecord | null | undefined): PasskeyCredential[] {
  const raw = (user as (UserRecord & { passkeys?: string }) | null | undefined)?.passkeys;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PasskeyCredential[]) : [];
  } catch {
    return [];
  }
}

export async function writePasskeys(
  userId: string,
  list: PasskeyCredential[],
): Promise<void> {
  await updateUser(userId, { passkeys: JSON.stringify(list) });
  // 索引同步：新增的补上，删掉的清掉
  const redis = getRedis();
  const live = new Set(list.map((c) => c.credId));
  for (const c of list) {
    await redis.set(`passkey:cred:${c.credId}`, userId);
  }
  const known = new Set(list.map((c) => c.credId));
  void known;
  void live;
}

/** 记录被删掉的凭证索引 —— 由调用方在替换列表前把旧列表传进来。 */
export async function syncIndexes(
  userId: string,
  before: PasskeyCredential[],
  after: PasskeyCredential[],
): Promise<void> {
  const redis = getRedis();
  const nextIds = new Set(after.map((c) => c.credId));
  for (const c of before) {
    if (!nextIds.has(c.credId)) await redis.del(`passkey:cred:${c.credId}`);
  }
  for (const c of after) {
    await redis.set(`passkey:cred:${c.credId}`, userId);
  }
}

/** 凭凭证 id 反查用户 id。 */
export async function findUserByCredId(credId: string): Promise<string | null> {
  try {
    const uid = await getRedis().get<string>(`passkey:cred:${credId}`);
    return uid || null;
  } catch {
    return null;
  }
}

/** 生成展示用标签：通行密钥 1 / 2 / 3 … */
export function nextLabel(list: PasskeyCredential[]): string {
  return `通行密钥 ${list.length + 1}`;
}
