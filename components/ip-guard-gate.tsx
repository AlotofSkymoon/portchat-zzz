/* 已废弃：代理拦截改由 middleware.ts 在服务端直接返回 403 拦截页。
   这个文件保留仅为历史参考，不再被任何地方 import。 */
"use client";

import * as React from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";

/**
 * 代理访问拦截弹窗。
 *
 * ⚠️ 为什么做成前端提示而不是服务端硬返回 403：
 * 判定依赖第三方 IP 情报接口，而这类接口会超时、会限流、也会误判
 * （企业网络、CGNAT 移动网络都常被标成代理）。
 * 直接 403 的话，一次接口抽风或一次误判就会让访客彻底打不开站点，
 * 而且他们分不清是自己网络坏了还是站点挂了。
 *
 * 弹窗保留了"仍然继续访问"的余地，误判时不至于把人彻底卡死。
 */

interface Verdict {
  allowed: boolean;
  reason: string;
  ip: string | null;
  relay: boolean;
  score: number | null;
  behaviors: string[];
  usageType: string | null;
  points: number;
  threshold: number;
  /** 给出结论的信号数；0 表示检测整体没跑起来 */
  activeSignals: number;
}

export function IpGuardGate() {
  const [verdict, setVerdict] = React.useState<Verdict | null>(null);
  const [dismissed, setDismissed] = React.useState(false);
  const [checking, setChecking] = React.useState(false);

  const run = React.useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/ip-guard", { cache: "no-store" });
      if (!res.ok) return;
      const data: Verdict = await res.json();
      setVerdict(data);
    } catch {
      /* 检测接口失败就当放行，不打扰访客 */
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    void run();
  }, [run]);

  // 放行、没检测出结论、或用户选择继续 —— 都不渲染
  if (!verdict || verdict.allowed || dismissed) return null;
  // 一个信号都没给出结论（接口没配/失败）时不弹，避免误伤
  if (verdict.activeSignals === 0) return null;

  const detail: string[] = [];
  if (verdict.behaviors.length > 0) detail.push(verdict.behaviors.join("、"));
  if (verdict.usageType) detail.push(verdict.usageType);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ip-guard-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      {/* 遮罩：挡住背后的内容，但点击不关闭 —— 关闭需要明确表态 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative w-full max-w-md rounded-[var(--r-2xl)] border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id="ip-guard-title"
              className="text-base font-semibold leading-snug"
            >
              检测到你正在使用代理工具
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-tertiary">
              本站暂不支持通过 VPN、代理或机场节点访问。
            </p>
          </div>
        </div>

        <div className="rounded-[var(--radius-card)] bg-muted/50 px-3.5 py-3 text-xs leading-relaxed text-fg-secondary">
          <p className="font-medium text-fg-secondary">可以这样做：</p>
          <ul className="mt-1.5 space-y-1 text-fg-tertiary">
            <li>· 关闭 VPN / 代理客户端后重新打开页面</li>
            <li>· 手机用户可尝试关闭「私人中继」或切换移动网络</li>
            <li>· 公司 / 校园网络若被误判，可点下方按钮继续访问</li>
          </ul>
        </div>

        {verdict.ip || detail.length > 0 ? (
          <p className="mt-3 text-[11px] leading-relaxed text-fg-quaternary">
            {verdict.ip ? <>识别地址 {verdict.ip}</> : null}
            {verdict.ip && detail.length > 0 ? " · " : null}
            {detail.join(" · ")}
            {verdict.score !== null ? ` · 风险分 ${verdict.score}` : ""}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="flex-1 rounded-xl border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            仍然继续访问
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={checking}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
            {checking ? "检测中" : "重新检测"}
          </button>
        </div>
      </div>
    </div>
  );
}
