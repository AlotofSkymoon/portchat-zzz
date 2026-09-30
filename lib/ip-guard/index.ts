import { isIcloudRelay, relayCacheInfo } from "./relay";
import { matchesAny, parseCidr, parseIp, type Cidr } from "./cidr";
import {
  asnSignal,
  blockedBehaviors,
  headerSignal,
  ipinfoSignal,
  ipipSignal,
  ipinfoToken,
  ipipToken,
  riskThreshold,
  torCacheInfo,
  torSignal,
  freeSourceEnabled,
  type SignalResult,
} from "./signals";
import { configValue } from "@/lib/runtime-config";

/**
 * 访问来源检测：拦代理工具，放行 iCloud Private Relay 这类系统中继。
 *
 * ⚠️ 判定方式：多信号组合打分，总分达到阈值才拦截。
 * 单点判断的两种极端都不可接受 ——
 *   只看免费名单：覆盖率跟不上 VPN 换 IP 的速度，漏报严重；
 *   一条就拦：公司内网、手机 CGNAT、CDN 回源都会误伤。
 * 打分制下，单条命中只记录不拦截，误判代价被压到最低。
 *
 * ⚠️ 依然保持 fail-open（出错即放行）：
 * IP 情报接口可能超时、token 可能失效、数据源可能抽风。
 * 这些情况下如果把访问者一律拦掉，等于自己把站点搞挂 ——
 * 而且挂掉的方式极具迷惑性（用户以为是自己网络有问题）。
 * 所以任何拿不到结论的情况都放行，只拦截"明确凑够分数"的。
 */

/* --------------------------- 配置 --------------------------- */

export function ipGuardEnabled(): boolean {
  return configValue("IP_GUARD_ENABLED").trim() !== "false";
}

/**
 * 拦截分数线。默认 2 —— 单条信号命中不拦，两条及以上才拦。
 *
 * 想更严格（一条就拦）配 IP_GUARD_BLOCK_SCORE=1；
 * 想更宽松配 3。注意 1 会显著抬高误伤率，不建议在没观察过的情况下使用。
 */
export function blockScore(): number {
  const raw = Number(configValue("IP_GUARD_BLOCK_SCORE"));
  if (!Number.isFinite(raw) || raw <= 0) return 2;
  return Math.floor(raw);
}

/** 是否放行已登录管理员（避免站长把自己锁在门外） */
function adminBypass(): boolean {
  return configValue("IP_GUARD_ADMIN_BYPASS").trim() !== "false";
}

/**
 * 永久放行的 IP 白名单（CIDR，逗号分隔）。
 *
 * ⚠️ 为什么必须有这个：
 * 一旦真拦截（返回 403 而不是弹提示），误判的代价就从"多点一下"
 * 变成"彻底打不开"。而企业网络和国内 CGNAT 移动网络被判成代理非常常见 ——
 * 站长自己很可能就在这种网络里，一开功能就把自己锁在门外，
 * 且此时他已经没法登录后台去关掉它了。
 *
 * 白名单是唯一不依赖站点自身的逃生通道。
 */
/**
 * 不做缓存：环境变量在 Worker 里的就绪时机不完全确定，
 * 一旦在首次请求时固化成空值，之后即使配置到位也永远读不到 ——
 * 白名单会静默失效，而它恰恰是误判时唯一的逃生通道。
 * CIDR 解析本身很轻，白名单条目通常只有几条，每次重新解析的开销可忽略。
 */
function allowlist(): Cidr[] {
  const raw = configValue("IP_GUARD_ALLOWLIST").trim();
  const out: Cidr[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      const c = parseCidr(part.trim());
      if (c) out.push(c);
    }
  }
  return out;
}

/** 供自检接口展示白名单条数 */
export function allowlistSize(): number {
  return allowlist().length;
}

/* --------------------------- 取客户端 IP --------------------------- */

