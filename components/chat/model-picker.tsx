"use client";

import * as React from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  ImagePlus,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";

import {
  CHAT_MODELS,
  EFFORT_LEVELS,
  EFFORT_TOKEN_BUDGET,
  IMAGE_MAX_COUNT,
  IMAGE_RATIOS,
  IMAGE_SIZES,
  PROVIDERS,
  type CustomProviderConfig,
  type EffortLevel,
  type ProviderId,
} from "@/lib/config";
import { EffortSlider, effortValueColor } from "@/components/chat/effort-slider";
import { useI18n } from "@/components/i18n-provider";
import { usePresetProviders } from "@/lib/use-preset-providers";
import { useSiteProviderModels } from "@/lib/use-site-models";
import { SPONSOR_ENABLED } from "@/lib/site";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
  /** 用户自建的供应商，用于把它们的模型也列进下拉 */
  customProviders?: CustomProviderConfig[];
  /** 各服务商的 Key，用于判断哪些供应商「没填 Key 就不显示」 */
  keys?: Record<string, string>;
  /** 内置供应商额外追加的模型 id（探测 / 手填），会并进对应分组 */
  extraModels?: Record<string, string[]>;
  /** 推理等级：菜单里第二行可拖，收起时显示在按钮上 */
  effort?: EffortLevel;
  onEffortChange?: (next: EffortLevel) => void;
  /* ---- 功能开关（原先摆在输入栏，现在收进菜单，输入栏只留模型 / 附件 / 发送） ---- */
  thinkingSupported?: boolean;
  thinking?: boolean;
  onThinkingChange?: (on: boolean) => void;
  webSearchSupported?: boolean;
  webSearch?: boolean;
  onWebSearchChange?: (on: boolean) => void;
  imageSupported?: boolean;
  imageBusy?: boolean;
  onGenerateImage?: () => void;
  imageCount?: number;
  onImageCountChange?: (n: number) => void;
  imageRatio?: string;
  onImageRatioChange?: (r: string) => void;
  imageSize?: string;
  onImageSizeChange?: (s: string) => void;
}

/** 四档对应的词条，缺省按 low 处理 */
const EFFORT_KEY: Record<EffortLevel, string> = {
  off: "input.effortOff",
  low: "input.effortLow",
  high: "input.effortHigh",
  max: "input.effortMax",
};

// DeepSeek 入口已移除：站点不提供 DeepSeek Key，界面不再列出
const PROVIDER_ORDER: ProviderId[] = ["agnes", "atriasi", "inkstone", "gateway"];

/** 模型名全是拉丁字符，强制走 Montserrat */
const MONTSERRAT = "Montserrat, -apple-system, BlinkMacSystemFont, system-ui, sans-serif";

const MENU_W = 240; // 15rem，和原来的 w-60 一致
const GAP = 8; // 菜单与按钮的间距
const EDGE = 12; // 距屏幕边缘的最小留白
const MAX_H = 320; // 视觉舒适高度上限
const MIN_H = 168; // 至少能露出两三项

interface Placement {
  /** 菜单左上角的视口坐标 */
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  up: boolean;
}

/**
 * 输入框内的小模型选择框。
 *
 * 之前菜单是 absolute 向上弹的，模型一多就顶出屏幕上沿，
 * 上面几个模型既看不见也点不着。现在改成：
 *   1. 用 portal 挂到 body —— 不再被消息区的 overflow 裁掉；
 *   2. 开菜单时量上下可用空间，哪边宽往哪边弹；
 *   3. 高度压进可用空间内，超出就在菜单内部滚动；
 *   4. 打开后自动把当前选中的模型滚进视野。
 */
