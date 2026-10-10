"use client";

import * as React from "react";
import { useState } from "react";
import {
  Brain,
  Check,
  Globe,
  ChevronDown,
  Copy,
  FileDown,
  FileText,
  FileVideo,
  RotateCw,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { UniversalVideoPlayer } from "@/components/chat/universal-video-player";

import { PotAvatar } from "@/components/pot-avatar";
import { ImageLightbox } from "@/components/chat/image-lightbox";
import { Markdown } from "@/components/chat/markdown";
import { Button } from "@/components/ui/button";
import { formatBytes, type ChatMessage } from "@/lib/types";

interface MessageBubbleProps {
  message: ChatMessage;
  onRetry?: () => void;
  isStreaming?: boolean;
}

/**
 * 联网搜索来源列表。
 *
 * 结果可能几十条，全铺开会把回答挤到看不见，
 * 所以默认只显示前 6 条，其余折叠，点一下展开。
 */
function SearchSources({ sources }: { sources: { title: string; url: string }[] }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 6;

  const shown = expanded ? sources : sources.slice(0, PREVIEW);
  const hidden = sources.length - shown.length;

  /** 取域名做副标题，比整条 URL 好认得多 */
  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  return (
    <div className="mb-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-tertiary">
        <Globe className="h-3 w-3" />
        {t("chat.sources")}（{sources.length}）
      </p>

      <ol className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {shown.map((src, i) => {
          const host = hostOf(src.url);
          return (
            <li key={src.url}>
              <a
                href={src.url}
                target="_blank"
                rel="noreferrer noopener"
                title={src.title || src.url}
                className="group block rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
              >
                <span className="flex items-center gap-1.5 text-[11px] leading-relaxed text-fg-secondary group-hover:text-primary">
                  <span className="shrink-0 font-mono text-[10px] text-fg-tertiary">
                    {i + 1}
                  </span>
                  <span className="line-clamp-2">{src.title || src.url}</span>
                </span>
                {host ? (
                  <span className="mt-0.5 block truncate pl-[18px] text-[10px] text-fg-tertiary">
                    {host}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ol>

      {hidden > 0 || expanded ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-[11px] text-fg-tertiary transition-colors hover:text-primary"
        >
          <ChevronDown className={expanded ? "h-3 w-3 rotate-180 transition-transform" : "h-3 w-3 transition-transform"} />
          {expanded ? t("chat.collapseList") : `${t("chat.expandRest")} ${hidden} ${t("chat.itemsUnit")}`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 思考过程展示块。
 *
 * 流式输出时默认展开（让用户看到模型正在推理），并带呼吸感的「思考中」提示；
 * 出完后自动收起，点标题可再展开 —— 不占正文篇幅，想看又能看到。
 */
function ThinkingBlock({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming: boolean;
}) {
  const { t } = useI18n();
  // 流式时跟着展开，结束后默认收起
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg-tertiary transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium">
          {streaming ? t("chat.thinking") : t("chat.thoughtDone")}
        </span>
        {streaming ? (
          <span className="h-1 w-1 animate-caret rounded-full bg-primary" />
        ) : null}
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
            open ? "" : "-rotate-90"
          }`}
        />
      </button>
      {open ? (
        <div className="max-h-64 overflow-y-auto border-t border-border/50 px-3 py-2">
          <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg-tertiary">
            {reasoning}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** 语言标注 → 文件扩展名 */
function extFromLang(lang: string): string {
  const map: Record<string, string> = {
    ts: "ts", typescript: "ts", tsx: "tsx",
    js: "js", javascript: "js", jsx: "jsx", mjs: "mjs",
    py: "py", python: "py",
    json: "json", yaml: "yaml", yml: "yml",
    html: "html", css: "css", scss: "scss",
    sh: "sh", bash: "sh", sql: "sql",
    go: "go", rs: "rs", java: "java", c: "c", cpp: "cpp", cs: "cs",
    md: "md", markdown: "md", txt: "txt",
  };
  return map[lang.toLowerCase().trim()] ?? "txt";
}

/** 抽出 Markdown 里的代码块，优先取最长的那一段 */
function extractCodeBlocks(text: string): { lang: string; code: string }[] {
  const re = /```([\w+-]*)\n([\s\S]*?)```/g;
  const out: { lang: string; code: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ lang: m[1] ?? "", code: m[2] ?? "" });
  }
  return out.sort((a, b) => b.code.length - a.code.length);
}

export function MessageBubble({ message, onRetry, isStreaming }: MessageBubbleProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<{ src: string; name: string } | null>(null);
  const isUser = message.role === "user";

  /**
   * 「AI 编辑并输出新版」的落地动作。
   *
   * 用户上传原文件 → 让 AI 改写 → 点「下载新版」拿到改好的文件。
   * 优先抽取代码块（按语言标注决定扩展名），没有代码块则保存全文。
   */
  const codeBlocks = React.useMemo(
    () => extractCodeBlocks(message.content),
    [message.content],
  );
  const hasCodeBlock = codeBlocks.length > 0;

  function downloadNewVersion() {
    const block = codeBlocks[0];
    const content = block?.code ?? message.content;
    const ext = block?.lang ? extFromLang(block.lang) : "txt";
    const base = (block?.lang ? `new-version` : "ai-output").replace(/[^\w.-]/g, "");
    const filename = `${base}${codeBlocks.length > 1 ? `-${codeBlocks.length}` : ""}.${ext}`;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 交给浏览器完成下载后再回收
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`${t("chat.savedAs")} ${filename}`);
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success(t("chat.copied"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("chat.copyFailed"));
    }
  }

  /* ---------------- 用户消息：右侧蓝色气泡 ---------------- */
  if (isUser) {
    const atts = message.attachments ?? [];
    return (
      <>
      <div className="flex animate-fade-in flex-col items-end gap-1.5">
        {/* 附件 */}
        {atts.length > 0 ? (
          <div className="flex max-w-[85%] flex-col items-end gap-2 sm:max-w-[75%]">
            {atts.map((a) => (
              <div key={a.id} className="flex flex-col items-end gap-1.5">
                {a.kind === "video" && a.content ? (
                  /* 视频：原生格式直接播，wmv/mpg 等用内置解码器转码后播 */
                  <div className="w-[min(420px,75vw)]">
                    <UniversalVideoPlayer src={a.content} name={a.name} />
                  </div>
                ) : (
                  <span className="inline-flex max-w-[200px] items-center gap-1.5 rounded-lg border border-border/70 bg-muted/60 py-1 pl-1.5 pr-2 text-xs">
                    {a.kind === "image" && a.content ? (
                      <button
                        type="button"
                        onClick={() => setPreview({ src: a.content!, name: a.name })}
                        className="shrink-0 rounded transition-opacity hover:opacity-80"
                        title={t("chat.viewOriginal")}
                      >
                        <img
                          src={a.content}
                          alt={a.name}
                          className="h-6 w-6 rounded object-cover"
                        />
                      </button>
                    ) : a.kind === "video" ? (
                      <FileVideo className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate text-fg-secondary">{a.name}</span>
                    <span className="shrink-0 text-[10px] text-fg-quaternary">{formatBytes(a.size)}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="msg-user max-w-[85%] rounded-[1.65rem] rounded-br-[0.6rem] bg-[hsl(var(--user-bubble))] px-4 py-2.5 text-[15px] leading-[1.75] text-[hsl(var(--user-bubble-foreground))] sm:max-w-[75%]">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : null}
      </div>
      {preview ? (
        <ImageLightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />
      ) : null}
      </>
    );
  }

  /* ---------------- 助手消息：左侧头像 + 纯文本 ---------------- */
  return (
    /* msg-assistant：Anthropic 主题下会换成衬线体（Claude 的标志性设计） */
    <div className="msg-assistant flex animate-fade-in gap-3">
      {/* 头像：Pot（透明底，不需要蓝色圆底衬托） */}
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center">
        <PotAvatar />
      </div>

      <div className="min-w-0 flex-1">
        {/* 思考过程：有内容才渲染，流式时默认展开并显示"思考中" */}
        {message.reasoning ? (
          <ThinkingBlock
            reasoning={message.reasoning}
            streaming={Boolean(isStreaming) && !message.reasoningDone}
          />
        ) : null}

        {/* 联网搜索来源：条数可能很多，默认折叠只显示前几条 */}
        {message.sources?.length ? (
          <SearchSources sources={message.sources} />
        ) : null}
        {message.error ? (
          <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message.error}</span>
            </div>
            {onRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RotateCw className="h-4 w-4" />
                {t("chat.retry")}
              </Button>
            ) : null}
          </div>
        ) : message.content ? (
          <>
            <Markdown content={message.content} />
            {isStreaming ? (
              <span className="ml-0.5 inline-block h-4 w-[2px] animate-caret bg-foreground align-middle" />
            ) : null}
          </>
        ) : (
          <div className="flex items-center gap-1.5 py-2" aria-label={t("chat.generating")}>
            <span className="h-1.5 w-1.5 animate-dot rounded-full bg-primary [animation-delay:-0.6s]" />
            <span className="h-1.5 w-1.5 animate-dot rounded-full bg-primary [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-dot rounded-full bg-primary" />
          </div>
        )}

        {/* 操作栏：复制 / 存为新版文件 */}
        {message.content && !message.error && !isStreaming ? (
          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={copyMessage}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t("chat.copy")}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {hasCodeBlock ? (
              <button
                onClick={downloadNewVersion}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t("chat.downloadNewTip")}
              >
                <FileDown className="h-3.5 w-3.5" />
                {t("chat.downloadNew")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