/**
 * 从请求头取客户端 IP。
 *
 * 优先级按"可信度"排：
 * - cf-connecting-ip：Cloudflare 注入，平台保证不可伪造，最可信
 * - true-client-ip：Cloudflare Enterprise 同类的另一套头
 * - x-real-ip：多数反向代理会设置
 * - x-forwarded-for：可伪造，只作兜底，且取**第一个**
 *
 * ⚠️ 不要用 x-forwarded-for 的最后一个 —— 那是最靠近服务端的一跳，
 * 在多层代理下会拿到 CDN/网关自己的 IP，检测就失去了意义。
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("true-client-ip"),
    headers.get("x-real-ip"),
  ];
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (v) return v;
  }

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}

/* --------------------------- 结果缓存 --------------------------- */

/**
 * 按 IP 缓存检测结果。
 *
 * ⚠️ 为什么要缓存：
 * 站点每个页面都可能触发一次检测，而 ipip / ipinfo 都按次计费 ——
 * 不缓存的话同一个人刷新几次就把额度烧光了。
 */
const RESULT_TTL_MS = 10 * 60 * 1000;
/**
 * 用普通对象而不是 Map：
 * 项目 tsconfig 没有显式 target（Next 构建时才设成 ES2017），
 * 直接 for...of 遍历 Map 会触发 TS2802（ES5 下迭代 Map 需要 downlevelIteration）。
 * 对象 + Object.keys 在任何 target 下都能编译。
 */
const resultCache: Record<string, { at: number; verdict: IpVerdict }> = Object.create(null);

export type IpVerdict = {
  allowed: boolean;
  /**
   * 判定原因：
   * ok=正常放行、relay=中继放行、allowlist=白名单放行、
   * proxy=达标已拦截、error=检测失败放行、no-ip=取不到IP放行、disabled=功能关闭
   */
  reason: "ok" | "relay" | "allowlist" | "proxy" | "error" | "no-ip" | "disabled";
  ip: string | null;
  relay: boolean;
  /** ipip 风险分（付费源独有，其他源为 null） */
  score: number | null;
  behaviors: string[];
  usageType: string | null;
  /** 各信号的命中与得分明细，排查"为什么没拦住"就看这个 */
  signals: SignalResult[];
  /** 累计得分 */
  points: number;
  /** 当前拦截分数线 */
  threshold: number;
  /** 实际给出结论的信号数（0 表示检测整体没跑起来） */
  activeSignals: number;
  cached: boolean;
};

function emptyVerdict(
  reason: IpVerdict["reason"],
  ip: string | null,
  extra: Partial<IpVerdict> = {},
): IpVerdict {
  return {
    allowed: true,
    reason,
    ip,
    relay: false,
    score: null,
    behaviors: [],
    usageType: null,
    signals: [],
    points: 0,
    threshold: blockScore(),
    activeSignals: 0,
    cached: false,
    ...extra,
  };
}

function evictExpired(now: number): void {
  const keys = Object.keys(resultCache);
  // 顺手清理，避免缓存无限增长
  if (keys.length < 512) return;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const entry = resultCache[k];
    if (entry && now - entry.at > RESULT_TTL_MS) delete resultCache[k];
  }
}

/* --------------------------- 主判定 --------------------------- */

/**
 * 判定一个 IP 是否允许访问。
 *
 * @param isAdmin 为 true 时直接放行（管理员不该被自己的规则锁在外面）
 * @param headers 请求头。传入才会启用"请求头信号"（零成本，建议传）。
 */
