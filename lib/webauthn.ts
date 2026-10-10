/**
 * WebAuthn / Passkey 服务端校验（不依赖任何第三方库）。
 *
 * 之所以自己写：_passkey 只用到标准里很小一块 ——
 * 解析 attestationObject（CBOR）、取出 COSE 公钥、校验签名。
 * 引一整个 @simplewebauthn/server 进来没必要，而且它在 Edge/Node 双运行时下还要额外适配。
 *
 * 不做的事：不校验 attestation 证书链（浏览器默认返回 fmt=none，
 * 本来就没有证书可验），信任交给「谁能在你设备上解锁」这件事本身。
 */
import { getRedis } from "@/lib/redis";

/* ------------------------------------------------------------------ *
 * 基础工具
 * ------------------------------------------------------------------ */

/** 生成 base64url 随机串。 */
export function randomB64url(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

export function b64urlEncode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Uint8Array {
  const clean = String(text ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = clean.length % 4 === 0 ? "" : "=".repeat(4 - (clean.length % 4));
  const raw = atob(clean + pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
  return buf;
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}
function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/* ------------------------------------------------------------------ *
 * 极小 CBOR 解码器
 * ------------------------------------------------------------------ */

type CborResult<T = unknown> = { value: T; next: number };

/** 只支持定长项 —— COSE / attestationObject 不会用不定长编码。 */
export function cborDecode(bytes: Uint8Array, offset = 0): CborResult {
  const ib = bytes[offset];
  if (ib === undefined) throw new Error("cbor: eof");
  const major = ib >> 5;
  const ai = ib & 0x1f;
  let pos = offset + 1;
  let raw: number | bigint = 0;

  if (ai < 24) {
    raw = ai;
  } else if (ai === 24) {
    raw = bytes[pos];
    pos += 1;
  } else if (ai === 25) {
    raw = u16be(bytes, pos);
    pos += 2;
  } else if (ai === 26) {
    raw = u32be(bytes, pos);
    pos += 4;
  } else if (ai === 27) {
    let hi = u32be(bytes, pos);
    let lo = u32be(bytes, pos + 4);
    raw = BigInt(hi) * BigInt(0x100000000) + BigInt(lo);
    pos += 8;
  } else {
    throw new Error("cbor: unsupported additional info");
  }

  const len = Number(raw);
  if (major === 0) return { value: len, next: pos };
  if (major === 1) return { value: -1 - len, next: pos };
  if (major === 2) {
    const value = bytes.slice(pos, pos + len);
    return { value, next: pos + len };
  }
  if (major === 3) {
    const value = new TextDecoder().decode(bytes.slice(pos, pos + len));
    return { value, next: pos + len };
  }
  if (major === 4) {
    const arr: unknown[] = [];
    let cursor = pos;
    for (let i = 0; i < len; i += 1) {
      const r = cborDecode(bytes, cursor);
      arr.push(r.value);
      cursor = r.next;
    }
    return { value: arr, next: cursor };
  }
  if (major === 5) {
    const map: Record<string, unknown> = {};
    let cursor = pos;
    for (let i = 0; i < len; i += 1) {
      const k = cborDecode(bytes, cursor);
      const v = cborDecode(bytes, k.next);
      map[String(typeof k.value === "bigint" ? k.value.toString() : k.value)] = v.value;
      cursor = v.next;
    }
    return { value: map, next: cursor };
  }
  if (major === 6) {
    const inner = cborDecode(bytes, pos);
    return { value: { __tag: len, value: inner.value }, next: inner.next };
  }
  if (major === 7) return { value: raw, next: pos };
  throw new Error("cbor: bad major type");
}

/* ------------------------------------------------------------------ *
 * COSE 公钥 → SPKI（Web Crypto 只吃 SPKI，不吃 COSE）
 * ------------------------------------------------------------------ */

function derLen(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x81, n]);
  return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff]);
}
function der(tag: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + derLen(body.length).length + body.length);
  out[0] = tag;
  out.set(derLen(body.length), 1);
  out.set(body, 1 + derLen(body.length).length);
  return out;
}
function derInt(bytes: Uint8Array): Uint8Array {
  // DER 整数：最高位为 1 时前面补 0，否则会被当成负数
  const needsPad = bytes.length > 0 && bytes[0] & 0x80;
  const body = needsPad ? concat(new Uint8Array([0]), bytes) : bytes;
  return der(0x02, body);
}
function derBitString(payload: Uint8Array): Uint8Array {
  return der(0x03, concat(new Uint8Array([0x00]), payload));
}