export function ModelPicker({
  value,
  onChange,
  className,
  customProviders = [],
  keys = {},
  extraModels = {},
  effort = "low",
  onEffortChange,
  thinkingSupported = false,
  thinking = false,
  onThinkingChange,
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
}: ModelPickerProps) {
  const { t } = useI18n();
  const presetProviders = usePresetProviders();
  /** 管理员添加到站点上的模型 —— 全站可见，不用每人自己加一遍 */
  const siteModels = useSiteProviderModels();
  const [open, setOpen] = React.useState(false);
  /** root = 模型行 + 推理等级滑条 + 功能开关；list = 模型列表；image = 生图参数 */
  const [view, setView] = React.useState<"root" | "list" | "image">("root");
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  /** 内置 + 自定义，拼成统一的分组列表 */
  const groups = React.useMemo(() => {
    const builtin = PROVIDER_ORDER
      // 没填 Key 的内置供应商整个不显示 —— 列出来也调不通，点了就是报错
      .filter((pid) => presetProviders.has(pid) || Boolean((keys[pid] ?? "").trim()))
      .map((pid) => {
        const pl = PROVIDERS[pid].label;
        const base = CHAT_MODELS.filter((m) => m.provider === pid).map((m) => ({
          id: m.id,
          label: m.label,
          desc: m.desc,
          providerLabel: pl,
        }));
        // 用户自己探测/手填追加的模型 + 管理员加到站点上的，去掉与内置重复的再并进去
        const extras = Array.from(new Set([...(extraModels[pid] ?? []), ...(siteModels[pid] ?? [])]))
          .filter((id) => !base.some((m) => m.id === id))
          // 追加模型的说明写具体供应商名，别笼统写「自定义供应商」
          .map((id) => ({ id, label: id, desc: pl, providerLabel: pl }));
        return {
          key: pid as string,
          label: pl,
          items: [...base, ...extras],
        };
      });
    const custom = customProviders.map((c) => ({
      key: c.id,
      label: c.label,
      items: c.models.map((id) => ({ id, label: id, desc: c.label, providerLabel: c.label })),
    }));
    return [...builtin, ...custom].filter((g) => g.items.length > 0);
  }, [customProviders, keys, extraModels, siteModels, t]);

  const allModels = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);

  /**
   * 不同供应商可能有同名模型（都在用自己的 id，名称不改）。
   * 所以「选中」必须限定在某一个分组内判定，否则两个同名项会同时打勾。
   * 当前分组取第一个匹配项所在的分组 —— 保持按 id 优先的既有行为。
   */
  const currentGroupKey = React.useMemo(() => {
    const g = groups.find((gr) => gr.items.some((m) => m.id === value));
    return g ? g.key : null;
  }, [groups, value]);

  const current =
    allModels.find((m) => m.id === value && m.providerLabel === (groups.find((g) => g.key === currentGroupKey)?.label ?? ""))
    ?? allModels.find((m) => m.id === value)
    ?? allModels[0]
    ?? CHAT_MODELS[0];

  /** 量一遍按钮位置，算出菜单该放哪、能多高 */
  const measure = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceUp = r.top - GAP - EDGE;
    const spaceDown = vh - r.bottom - GAP - EDGE;
    // 优先向上；上方放不下才向下（输入框在页面底部，通常上方空间更足）
    const up = spaceUp >= spaceDown || spaceUp >= MAX_H;
    const avail = up ? spaceUp : spaceDown;
    const maxHeight = Math.max(MIN_H, Math.min(MAX_H, avail));

    const width = Math.min(MENU_W, vw - EDGE * 2);
    // 默认贴按钮左沿，靠右放不下就往左收
    const left = Math.min(Math.max(EDGE, r.left), vw - width - EDGE);
    const top = up ? r.top - GAP - maxHeight : r.bottom + GAP;

    setPlacement({ left, top, width, maxHeight, up });
  }, []);

  function toggle() {
    if (!open) {
      measure();
      // 每次打开都回到「模型 + 推理等级」那一页，不残留上次的列表
      setView("root");
    }
    setOpen(!open);
  }

  const effortLabel = t(EFFORT_KEY[effort] ?? "input.effortLow");
  const effortColor = effortValueColor(effort);

  // 打开后把当前项滚进视野，长列表里不用自己找
  React.useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // 滚动 / 缩放时重新定位；真的没空间了就顺手关掉，免得菜单飘在半空
  React.useEffect(() => {
    if (!open) return;
    function reposition() {
      const el = wrapRef.current;
      if (!el) return setOpen(false);
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return setOpen(false);
      measure();
    }
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, measure]);

  /**
   * measure() 里的 top 是按「最大高度」算的，可菜单实际多高取决于内容：
   * root 页只有模型行 + 滑条，比 MAX_H 矮一大截，于是菜单底边停在按钮
   * 上方几百像素处 —— 就是那个「浮在半空」的观感。
   * 这里渲染完再量真实高度，把菜单贴回按钮边上。
   */
  React.useLayoutEffect(() => {
    if (!open || !placement) return;
    const menu = menuRef.current;
    const wrap = wrapRef.current;
    if (!menu || !wrap) return;
    const h = menu.offsetHeight;
    if (!h) return;
    const r = wrap.getBoundingClientRect();
    const vh = window.innerHeight;
    let top: number;
    if (placement.up) {
      top = r.top - GAP - h;
      // 上方连真实高度都塞不下，就退回按最大高度排，让菜单内部滚动
      if (top < EDGE) top = Math.max(EDGE, r.top - GAP - placement.maxHeight);
    } else {
      top = r.bottom + GAP;
      if (top + h > vh - EDGE) top = Math.max(EDGE, vh - EDGE - h);
    }
    // 阈值兜底，避免同值回写把 layout effect 变成死循环
    if (Math.abs(top - placement.top) > 0.5) setPlacement({ ...placement, top });
  }, [open, view, placement]);

  // 点击外部 / Esc 关闭
  React.useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("model.switch")}
        style={{ fontFamily: MONTSERRAT }}
        className={cn(
          "flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-background px-2.5 py-1 font-sans text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
          open && "border-primary/50 text-foreground",
        )}
      >
        <span className="truncate">{current.label}</span>
        {/* 收起态也带档位，跟菜单里那一行对得上；Off 不显示，免得按钮太长 */}
        {effort !== "off" ? (
          <span
            className="shrink-0 text-[11px] opacity-80"
            style={effortColor ? { color: effortColor } : undefined}
          >
            {effortLabel}
          </span>
        ) : null}
        <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && placement
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={{
                fontFamily: MONTSERRAT,
                position: "fixed",
                left: placement.left,
                top: placement.top,
                width: placement.width,
                maxHeight: placement.maxHeight,
              }}
              className="z-[100] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 font-sans shadow-xl shadow-black/10 animate-fade-in"
            >
              {view === "list" ? (
                <div className="mp-view mp-view-list">
                  <button
                    type="button"
                    onClick={() => setView("root")}
                    className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("model.switch")}</span>
                  </button>

                  {groups.map((g) => (
                    <div key={g.key} className="mb-1 last:mb-0">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.label}
                  </div>
                  {g.items.map((m) => {
                    // 同名模型只在该分组内打勾，另一个供应商的同名项不带勾
                    const active = m.id === value && g.key === currentGroupKey;
                    return (
                      <button
                        key={g.key + "|" + m.id}
                        ref={active ? activeRef : undefined}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                          active ? "bg-primary/10" : "hover:bg-muted",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block truncate text-sm",
                              active ? "font-medium text-primary" : "text-foreground",
                            )}
                          >
                            {m.label}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {m.desc}
                          </span>
                        </span>
                        {active ? (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* 想要更多模型：赞助站长，由站长去接新的 API */}
              <div className="mt-1 border-t border-border/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {SPONSOR_ENABLED ? (
                  <Link href="/sponsor" className="underline-offset-2 hover:underline hover:text-foreground">
                    {t("model.moreHint")}
                  </Link>
                ) : (
                  t("model.moreHint")
                )}
              </div>
                </div>
              ) : view === "image" ? (
                <div className="mp-view mp-view-image">
                  <button
                    type="button"
                    onClick={() => setView("root")}
                    className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t("image.settings")}</span>
                  </button>

                  <div className="space-y-3 px-2 pb-1.5">
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-fg-secondary">{t("image.count")}</p>
                      <div className="flex flex-wrap gap-1">
                        {Array.from({ length: IMAGE_MAX_COUNT }, (_, i) => i + 1).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => onImageCountChange?.(n)}
                            className={
                              n === imageCount
                                ? "h-7 min-w-7 rounded-lg border border-primary/40 bg-primary/12 px-2 text-[11px] font-medium text-primary"
                                : "h-7 min-w-7 rounded-lg border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            }
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-fg-secondary">{t("image.ratio")}</p>
                      <div className="grid grid-cols-4 gap-1">
                        {IMAGE_RATIOS.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => onImageRatioChange?.(r)}
                            className={
                              r === imageRatio
                                ? "h-7 rounded-lg border border-primary/40 bg-primary/12 text-[10px] font-medium text-primary"
                                : "h-7 rounded-lg border border-border text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            }
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[11px] font-medium text-fg-secondary">{t("image.quality")}</p>
                      <div className="flex flex-wrap gap-1">
                        {IMAGE_SIZES.map((sm) => (
                          <button
                            key={sm}
                            type="button"
                            onClick={() => onImageSizeChange?.(sm)}
                            className={
                              sm === imageSize
                                ? "h-7 rounded-lg border border-primary/40 bg-primary/12 px-2.5 text-[11px] font-medium text-primary"
                                : "h-7 rounded-lg border border-border px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            }
                          >
                            {sm}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mp-view mp-view-root">
                  {/* 行 1 —— 模型：点进去才展开列表，菜单一开不会就是一长条 */}
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <span className="shrink-0 text-sm text-foreground">{t("model.switch")}</span>
                    <span className="min-w-0 flex-1 truncate text-right text-sm text-muted-foreground">
                      {current.label}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>

                  {/* 行 2 —— 推理等级：数值 + 滑条折到第二行铺满整行 */}
                  <div className="px-2 pb-1 pt-0.5">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-sm text-foreground">{t("input.effort")}</span>
                      <span
                        className="min-w-0 flex-1 truncate text-right text-sm font-medium"
                        style={effortColor ? { color: effortColor } : undefined}
                      >
                        {effortLabel}
                      </span>
                    </div>
                    {onEffortChange ? (
                      <>
                        <EffortSlider
                          level={effort}
                          onChange={onEffortChange}
                          costLabel={t("input.effortCost", {
                            x: String(EFFORT_TOKEN_BUDGET[effort] ?? 1),
                          })}
                          costMaxLabel={t("input.effortCostMax")}
                        />
                        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                          {t("input.effortHint")}
                        </p>
                      </>
                    ) : null}
                  </div>

                  {/* 行 3 —— 功能开关：原先摆在输入栏，现在收进菜单 */}
                  <div className="mt-1 flex items-center gap-1 border-t border-border/60 px-2 pb-0.5 pt-1.5">
                    {thinkingSupported && onThinkingChange ? (
                      <button
                        type="button"
                        onClick={() => onThinkingChange(!thinking)}
                        title={thinking ? t("input.thinkOn") : t("input.thinkOff")}
                        aria-pressed={thinking}
                        aria-label={t("input.think")}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                          thinking
                            ? "bg-primary/12 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <Brain className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {webSearchSupported && onWebSearchChange ? (
                      <button
                        type="button"
                        onClick={() => onWebSearchChange(!webSearch)}
                        title={webSearch ? t("input.webOn") : t("input.webOff")}
                        aria-pressed={webSearch}
                        aria-label={t("input.web")}
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                          webSearch
                            ? "bg-primary/12 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <Globe className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    {imageSupported && onGenerateImage ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            onGenerateImage();
                          }}
                          disabled={imageBusy}
                          title={t("input.imageTip")}
                          aria-label={t("input.image")}
                          aria-busy={imageBusy}
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                            imageBusy
                              ? "bg-primary/12 text-primary"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          {imageBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ImagePlus className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setView("image")}
                          title={t("image.settingsTip")}
                          aria-label={t("image.settings")}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
