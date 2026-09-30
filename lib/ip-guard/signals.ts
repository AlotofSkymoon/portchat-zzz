import { parseIp, type ParsedIp } from "./cidr";
import { timeoutSignal } from "@/lib/fetch-timeout";
import { configValue } from "@/lib/runtime-config";

/**
 * IP Guard 的各类检测信号。
 *
 * ⚠️ 为什么拆成"多信号 + 打分"而不是单点判断：
 * 任何单一信号都太容易误伤 ——
 *   公司内网出口、手机 CGNAT、云厂商 NAT、CDN 回源……
 *   都可能让某一条信号亮起来。
 * 单点判断要么漏报严重（免费名单跟不上 VPN 换 IP 的速度），
 * 要么误伤严重（一条就拦，正常访客直接打不开）。
 * 打分制的意义在于：单条命中只记录不拦截，命中多条才拦，
 * 把误判代价压到可接受范围。
 *
 * ⚠️ 统一 fail-open：
 * 每个信号源超时、报错、没配 token，都按 **0 分** 处理，
 * 并且用 ok:false 标记出来便于排查。绝不让"检测失败"变成"拦截"。
 */

export type SignalName = "header" | "asn-hosting" | "ipinfo" | "tor" | "ipip";

export type SignalResult = {
  name: SignalName;
  /** 是否命中（命中记 1 分） */
  hit: boolean;
  points: number;
  /** 命中依据，排查"为什么被拦"时用 */
  detail: string;
  /**
   * 信号源是否真的给出了结论。
   * false = 未配置 / 超时 / 报错，此时该信号按 0 分处理。
   */
  ok: boolean;
  /** ok 为 false 时的原因说明 */
  note: string;
};

/* --------------------------- 一、请求头信号 --------------------------- */

/**
 * CDN 自身的 Via 标识。
 *
 * ⚠️ 为什么要过滤：
 * Cloudflare / Vercel / Netlify 这些平台本身就是反向代理，
 * 它们加的头说明"请求经过了 CDN"，而不是"用户挂了代理"。
 * 把它们算进去，等于给所有访客白送一分 —— 而这一分恰好是拦截线的半数。
 */
const CDN_VIA = /cloudflare|vercel|fly\.io|netlify|fastly|cloudfront/i;

/** 判断请求是否经由 Cloudflare（有 cf-* 头基本可以确定） */
function behindCloudflare(headers: Headers): boolean {
  return Boolean(headers.get("cf-connecting-ip") || headers.get("cf-ray") || headers.get("cf-ipcountry"));
}

/**
 * X-Forwarded-For 记分所需的跳数。
 *
 * ⚠️ 为什么默认是 3 而不是 2：
 * CDN + 源站 这种正常链路本来就会产生 2 跳（Cloudflare 回源、Vercel 转发），
 * 若按 2 跳记分，站点只要套了 CDN 就**永远**白送 1 分 ——
 * 这时任意另一条信号误报就会凑满 2 分把正常访客拦掉。
 * 3 跳以上才像"用户侧还挂了一层代理"。
 *
 * 想自己定就配 IP_GUARD_HEADER_XFF_MIN=2（更敏感）或更大的数（更宽松）。
 */
function xffMinHops(headers: Headers): number {
  const raw = Number(configValue("IP_GUARD_HEADER_XFF_MIN"));
  if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
  // 自动：CDN 在前面时链路天然更长，多给一跳的余量
  return behindCloudflare(headers) ? 3 : 2;
}

/**
 * 请求头里的代理痕迹。
 *
 * 这是唯一零成本、零延迟的信号 —— 不发任何外部请求。
 * 缺点也很明确：头可以伪造，高级代理会直接 strip 掉，
 * 所以它单独命中时永远不该拦人，只作为打分里的辅助票。
 */
export function headerSignal(headers: Headers): SignalResult {
  const hits: string[] = [];

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const ips = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const min = xffMinHops(headers);
    if (ips.length >= min) hits.push(`xff×${ips.length}`);
  }

  const via = (headers.get("via") ?? "").trim();
  if (via && !CDN_VIA.test(via)) hits.push("via");

  if ((headers.get("forwarded") ?? "").trim()) hits.push("forwarded");
  // 老式代理专用头，现代链路里几乎不会正常出现
  if ((headers.get("proxy-connection") ?? "").trim()) hits.push("proxy-connection");

  return {
    name: "header",
    hit: hits.length > 0,
    points: hits.length > 0 ? 1 : 0,
    detail: hits.join(","),
    ok: true,
    note: "",
  };
}

/* --------------------------- 二、Tor 出口名单 --------------------------- */

/**
 * Tor 官方公开的出口节点列表（纯文本，每行一个 IP）。
 *
 * 免费、权威、不需要 token。Tor 用户里相当一部分是正常隐私需求，
 * 但 Tor 也是最常被拿来批量薅羊毛的通道，且名单 100% 准确不会误伤。
 */
const TOR_LIST_URL = "https://check.torproject.org/torbulkexitlist";
const TOR_REFRESH_MS = 24 * 60 * 60 * 1000;
const TOR_TIMEOUT_MS = 6000;