const OID_EC = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_P256 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
const OID_RSA = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);

/** EC2 → P-256 SPKI */
function ec2Spki(x: Uint8Array, y: Uint8Array): Uint8Array {
  const alg = der(0x30, concat(der(0x06, OID_EC), der(0x06, OID_P256)));
  return der(0x30, concat(alg, derBitString(concat(new Uint8Array([0x04]), concat(x, y)))));
}

/** RSA → RSASSA-PKCS1-v1_5 SPKI */
function rsaSpki(n: Uint8Array, e: Uint8Array): Uint8Array {
  const inner = der(0x30, concat(derInt(n), derInt(e)));
  const alg = der(0x30, concat(der(0x06, OID_RSA), der(0x05, new Uint8Array())));
  return der(0x30, concat(alg, derBitString(inner)));
}

/**
 * COSE_Key → { spki, alg }
 * alg 用 COSE 的 3 号位（ES256 = -7，RS256 = -257）。
 */
export function coseToSpki(cose: Record<string, unknown>): {
  spki: Uint8Array;
  alg: "ES256" | "RS256";
} {
  const kty = Number(cose[1]);
  const algNum = Number(cose[3]);
  if (kty === 2) {
    // EC2：crv=1 才是 P-256
    if (Number(cose[-1]) !== 1) throw new Error("unsupported curve");
    const x = cose[-2] as Uint8Array;
    const y = cose[-3] as Uint8Array;
    if (!x || !y || x.length !== 32 || y.length !== 32) throw new Error("bad ec key");
    return { spki: ec2Spki(x, y), alg: algNum === -257 ? "RS256" : "ES256" };
  }
  if (kty === 3) {
    const n = cose[-1] as Uint8Array;
    const e = cose[-2] as Uint8Array;
    if (!n || !e) throw new Error("bad rsa key");
    return { spki: rsaSpki(n, e), alg: "RS256" };
  }
  throw new Error("unsupported key type");
}

/* ------------------------------------------------------------------ *
 * RP 配置
 * ------------------------------------------------------------------ */

export type RpConfig = { rpId: string; origin: string; rpName: string };

/**
 * RP ID 取当前访问域名。
 * 部署在多个域名下时可以用 PASSKEY_RP_ID 覆盖 ——
 * 但注意：一旦改了 RP ID，之前注册的通行密钥全部失效，
 * 所以这个变量上线后就不要再动。
 */
export function rpConfig(request: Request): RpConfig {
  const url = new URL(request.url);
  const rpId = (process.env.PASSKEY_RP_ID || url.hostname).replace(/:\d+$/, "");
  return {
    rpId,
    origin: process.env.PASSKEY_ORIGIN || url.origin,
    rpName: process.env.PASSKEY_RP_NAME || "Portchat",
  };
}

/**
 * 是否要求「可同步的通行密钥」。
 *
 * ⚠️ 诚实说明：WebAuthn 无法识别「是不是 iCloud 钥匙圈」。
 * 能做的只是要求 BE（Backup Eligible）标志位 ——
 * Apple 设备上走 iCloud 钥匙圈的密钥会带这个位，
 * Windows Hello / 单机 Touch ID 这类设备绑定的不带。
 * 想要严格些就保留默认（要求），遇到注册不上再设 PASSKEY_REQUIRE_SYNC=0。
 */
export function requireSyncable(): boolean {
  return process.env.PASSKEY_REQUIRE_SYNC !== "0";
}

/* ------------------------------------------------------------------ *
 * 挑战值（challenge）
 * ------------------------------------------------------------------ */

const CHAL_TTL = 120;
const chalKey = (id: string) => `passkey:chal:${id}`;

export async function saveChallenge(
  payload: { challenge: string; action: "register" | "authenticate"; userId?: string; email?: string },
): Promise<string> {
  const id = randomB64url(16);
  await getRedis().set(chalKey(id), JSON.stringify({ ...payload, at: Date.now() }));
  await getRedis().expire(chalKey(id), CHAL_TTL);
  return id;
}

