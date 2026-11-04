/**
 * 拦截页 HTML。
 *
 * 直接拼字符串而不是用 React 组件，是因为它在 middleware 里返回 ——
 * middleware 只能回 Response，走不了组件渲染。
 *
 * 样式内联，且用 `prefers-color-scheme` 自适应明暗：
 * 拦截发生在站点 JS/CSS 加载之前，此时没有任何主题变量可用，
 * 不内联的话页面会是浏览器默认的白底黑字，在深色模式下非常刺眼。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BlockedPageOptions {
  reason: string;
  ip: string | null;
  behaviors: string[];
  usageType: string | null;
  score: number | null;
  /** 命中的信号名（打分制下展示"为什么被拦"） */
  hitSignals?: string[];
  points?: number;
  threshold?: number;
}

export function blockedPageHtml(opts: BlockedPageOptions): string {
  const detail: string[] = [];
  if (opts.behaviors.length > 0) detail.push(opts.behaviors.join("、"));
  if (opts.usageType) detail.push(opts.usageType);
  if (opts.score !== null) detail.push(`风险分 ${opts.score}`);
  if (opts.hitSignals && opts.hitSignals.length > 0) detail.push(`命中信号 ${opts.hitSignals.join("、")}`);
  if (opts.points !== undefined && opts.threshold !== undefined) {
    detail.push(`得分 ${opts.points}/${opts.threshold}`);
  }

  const ip = opts.ip ? escapeHtml(opts.ip) : "";
  const detailText = detail.length > 0 ? escapeHtml(detail.join(" · ")) : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>无法访问</title>
<style>
  :root {
    --bg: #f6f7f9;
    --card: #ffffff;
    --fg: #16181d;
    --fg-dim: #5b6472;
    --border: #e3e6ea;
    --accent: #b45309;
    --accent-bg: #fef3c7;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1014;
      --card: #171a20;
      --fg: #e8eaed;
      --fg-dim: #9aa3b0;
      --border: #262b33;
      --accent: #fbbf24;
      --accent-bg: #3a2f14;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Hiragino Sans GB", "Microsoft YaHei", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
  }
  .card {
    width: 100%;
    max-width: 480px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 32px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.08);
  }
  .icon {
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 14px;
    background: var(--accent-bg);
    color: var(--accent);
    font-size: 22px;
    margin-bottom: 18px;
  }
  h1 { margin: 0 0 8px; font-size: 19px; font-weight: 600; letter-spacing: .01em; }
  .lead { margin: 0 0 20px; color: var(--fg-dim); font-size: 14px; }
  ul { margin: 0; padding-left: 20px; color: var(--fg-dim); font-size: 13.5px; }
  li { margin-bottom: 6px; }
  .meta {
    margin-top: 22px; padding-top: 16px;
    border-top: 1px solid var(--border);
    color: var(--fg-dim); font-size: 12px;
    word-break: break-all;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon" aria-hidden="true">&#9888;</div>
    <h1>当前网络无法访问本站</h1>
    <p class="lead">检测到你正在通过代理工具访问，本站暂不提供此类访问。</p>
    <ul>
      <li>关闭 VPN / 代理客户端后重试</li>
      <li>手机用户可尝试切换移动网络，或关闭“限制 IP 地址跟踪”</li>
      <li>公司 / 校园网络若为误判，请联系站长加入白名单</li>
    </ul>
    ${ip || detailText ? `<div class="meta">${ip ? `识别地址 <code>${ip}</code>` : ""}${ip && detailText ? " · " : ""}${detailText}</div>` : ""}
  </div>
</body>
</html>`;
}

/** API 请求被拦时返回 JSON，避免客户端把 HTML 当 JSON 解析而报出莫名错误 */
export function blockedJson(opts: BlockedPageOptions): string {
  return JSON.stringify({
    error: "PROXY_BLOCKED",
    message: "检测到代理访问，已拒绝。",
    reason: opts.reason,
    ip: opts.ip,
    behaviors: opts.behaviors,
    hitSignals: opts.hitSignals ?? [],
    points: opts.points ?? 0,
    threshold: opts.threshold ?? 0,
  });
}
