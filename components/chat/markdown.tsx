"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy, Eye, Code2, RefreshCw, Maximize2, Minimize2 } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/**
 * 递归提取 React 子树里的纯文本。
 *
 * ⚠️ rehype-highlight 会把代码切成一堆 <span>（语法高亮），
 * 此时 children 是 ReactElement[] 而不是字符串。
 * 直接 String(children) 会得到 "[object Object],[object Object]…"
 * —— 这就是代码块显示 [object Object] 的原因。
 */
function nodeToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join("");
  if (React.isValidElement(node)) {
    return nodeToText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

interface CodeBlockProps {
  language?: string;
  code: string;
}

/**
 * AI 给的常是 HTML 片段（没有 <html>/<head>）。
 * 直接塞进 iframe 也能渲染，但缺 viewport meta 会让响应式样式在手机上失真，
 * 所以补一层最小骨架。
 */
function buildSrcDoc(code: string) {
  if (/<!doctype\s+html/i.test(code) || /<html[\s>]/i.test(code)) return code;
  return [
    "<!doctype html><html><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width, initial-scale=1'>",
    "<style>html,body{margin:0}</style></head><body>",
    code,
    "</body></html>",
  ].join("");
}

const PREVIEW_HEIGHTS = [320, 520, 780];

function CodeBlock({ language, code }: CodeBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);

  const isHtml = /^(html|htm)$/i.test(language ?? "");
  const [view, setView] = React.useState<"code" | "preview">("code");
  const [nonce, setNonce] = React.useState(0);
  const [heightStep, setHeightStep] = React.useState(0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 忽略 */
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0b0b12]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5 text-[11px] text-white/60">
        <span className="uppercase tracking-wide">{language || "code"}</span>
        <div className="flex items-center gap-1">
          {isHtml ? (
            <button
              type="button"
              onClick={() => setView(view === "code" ? "preview" : "code")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-white/10 hover:text-white",
                view === "preview" ? "bg-white/10 text-white" : "text-white/70",
              )}
            >
              {view === "preview" ? <Code2 className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {view === "preview" ? t("common.showCode") : t("common.preview")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      </div>

      {isHtml && view === "preview" ? (
        <div className="bg-white">
          <div className="flex items-center justify-end gap-1 border-b border-black/10 bg-black/[0.03] px-2 py-1">
            <span className="mr-auto px-1 text-[10px] text-black/45">
              {t("common.previewSandbox")}
            </span>
            <button
              type="button"
              onClick={() => setNonce((n) => n + 1)}
              title={t("common.refresh")}
              className="rounded p-1 text-black/50 hover:bg-black/10 hover:text-black"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setHeightStep((s) => (s + 1) % PREVIEW_HEIGHTS.length)}
              title={t("common.resizePreview")}
              className="rounded p-1 text-black/50 hover:bg-black/10 hover:text-black"
            >
              {heightStep === PREVIEW_HEIGHTS.length - 1 ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </button>
          </div>
          {/*
            sandbox 只给 allow-scripts，**不给 allow-same-origin**：
            这样 iframe 是独立源，脚本能跑（用户要的 enable javascript），
            但碰不到本站 cookie / localStorage / DOM。
            两者同时给就等于放弃隔离，等于把站点暴露给 AI 生成的任意代码。
          */}
          <iframe
            key={nonce}
            title="html-preview"
            className="block w-full border-0"
            style={{ height: PREVIEW_HEIGHTS[heightStep] }}
            srcDoc={buildSrcDoc(code)}
            sandbox="allow-scripts allow-modals allow-forms allow-popups"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <pre className="overflow-x-auto p-3 text-[13px] leading-6">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code({ className: codeClassName, children, node }) {
            // 优先用 AST 里的原始文本，其次递归提取，最后才退回 String()
            const raw =
              nodeToText(
                (node as { children?: unknown[] } | undefined)?.children as React.ReactNode,
              ) || nodeToText(children);
            const text = raw.replace(/\n$/, "");
            const langMatch = /language-(\w+)/.exec(codeClassName ?? "");
            const isBlock = Boolean(langMatch) || text.includes("\n");

            if (!isBlock) {
              return <code className={codeClassName}>{children}</code>;
            }
            return <CodeBlock language={langMatch?.[1]} code={text} />;
          },
          a: ({ children: c, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {c}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
