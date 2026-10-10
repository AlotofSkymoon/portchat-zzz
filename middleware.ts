import { NextResponse, type NextRequest } from "next/server";

import { blockedJson, blockedPageHtml } from "@/lib/ip-guard/blocked-page";
import { checkIp, clientIpFromHeaders } from "@/lib/ip-guard";

/**
 * 代理访问拦截（真正的服务端拦截，不是前端提示）。
 *
 * ⚠️ 为什么是 middleware.ts 而不是 Next.js 16 新出的 proxy.ts：
 *
 *   proxy.ts 默认跑在 **Node.js runtime**，而 OpenNext（Cloudflare 适配器）
 *   明确不支持 Node.js middleware —— 构建时会直接抛
 *   "Node.js middleware is not currently supported"，整个部署失败。
 *   而 proxy.ts 又不允许指定 runtime: 'edge'（该配置项已移除）。
 *
 *   middleware.ts 虽然从 v16 起被标记 deprecated，但它仍可用且默认 Edge runtime，
 *   是 OpenNext 唯一支持的拦截方式。权衡下来只能选它。
 *
 * ⚠️ 依然保持 fail-open：
 * 接口超时、Apple 清单拉不到 —— 全都放行。
 * 真拦截的代价太高（误判 = 访客彻底打不开），出错时必须让站点照常可用。
 */

/**
 * 诊断响应头。
 *
 * 存在的意义很实际："我开了开关，VPN 却能进" 这种问题
 * 光看页面完全无从下手 —— 不知道是 middleware 压根没跑、
 * 还是跑了但没配置数据源、还是数据源说这不是代理。
 *
 * 有了这个头，一条 curl 就能分清这几种情况：
 *   curl -I https://你的域名/
 * 看不到 X-IP-Guard      → middleware 没运行
 * 看到 allowed(error)    → 跑了，但两个数据源都没给出结论（多半没配 token）
 * 看到 allowed(ok)       → 数据源判定这不是代理
 * 看到 blocked(proxy)    → 判定为代理，已拦截
 */
function guardHeaders(verdict: { allowed: boolean; reason: string; provider?: string }): Headers {
  const h = new Headers();
  const state = verdict.allowed ? "allowed" : "blocked";
  h.set("X-IP-Guard", `${state}(${verdict.reason})`);
  if (verdict.provider) h.set("X-IP-Guard-Provider", verdict.provider);
  h.set("Cache-Control", "no-store");
  return h;
}

/*
 * 会话 cookie 名。
 *
 * ⚠️ 这里**不能** import @/lib/auth：那个模块依赖 Node 运行时 + 数据库驱动，
 * 而 middleware 跑在 Edge runtime，引进来会让构建直接失败。
 * 所以只把 cookie 名抄一份，跟 lib/auth.ts 的 SESSION_COOKIE_NAME 对应。
 */
const SESSION_COOKIE_NAME = "agnes_session";

/**
 * 聊天域名直达。
 *
 * 场景：chat.xyz.ci 这类子域名专门指向聊天，访问根路径就该直接开聊。
 *
 * 落地页回来了，所以恢复「按登录状态分流」：
 *   已登录  → 直接进 /chat
 *   未登录  → 留在落地页，先讲清楚这站能干什么
 *
 * ⚠️ 用 rewrite 而不是 redirect：地址栏保持 chat.xyz.ci 不变，
 * 且不会和页面自身的登录跳转互相打架形成循环。
 *
 * ⚠️ 只看 cookie 存不存在，**不验签**。middleware 跑在 Edge，验签要拉密钥、
 * 查存储，成本太高；而这里只是决定"先看介绍还是直接开聊"，
 * 真正的身份校验仍然由 /chat 和接口层自己做。cookie 是伪造的也没关系 ——
 * 伪造出来的结果只是被送进 /chat，然后被 /chat 自己挡在登录页。
 */
function chatHostRedirect(request: NextRequest, pathname: string) {
  const chatHost = process.env.CHAT_HOST?.trim().toLowerCase();
  if (!chatHost || pathname !== "/") return null;

  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (host !== chatHost) return null;

  if (!request.cookies.get(SESSION_COOKIE_NAME)?.value) return null;

  const url = request.nextUrl.clone();
  url.pathname = "/chat";
  return NextResponse.rewrite(url);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hostRedirect = chatHostRedirect(request, pathname);
  if (hostRedirect) return hostRedirect;

  const ip = clientIpFromHeaders(request.headers);
  if (!ip) return NextResponse.next({ headers: guardHeaders({ allowed: true, reason: "no-ip" }) });

  return (async () => {
    let verdict;
    try {
      // 传入 headers 才会启用零成本的请求头信号
      verdict = await checkIp(ip, false, request.headers);
    } catch {
      // 判定逻辑自身抛错也不能影响访问
      return NextResponse.next({ headers: guardHeaders({ allowed: true, reason: "error" }) });
    }

    if (verdict.allowed) {
      return NextResponse.next({ headers: guardHeaders(verdict) });
    }

    const opts = {
      reason: verdict.reason,
      ip: verdict.ip,
      behaviors: verdict.behaviors,
      usageType: verdict.usageType,
      score: verdict.score,
      hitSignals: verdict.signals.filter((s) => s.hit).map((s) => s.name),
      points: verdict.points,
      threshold: verdict.threshold,
    };

    const isApi = pathname.startsWith("/api/");

    return new NextResponse(isApi ? blockedJson(opts) : blockedPageHtml(opts), {
      status: 403,
      headers: (() => {
        const h = guardHeaders(verdict);
        h.set("Content-Type", isApi ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
        return h;
      })(),
    });
  })();
}

/**
 * 排除静态资源与 Next 内部路径。
 * 不排除的话每个图片/CSS 请求都要跑一次判定，
 * 既浪费额度（免费源有速率限制）又拖慢加载。
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|woff2?|ttf|json|txt|xml)$).*)",
  ],
};
