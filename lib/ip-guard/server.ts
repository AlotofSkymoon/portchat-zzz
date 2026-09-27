import { headers } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { checkIp, clientIpFromHeaders, type IpVerdict } from "./index";

/**
 * 服务端 IP 拦截判定（页面与接口共用）。
 *
 * ⚠️ 为什么判定必须放在服务端：
 * 之前只做了前端弹窗，用户关掉弹窗照样能用 —— 那不是拦截，是提示。
 * 真正的拦截必须在服务端渲染/接口层完成，客户端拿不到、也绕不过。
 *
 * ⚠️ 为什么不用 middleware / proxy.ts：
 * Next 16 把 middleware.ts 改名成 proxy.ts 并改用 Node runtime，
 * 而 @opennextjs/cloudflare 目前还不支持 proxy.ts（只支持 Edge runtime 的
 * middleware.ts）。更麻烦的是 Edge 打包会把未声明的 process.env.* 静态内联，
 * 导致运行时注入的 token 读不到 —— 结果不是报错，而是检测静默失效、
 * 拦截形同虚设，这种失败方式最难发现。
 *
 * 放在使用 headers() 的服务端组件/路由里，走的是 nodejs runtime，
 * process.env 确定可用，且 headers() 会让路由自动转为动态渲染。
 */

/**
 * 取当前请求的判定结果。
 *
 * 返回 null 表示"不做拦截"（功能未启用 / 取不到请求头 / 判定过程出错）。
 * fail-open 是刻意的：任何异常都不该把站点搞挂。
 */
export async function serverIpVerdict(): Promise<IpVerdict | null> {
  try {
    const h = await headers();
    const ip = clientIpFromHeaders(h);

    // 管理员不拦：站长若自己开着代理，不该把自己锁在门外
    let isAdmin = false;
    try {
      const user = await getCurrentUser();
      isAdmin = user?.role === "admin";
    } catch {
      isAdmin = false;
    }

    return await checkIp(ip, isAdmin);
  } catch {
    return null;
  }
}

/** 是否应当拦下本次请求 */
export async function shouldBlockRequest(): Promise<{ blocked: boolean; verdict: IpVerdict | null }> {
  const verdict = await serverIpVerdict();
  if (!verdict) return { blocked: false, verdict: null };
  return { blocked: !verdict.allowed, verdict };
}