export async function checkIp(
  ip: string | null,
  isAdmin = false,
  headers?: Headers,
): Promise<IpVerdict> {
  const threshold = blockScore();

  if (!ipGuardEnabled()) {
    return emptyVerdict("disabled", ip, { threshold });
  }

  if (isAdmin && adminBypass()) {
    return emptyVerdict("ok", ip, { threshold });
  }

  if (!ip) {
    // 拿不到 IP 就放行 —— 宁可漏过也不能把全站拦死
    return emptyVerdict("no-ip", null, { threshold });
  }

  // 白名单优先于一切判定：它是误判时的逃生通道
  const parsed = parseIp(ip);
  if (parsed && allowlist().length > 0 && matchesAny(allowlist(), parsed)) {
    return emptyVerdict("allowlist", ip, { threshold });
  }

  const now = Date.now();
  evictExpired(now);
  const hit = resultCache[ip];
  if (hit && now - hit.at < RESULT_TTL_MS) {
    return { ...hit.verdict, cached: true };
  }

  /**
   * 顺序很关键：先看是不是 iCloud Private Relay。
   * 中继在技术上也"换了 IP"，如果先查风险画像，
   * Apple 的出口段很容易被判成机房/代理 —— 那就白放行了。
   */
  let relay = false;
  try {
    relay = await isIcloudRelay(ip);
  } catch {
    relay = false;
  }

  if (relay) {
    const verdict = emptyVerdict("relay", ip, { relay: true, threshold });
    resultCache[ip] = { at: now, verdict };
    return verdict;
  }

  /**
   * 四个外部信号并发跑。
   *
   * ⚠️ 每个信号内部都自带超时与 try/catch，失败时按 0 分返回（ok:false），
   * 所以这里不需要再包一层 —— 任何一个源抽风都不会影响其他源，也不会拦人。
   */
  const [ipip, ipinfo, asn, tor] = await Promise.all([
    ipipSignal(ip),
    ipinfoSignal(ip),
    asnSignal(ip),
    torSignal(ip),
  ]);

  const signals: SignalResult[] = [ipip, ipinfo, asn, tor];
  if (headers) signals.unshift(headerSignal(headers));

  const points = signals.reduce((sum, s) => sum + s.points, 0);
  const activeSignals = signals.filter((s) => s.ok).length;

  const behaviors = ipip.behaviors;
  const usageType = ipip.usageType ?? (asn.hit ? "机房" : null);

  /**
   * 一个信号都没给出结论 → 检测整体没跑起来 → fail-open 放行。
   * 这是"开关开了 VPN 却能进"最常见的原因，必须显式暴露，
   * 否则看起来跟"检测过、判定为正常"完全一样。
   */
  if (activeSignals === 0) {
    const verdict = emptyVerdict("error", ip, {
      signals,
      points: 0,
      threshold,
      activeSignals: 0,
      usageType,
      score: ipip.score,
      behaviors,
    });
    // 失败结果也缓存，但时间短一些，避免接口恢复后迟迟不生效
    resultCache[ip] = { at: now, verdict };
    return verdict;
  }

  const blocked = points >= threshold;

  const verdict: IpVerdict = {
    allowed: !blocked,
    reason: blocked ? "proxy" : "ok",
    ip,
    relay: false,
    score: ipip.score,
    behaviors,
    usageType,
    signals,
    points,
    threshold,
    activeSignals,
    cached: false,
  };
  resultCache[ip] = { at: now, verdict };
  return verdict;
}

/** 自检用：让 /api/ip-guard 与 /api/health 看出这套检测到底有没有在工作 */
export function ipGuardStatus(): {
  enabled: boolean;
  /** 各信号源是否已配置（未配置的信号会被跳过，按 0 分处理） */
  sources: {
    ipip: boolean;
    ipinfo: boolean;
    asnHosting: boolean;
    tor: boolean;
    header: boolean;
  };
  /** 实际参与打分的信号源数量 */
  activeSources: number;
  blockScore: number;
  riskThreshold: number;
  blockBehaviors: string[];
  allowlist: number;
  relayRanges: number;
  relayFetchedAt: number | null;
  torNodes: number;
  torFetchedAt: number | null;
} {
  const sources = {
    ipip: ipipToken().length > 0,
    ipinfo: ipinfoToken().length > 0,
    asnHosting: freeSourceEnabled(),
    // Tor 名单与请求头信号零配置即可用，恒为 true
    tor: true,
    header: true,
  };
  const relay = relayCacheInfo();
  const tor = torCacheInfo();

  return {
    enabled: ipGuardEnabled(),
    sources,
    activeSources: Object.values(sources).filter(Boolean).length,
    blockScore: blockScore(),
    riskThreshold: riskThreshold(),
    blockBehaviors: blockedBehaviors(),
    allowlist: allowlistSize(),
    relayRanges: relay.count,
    relayFetchedAt: relay.fetchedAt,
    torNodes: tor.count,
    torFetchedAt: tor.fetchedAt,
  };
}

export { riskThreshold } from "./signals";

/** 免费但只能查归属地的接口（不能判断代理），仅供排查时对照 */
export const MYIP_LA = "https://api.myip.la/en?json";
