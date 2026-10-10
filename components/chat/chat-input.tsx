"use client";

import * as React from "react";
import {
  ArrowUp,
  FileText,
  FileVideo,
  Paperclip,
  Plus,
  Square,
  X,
} from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { ModelPicker } from "@/components/chat/model-picker";
import { type CustomProviderConfig, type EffortLevel } from "@/lib/config";
import { formatBytes, type Attachment } from "@/lib/types";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  /** 空状态时用大号样式 */
  variant?: "default" | "hero";
  model?: string;
  onModelChange?: (modelId: string) => void;
  /** 用户自建供应商，透传给模型选择框 */
  customProviders?: CustomProviderConfig[];
  /** 各服务商的 Key（没填 Key 的供应商不在下拉里显示） */
  keys?: Record<string, string>;
  /** 内置供应商额外追加的模型 id */
  extraModels?: Record<string, string[]>;
  placeholder?: string;
  /* ---- 附件 ---- */
  attachments?: Attachment[];
  onPickFiles?: (files: FileList | File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  /* ---- 思考模式 ---- */
  /** 当前模型是否支持思考模式（不支持时不显示开关） */
  thinkingSupported?: boolean;
  thinking?: boolean;
  onThinkingChange?: (on: boolean) => void;
  /** 思考强度（档位越高，模型想得越久、烧掉的 token 越多） */
  effort?: EffortLevel;
  onEffortChange?: (v: EffortLevel) => void;
  /* ---- 联网搜索 ---- */
  /** 站点是否开放联网搜索（站长可关） */
  webSearchSupported?: boolean;
  webSearch?: boolean;
  onWebSearchChange?: (on: boolean) => void;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  variant = "default",
  model,
  onModelChange,
  customProviders = [],
  keys,
  extraModels,
  placeholder,
  attachments = [],
  onPickFiles,
  onRemoveAttachment,
  thinkingSupported = false,
  thinking = false,
  onThinkingChange,
  effort = "low",
  onEffortChange,
  webSearchSupported = false,
  webSearch = false,
  onWebSearchChange,
}: ChatInputProps) {
  const { t } = useI18n();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  // 自适应高度
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  // 粘贴文件（截图直接 Ctrl+V）
  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length && onPickFiles) {
      e.preventDefault();
      onPickFiles(files);
    }
  }

  const isHero = variant === "hero";

  return (
    <div
      className={
        isHero
          ? "liquid-glass w-full !rounded-[28px] px-4 pb-3 pt-3.5 focus-within:!border-[hsl(var(--primary)/0.5)]"
          : "liquid-glass w-full !rounded-[26px] px-3 pb-2.5 pt-3 focus-within:!border-[hsl(var(--primary)/0.5)]"
      }
    >
      {/* 附件预览 */}
      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="group inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border/70 bg-muted/60 py-1 pl-1.5 pr-1 text-xs"
            >
              {a.kind === "image" && a.content ? (
                <img
                  src={a.content}
                  alt={a.name}
                  className="h-6 w-6 shrink-0 rounded object-cover"
                />
              ) : a.kind === "video" ? (
                <FileVideo className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : a.kind === "text" ? (
                <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" />
              )}
              <span className="truncate text-fg-secondary">{a.name}</span>
              <span className="shrink-0 text-[10px] text-fg-quaternary">
                {formatBytes(a.size)}
              </span>
              {a.note ? (
                <span className="shrink-0 text-[10px] text-amber-500" title={a.note}>
                  !
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemoveAttachment?.(a.id)}
                className="ml-0.5 shrink-0 rounded p-0.5 text-fg-tertiary transition-colors hover:bg-background hover:text-destructive"
                aria-label={t("common.removeNamed", { name: a.name })}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        placeholder={placeholder ?? t("input.placeholder")}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className={
          isHero
            ? "w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-fg-quaternary"
            : "max-h-[200px] w-full resize-none bg-transparent px-1 text-[15px] leading-6 outline-none placeholder:text-fg-quaternary"
        }
      />

      {/* 底部操作行：附件「+」在最左，模型选择器与发送靠右 */}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        {/* 附件：+ 号，最左端 */}
        <div className="flex items-center gap-1.5">
          {onPickFiles ? (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title={t("input.attachTip")}
                aria-label={t("input.attach")}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) onPickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          ) : null}
        </div>

        {/* 右侧组：模型选择器 + 发送 / 停止 */}
        <div className="flex items-center gap-1.5">
          {model && onModelChange ? (
            <ModelPicker
              value={model}
              onChange={onModelChange}
              customProviders={customProviders}
              keys={keys}
              extraModels={extraModels}
              effort={effort}
              onEffortChange={onEffortChange}
              thinkingSupported={thinkingSupported}
              thinking={thinking}
              onThinkingChange={onThinkingChange}
              webSearchSupported={webSearchSupported}
              webSearch={webSearch}
              onWebSearchChange={onWebSearchChange}
            />
          ) : null}

          {streaming ? (
            <button
              onClick={onStop}
              className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm transition-colors hover:bg-muted"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {t("input.stop")}
            </button>
          ) : (
            <button
              onClick={onSubmit}
              disabled={!value.trim() && attachments.length === 0}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4D6BFE] text-white transition-all hover:bg-[#3757E4] disabled:cursor-not-allowed disabled:bg-muted disabled:text-fg-quaternary"
              title={t("input.send")}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