interface TorCache {
  ips: Set<string>;
  fetchedAt: number;
}

let torCache: TorCache | null = null;
let torInflight: Promise<Set<string>> | null = null;

/** 把 IP 归一化成稳定 key（IPv4 / IPv6 都支持） */
function ipKey(parsed: ParsedIp): string {
  return `${parsed.version}:${parsed.words.join("-")}`;
}

export function parseTorList(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parsed = parseIp(line);
    if (parsed) out.add(ipKey(parsed));
  }
  return out;
}

async function loadTorList(): Promise<Set<string>> {
  const now = Date.now();
  if (torCache && now - torCache.fetchedAt < TOR_REFRESH_MS) return torCache.ips;
  // 并发去重：冷启动时多个请求同时触发只拉一次
  if (torInflight) return torInflight;

  torInflight = (async () => {
    try {
      const res = await fetch(TOR_LIST_URL, { signal: timeoutSignal(TOR_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ips = parseTorList(await res.text());
      // 只在解析出内容时才覆盖：拿到空结果时保留旧名单
      if (ips.size > 0) {
        torCache = { ips, fetchedAt: Date.now() };
        return ips;
      }
      return torCache?.ips ?? new Set<string>();
    } catch {
      return torCache?.ips ?? new Set<string>();
    } finally {
      torInflight = null;
    }
  })();

  return torInflight;
}

export async function torSignal(ip: string): Promise<SignalResult> {
  const parsed = parseIp(ip);
  if (!parsed) {
    return { name: "tor", hit: false, points: 0, detail: "", ok: false, note: "IP 无法解析" };
  }
  try {
    const ips = await loadTorList();
    if (ips.size === 0) {
      // 名单没拉到：按 0 分放行，绝不能因为拿不到名单就把人拦掉
      return { name: "tor", hit: false, points: 0, detail: "", ok: false, note: "出口名单不可用" };
    }
    const hit = ips.has(ipKey(parsed));
    return { name: "tor", hit, points: hit ? 1 : 0, detail: hit ? "Tor 出口节点" : "", ok: true, note: "" };
  } catch {
    return { name: "tor", hit: false, points: 0, detail: "", ok: false, note: "检测异常" };
  }
}

/** 供自检接口展示名单加载情况 */
export function torCacheInfo(): { count: number; fetchedAt: number | null } {
  return { count: torCache?.ips.size ?? 0, fetchedAt: torCache?.fetchedAt ?? null };
}

/* --------------------------- 三、ip-api（ASN / hosting） --------------------------- */

/**
 * ip-api.com 免费端点。
 *
 * ⚠️ 为什么用 hosting 而不是它的 proxy 字段：
 * proxy 字段依赖一份更新很慢的 VPN 名单，漏报严重；
 * hosting 反映 ASN 归属（机房 / 住宅），来自 ASN 数据库，准得多也稳得多。
 * 大多数商业 VPN 的出口都落在机房 ASN 上，所以 hosting 反而更能抓到它们。
 *
 * 免费端点仅限非商业用途、约 45 次/分钟，商业站点请关掉：
 *   IP_GUARD_FREE_SOURCE=false
 */
export function freeSourceEnabled(): boolean {
  const raw = configValue("IP_GUARD_FREE_SOURCE");
  if (!raw) return true;
  return raw.toLowerCase() !== "false";
}

export async function asnSignal(ip: string): Promise<SignalResult> {
  if (!freeSourceEnabled()) {
    return { name: "asn-hosting", hit: false, points: 0, detail: "", ok: false, note: "已关闭（IP_GUARD_FREE_SOURCE=false）" };
  }

  // 免费端点不支持 https，只能 http（服务端 fetch 无混合内容问题）
  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,proxy,hosting`;
  try {
    const res = await fetch(url, { signal: timeoutSignal(4000) });
    if (!res.ok) {
      return { name: "asn-hosting", hit: false, points: 0, detail: "", ok: false, note: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { status?: unknown; proxy?: unknown; hosting?: unknown } | null;
    // 该接口用 status 字段表示成败（HTTP 始终是 200）
    if (!data || data.status !== "success") {
      return { name: "asn-hosting", hit: false, points: 0, detail: "", ok: false, note: "接口返回失败" };
    }
    const hosting = data.hosting === true;
    const proxy = data.proxy === true;
    const detail = [hosting ? "hosting" : "", proxy ? "proxy" : ""].filter(Boolean).join(",");
    return { name: "asn-hosting", hit: hosting, points: hosting ? 1 : 0, detail, ok: true, note: "" };
  } catch {
    return { name: "asn-hosting", hit: false, points: 0, detail: "", ok: false, note: "请求超时或失败" };
  }
}

/* --------------------------- 四、IPinfo privacy --------------------------- */

/**
 * IPinfo 的 privacy 对象直接给出 vpn / proxy / tor / hosting 四个布尔值，
 * 覆盖率明显好于 ip-api 的免费名单，免费额度 5 万次/月。
 *
 * 不配 IPINFO_TOKEN 就整条信号跳过（ok:false），不影响其他信号。
 */
export function ipinfoToken(): string {
  return configValue("IPINFO_TOKEN");
}

export async function ipinfoSignal(ip: string): Promise<SignalResult> {
  const tk = ipinfoToken();
  if (!tk) {
    return { name: "ipinfo", hit: false, points: 0, detail: "", ok: false, note: "未配置 IPINFO_TOKEN" };
  }

  const url = `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(tk)}`;
  try {
    const res = await fetch(url, { signal: timeoutSignal(5000) });
    if (!res.ok) {
      // 401/403 = token 无效；429 = 额度用尽。都要显式暴露，否则会误以为"没检测到代理"
      return { name: "ipinfo", hit: false, points: 0, detail: "", ok: false, note: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { privacy?: Record<string, unknown> } | null;
    const p = data?.privacy;
    if (!p) {
      return { name: "ipinfo", hit: false, points: 0, detail: "", ok: false, note: "响应无 privacy 字段" };
    }
    const hitKeys = ["vpn", "proxy", "tor", "hosting"].filter((k) => p[k] === true);
    return {
      name: "ipinfo",
      hit: hitKeys.length > 0,
      points: hitKeys.length > 0 ? 1 : 0,
      detail: hitKeys.join(","),
      ok: true,
      note: "",
    };
  } catch {
    return { name: "ipinfo", hit: false, points: 0, detail: "", ok: false, note: "请求超时或失败" };
  }
}

/* --------------------------- 五、ipip.net 风险画像 --------------------------- */

export type RiskResult = {
  score: number | null;
  behaviors: string[];
  usageType: string | null;
  ok: boolean;
};

export function ipipToken(): string {
  return configValue("IPIP_RISK_TOKEN", "IPIP_TOKEN");
}

/**
 * 命中的风险行为即算命中该信号。
 * 默认看"代理"和"秒拨" —— 这两类是明确的代理工具特征。
 */
export function blockedBehaviors(): string[] {
  const raw = configValue("IP_GUARD_BLOCK_BEHAVIORS").trim();
  if (!raw) return ["代理", "秒拨"];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 风险分阈值。ipip 官方建议 90 分以上可开启访问限制。 */
export function riskThreshold(): number {
  const raw = Number(configValue("IP_GUARD_RISK_THRESHOLD"));
  if (!Number.isFinite(raw) || raw <= 0) return 90;
  return Math.min(100, Math.max(1, raw));
}

export async function ipipSignal(ip: string): Promise<SignalResult & RiskResult> {
  const tk = ipipToken();
  if (!tk) {
    return {
      name: "ipip", hit: false, points: 0, detail: "", ok: false, note: "未配置 IPIP_RISK_TOKEN",
      score: null, behaviors: [], usageType: null,
    };
  }

  const url = `https://ipapi.ipip.net/v2/risk/portrait/${encodeURIComponent(ip)}?token=${encodeURIComponent(tk)}`;
  try {
    const res = await fetch(url, { signal: timeoutSignal(5000) });
    if (!res.ok) {
      return {
        name: "ipip", hit: false, points: 0, detail: "", ok: false, note: `HTTP ${res.status}`,
        score: null, behaviors: [], usageType: null,
      };
    }
    const data = (await res.json()) as { ret?: unknown; data?: unknown } | null;
    // 该接口用 ret="err" 表示失败（此时 HTTP 仍是 200），必须认这个字段
    if (!data || data.ret !== "ok") {
      return {
        name: "ipip", hit: false, points: 0, detail: "", ok: false, note: "接口返回失败",
        score: null, behaviors: [], usageType: null,
      };
    }

    const d = data.data as
      | { usage_type?: unknown; risk?: { score?: unknown; behavior?: unknown } }
      | undefined;
    if (!d) {
      return {
        name: "ipip", hit: false, points: 0, detail: "", ok: false, note: "响应无 data",
        score: null, behaviors: [], usageType: null,
      };
    }

    const behaviors: string[] = [];
    const list = d.risk?.behavior;
    if (Array.isArray(list)) {
      for (const item of list) {
        const name = (item as { name?: unknown })?.name;
        if (typeof name === "string" && name.trim()) behaviors.push(name.trim());
      }
    }

    const scoreRaw = d.risk?.score;
    const score = typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : null;
    const usageType = typeof d.usage_type === "string" ? d.usage_type : null;

    const hitBehavior = behaviors.filter((b) => blockedBehaviors().some((x) => b.includes(x)));
    const overScore = score !== null && score >= riskThreshold();
    const hit = hitBehavior.length > 0 || overScore;

    const detail = [hitBehavior.join("、"), overScore ? `风险分 ${score}` : ""].filter(Boolean).join(",");

    return {
      name: "ipip", hit, points: hit ? 1 : 0, detail, ok: true, note: "",
      score, behaviors, usageType,
    };
  } catch {
    return {
      name: "ipip", hit: false, points: 0, detail: "", ok: false, note: "请求超时或失败",
      score: null, behaviors: [], usageType: null,
    };
  }
}
