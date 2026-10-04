"use client";

import * as React from "react";
import {
  ArrowUp,
  Brain,
  Globe,
  FileText,
  FileVideo,
  ImagePlus,
  Loader2,
  Paperclip,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { ModelPicker } from "@/components/chat/model-picker";
import {
  IMAGE_MAX_COUNT,
  IMAGE_RATIOS,
  IMAGE_SIZES,
  type CustomProviderConfig,
} from "@/lib/config";
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
  /** 思考强度（OpenAI 标准 reasoning_effort；Agnes 服务端会忽略） */
  effort?: "low" | "medium" | "high";
  onEffortChange?: (v: "low" | "medium" | "high") => void;
  /* ---- 联网搜索 ---- */
  /** 站点是否开放联网搜索（站长可关） */
  webSearchSupported?: boolean;
  webSearch?: boolean;
  onWebSearchChange?: (on: boolean) => void;
  /* ---- 图片生成 ---- */
  /** 站点是否开放生图（站长可关） */
  imageSupported?: boolean;
  /** 是否正在生成图片 */
  imageBusy?: boolean;
  onGenerateImage?: () => void;
  /* ---- 生图参数 ---- */
  imageCount?: number;
  onImageCountChange?: (n: number) => void;
  imageRatio?: string;
  onImageRatioChange?: (r: string) => void;
  imageSize?: string;
  onImageSizeChange?: (s: string) => void;
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
  effort = "medium",
  onEffortChange,
  webSearchSupported = false,
  webSearch = false,
  onWebSearchChange,
  imageSupported = true,
  imageBusy = false,
  onGenerateImage,
  imageCount = 1,
  onImageCountChange,
  imageRatio = "1:1",
  onImageRatioChange,
  imageSize = "1K",
  onImageSizeChange,
}: ChatInputProps) {
  const { t } = useI18n();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [imgPanelOpen, setImgPanelOpen] = React.useState(false);
  const imgPanelRef = React.useRef<HTMLDivElement>(null);

  // 点击面板外或按 Esc 就收起
  React.useEffect(() => {
    if (!imgPanelOpen) return;
    function onDown(e: MouseEvent) {
      if (imgPanelRef.current && !imgPanelRef.current.contains(e.target as Node)) {
        setImgPanelOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setImgPanelOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [imgPanelOpen]);

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

      <div className="mt-2 flex items-center justify-between gap-2">
        {/* 左侧：模型选择小框 + 附件按钮 */}
        <div className="flex min-w-0 items-center gap-1.5">
          {model && onModelChange ? (
            <ModelPicker
              value={model}
              onChange={onModelChange}
              customProviders={customProviders}
              keys={keys}
              extraModels={extraModels}
            />
          ) : null}
          {thinkingSupported && onThinkingChange ? (
            <button
              type="button"
              onClick={() => onThinkingChange(!thinking)}
              title={
                thinking
                  ? t("input.thinkOn")
                  : t("input.thinkOff")
              }
              aria-pressed={thinking}
              className={
                thinking
                  ? "flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/12 px-2.5 text-[11px] font-medium text-primary transition-colors"
                  : "flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11px] text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
              }
            >
              <Brain className="h-3.5 w-3.5" />
              {t("input.think")}
            </button>
          ) : null}
          {thinking && thinkingSupported && onEffortChange ? (
            <div className="flex h-7 shrink-0 items-center rounded-full border border-border px-0.5 text-[11px]">
              {(["low", "medium", "high"] as const).map((lv) => (
                <button
                  key={lv}
                  type="button"
                  onClick={() => onEffortChange(lv)}
                  title={t(`input.effort${lv[0].toUpperCase()}${lv.slice(1)}` as never)}
                  aria-pressed={effort === lv}
                  className={
                    effort === lv
                      ? "h-6 rounded-full bg-primary/12 px-2 font-medium text-primary transition-colors"
                      : "h-6 rounded-full px-2 text-fg-tertiary transition-colors hover:text-foreground"
                  }
                >
                  {t(`input.effort${lv[0].toUpperCase()}${lv.slice(1)}` as never)}
                </button>
              ))}
            </div>
          ) : null}
          {webSearchSupported && onWebSearchChange ? (
            <button
              type="button"
              onClick={() => onWebSearchChange(!webSearch)}
              title={
                webSearch
                  ? t("input.webOn")
                  : t("input.webOff")
              }
              aria-pressed={webSearch}
              className={
                webSearch
                  ? "flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/12 px-2.5 text-[11px] font-medium text-primary transition-colors"
                  : "flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11px] text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
              }
            >
              <Globe className="h-3.5 w-3.5" />
              {t("input.web")}
            </button>
          ) : null}
          {imageSupported && onGenerateImage ? (
            <div ref={imgPanelRef} className="relative flex shrink-0 items-center gap-1">
              {imgPanelOpen ? (
                <div className="absolute bottom-full left-0 z-50 mb-2 w-[15rem] space-y-3 rounded-2xl border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
                  {/* 张数 */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-fg-secondary">
                      {t("image.count")}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: IMAGE_MAX_COUNT }, (_, i) => i + 1).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => onImageCountChange?.(n)}
                          className={
                            n === imageCount
                              ? "h-7 min-w-7 rounded-lg border border-primary/40 bg-primary/12 px-2 text-[11px] font-medium text-primary"
                              : "h-7 min-w-7 rounded-lg border border-border px-2 text-[11px] text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
                          }
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 宽高比 */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-fg-secondary">
                      {t("image.ratio")}
                    </p>
                    <div className="grid grid-cols-4 gap-1">
                      {IMAGE_RATIOS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => onImageRatioChange?.(r)}
                          className={
                            r === imageRatio
                              ? "h-7 rounded-lg border border-primary/40 bg-primary/12 text-[10px] font-medium text-primary"
                              : "h-7 rounded-lg border border-border text-[10px] text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
                          }
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 尺寸档位 */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-fg-secondary">
                      {t("image.quality")}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {IMAGE_SIZES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => onImageSizeChange?.(s)}
                          className={
                            s === imageSize
                              ? "h-7 rounded-lg border border-primary/40 bg-primary/12 px-2.5 text-[11px] font-medium text-primary"
                              : "h-7 rounded-lg border border-border px-2.5 text-[11px] text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
                          }
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                onClick={onGenerateImage}
                disabled={imageBusy}
                title={t("input.imageTip")}
                aria-label={t("input.image")}
                aria-busy={imageBusy}
                className={
                  imageBusy
                    ? "flex h-7 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/12 px-2.5 text-[11px] font-medium text-primary"
                    : "flex h-7 shrink-0 items-center gap-1 rounded-full border border-border px-2.5 text-[11px] text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
                }
              >
                {imageBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {t("input.image")}
              </button>

              <button
                type="button"
                onClick={() => setImgPanelOpen((v) => !v)}
                title={t("image.settingsTip")}
                aria-label={t("image.settings")}
                aria-expanded={imgPanelOpen}
                className={
                  imgPanelOpen
                    ? "flex h-7 w-7 items-center justify-center rounded-full border border-primary/40 bg-primary/12 text-primary"
                    : "flex h-7 w-7 items-center justify-center rounded-full text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
                }
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {onPickFiles ? (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title={t("input.attachTip")}
                aria-label={t("input.attach")}
                className="flex h-7 w-7 items-center justify-center rounded-full text-fg-tertiary transition-colors hover:bg-muted hover:text-foreground"
              >
                <Paperclip className="h-3.5 w-3.5" />
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

        {/* 右侧：发送 / 停止 */}
        <div className="flex shrink-0 items-center gap-2">
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
