"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useI18n } from "@/components/i18n-provider";

/**
 * 全站页面切换过渡（一只纸飞机横飞而过）。
 *
 * ⚠️ 这里刻意**不拦截**点击、不 preventDefault。
 *
 * 直觉做法是在 capture 阶段拦下链接点击、自己 push 路由，但那要依赖
 * Next 的 Link 内部是否检查 defaultPrevented —— 不同版本行为不一致，
 * 一旦它不检查就会出现「跳两次」或导航被吞。
 *
 * 更稳的做法：点击时立刻盖上遮罩，靠 pathname 变化判断导航完成。
 * 页面在遮罩底下完成切换，用户看到的顺序完全一致，
 * 而且完全不干扰 Next 自己的路由行为（预取、滚动、hash 都不受影响）。
 */

type Phase = "idle" | "covering" | "revealing";

/** 遮罩最短停留时间：预取过的页面会瞬间切完，不设下限就只是闪一下 */
const COVER_MIN_MS = 460;
/** 退场时长，需与 CSS `.pt-overlay-exit` 的 420ms 保持一致 */
const REVEAL_MS = 420;
/** 兜底：导航迟迟不结束时强制收起，绝不能让遮罩永久卡住页面 */
const HARD_STOP_MS = 3500;

/**
 * 总开关。
 * NEXT_PUBLIC_ 前缀的变量会在**构建时**内联进客户端 bundle，
 * 所以要在构建环境里给（Actions 部署的话填进 Secrets 即可）。
 */
function enabled(): boolean {
  return (process.env.NEXT_PUBLIC_PAGE_TRANSITION ?? "").trim().toLowerCase() !== "false";
}

const DEST_LABELS: Record<string, string> = {
  "/": "route.home",
  "/chat": "route.chat",
  "/sponsor": "route.sponsor",
  "/create": "route.create",
  "/arena": "route.arena",
  "/admin": "route.admin",
  "/account": "route.account",
  "/login": "route.login",
  "/register": "route.register",
  "/pc": "route.pc",
};

function destLabel(path: string): string {
  if (!path) return "";
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  return DEST_LABELS[clean] ?? "";
}

/* --------------------------- 曲速星域 --------------------------- */

/* --------------------------- 过渡遮罩 --------------------------- */

export function PageTransition() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dest, setDest] = useState("");
  const [navDone, setNavDone] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);

  const active = enabled();

  // 事件回调里要读最新值，用 ref 避免把监听器反复解绑重绑
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const fromRef = useRef("");

  const begin = useCallback((target: string) => {
    if (phaseRef.current !== "idle") return;
    fromRef.current = pathRef.current;
    setDest(target);
    setNavDone(false);
    setMinElapsed(false);
    setPhase("covering");
  }, []);

  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      // 修饰键 / 中键通常是「新标签页打开」，不该被遮罩拦住
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.defaultPrevented) return;

      const el = e.target as HTMLElement | null;
      const anchor = el?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;

      const targetAttr = anchor.getAttribute("target");
      if (targetAttr && targetAttr !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const raw = anchor.getAttribute("href");
      if (!raw || raw.startsWith("#")) return;
      if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(raw)) return;

      let url: URL;
      try {
        url = new URL(raw, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // 同页内的锚点 / 查询变化不算「切换页面」
      if (url.pathname === window.location.pathname) return;

      begin(url.pathname + url.search);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [begin, active]);

  // 浏览器前进/后退：拿不到目标地址，只显示主文案
  useEffect(() => {
    if (!active) return;
    const onPop = () => begin("");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [begin, active]);

  // 导航完成：目标路径已生效
  useEffect(() => {
    if (phase !== "covering") return;
    if (fromRef.current && pathname !== fromRef.current) setNavDone(true);
  }, [phase, pathname]);

  useEffect(() => {
    if (phase !== "covering") return;
    const t = window.setTimeout(() => setMinElapsed(true), COVER_MIN_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // 两者都满足才收起：既不会闪，也不会卡在等一个永远不来的导航
  useEffect(() => {
    if (phase === "covering" && minElapsed && navDone) setPhase("revealing");
  }, [phase, minElapsed, navDone]);

  useEffect(() => {
    if (phase !== "covering") return;
    const t = window.setTimeout(() => setPhase("revealing"), HARD_STOP_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing") return;
    const t = window.setTimeout(() => setPhase("idle"), REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (!active || phase === "idle") return null;

  const leaving = phase === "revealing";
  // 路由名现在是词典 key，运行时翻译 —— 写死的话切语言后仍是中文
  const label = t(destLabel(dest));

  return (
    <div
      className={`pt-overlay ${leaving ? "pt-overlay-exit" : "pt-overlay-enter"}`}
      role="status"
      aria-live="polite"
      aria-busy={!leaving}
    >
      <div className="pt-sky" aria-hidden="true">
        <svg viewBox="0 0 300 90" className="pt-sky-svg" preserveAspectRatio="none">
          <path
            className="pt-plane-trail"
            d="M6 52 C 70 34, 150 62, 294 40"
            fill="none"
          />
        </svg>
        <div className="pt-plane">
          <svg viewBox="0 0 64 64" className="pt-plane-svg">
            {/* 机身：一张折好的纸，两个折面 + 中缝 */}
            <path d="M4 30 L60 8 L34 56 L28 38 Z" fill="#FFFFFF" />
            <path d="M4 30 L28 38 L34 56 Z" fill="#DCE6F5" />
            <path d="M4 30 L60 8 L28 38 Z" fill="#F2F6FC" />
            <path d="M28 38 L60 8" stroke="#9FB3D1" strokeWidth="1.1" fill="none" />
          </svg>
        </div>
      </div>

      <p className="pt-title">
        <span className="pt-shimmer">{t("transition.flying")}</span>
        <span className="pt-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>

      {label ? <p className="pt-dest">{label}</p> : null}

      <div className="pt-bar" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