export async function takeChallenge(id: string): Promise<{
  challenge: string;
  action: "register" | "authenticate";
  userId?: string;
  email?: string;
} | null> {
  const key = chalKey(id);
  const raw = await getRedis().get<string>(key);
  if (!raw) return null;
  await getRedis().del(key); // 一次性，用完即弃
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 注册 / 认证校验
 * ------------------------------------------------------------------ */

export type ParsedCredential = {
  credId: string;
  spki: string;
  alg: "ES256" | "RS256";
  signCount: number;
  /** 可备份（同步）标志，用于判断是不是钥匙圈类密钥 */
  backupEligible: boolean;
  backupState: boolean;
  transports?: string[];
  aaguid: string;
};

export async function verifyRegistration(opts: {
  id: string;
  rawId: string;
  response: { clientDataJSON: string; attestationObject: string; transports?: string[] };
  expected: { challenge: string; rpId: string; origin: string };
}): Promise<ParsedCredential> {
  const clientData = JSON.parse(
    new TextDecoder().decode(b64urlDecode(opts.response.clientDataJSON)),
  ) as { type?: string; challenge?: string; origin?: string };

  if (clientData.type !== "webauthn.create") throw new Error("bad type");
  if (clientData.challenge !== opts.expected.challenge) throw new Error("bad challenge");
  if (clientData.origin !== opts.expected.origin) throw new Error("bad origin");

  const att = cborDecode(b64urlDecode(opts.response.attestationObject))
    .value as Record<string, unknown>;
  const authData = att.authData as Uint8Array;
  if (!authData || authData.length < 55) throw new Error("bad authData");

  const expectHash = await sha256(new TextEncoder().encode(opts.expected.rpId));
  for (let i = 0; i < 32; i += 1) {
    if (authData[i] !== expectHash[i]) throw new Error("bad rpIdHash");
  }

  const flags = authData[32];
  if (!(flags & 0x01)) throw new Error("no user presence");
  if (!(flags & 0x40)) throw new Error("no attested credential data");

  const signCount = u32be(authData, 33);
  const aaguid = b64urlEncode(authData.slice(37, 53));
  const credIdLen = u16be(authData, 53);
  const credIdBytes = authData.slice(55, 55 + credIdLen);
  const coseStart = 55 + credIdLen;
  const cose = cborDecode(authData, coseStart).value as Record<string, unknown>;
  const { spki, alg } = coseToSpki(cose);

  return {
    credId: b64urlEncode(credIdBytes),
    spki: b64urlEncode(spki),
    alg,
    signCount,
    backupEligible: Boolean(flags & 0x08),
    backupState: Boolean(flags & 0x10),
    transports: opts.response.transports,
    aaguid,
  };
}

export async function verifyAssertion(opts: {
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
  credential: { credId: string; spki: string; alg: "ES256" | "RS256"; signCount: number };
  expected: { challenge: string; rpId: string; origin: string };
}): Promise<{ signCount: number }> {
  const clientData = JSON.parse(
    new TextDecoder().decode(b64urlDecode(opts.response.clientDataJSON)),
  ) as { type?: string; challenge?: string; origin?: string };

  if (clientData.type !== "webauthn.get") throw new Error("bad type");
  if (clientData.challenge !== opts.expected.challenge) throw new Error("bad challenge");
  if (clientData.origin !== opts.expected.origin) throw new Error("bad origin");

  const authData = b64urlDecode(opts.response.authenticatorData);
  if (authData.length < 37) throw new Error("bad authData");

  const expectHash = await sha256(new TextEncoder().encode(opts.expected.rpId));
  for (let i = 0; i < 32; i += 1) {
    if (authData[i] !== expectHash[i]) throw new Error("bad rpIdHash");
  }
  if (!(authData[32] & 0x01)) throw new Error("no user presence");

  const signed = concat(authData, await sha256(b64urlDecode(opts.response.clientDataJSON)));
  const key = await crypto.subtle.importKey(
    "spki",
    b64urlDecode(opts.credential.spki) as BufferSource,
    opts.credential.alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    opts.credential.alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: "SHA-256" },
    key,
    b64urlDecode(opts.response.signature) as BufferSource,
    signed as BufferSource,
  );
  if (!ok) throw new Error("bad signature");
  return { signCount: u32be(authData, 33) };
}
