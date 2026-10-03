"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import {
  CHAT_MODELS,
  PROVIDERS,
  type CustomProviderConfig,
  type ProviderId,
} from "@/lib/config";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string) => void;
  className?: string;
  /** 用户自建的供应商，用于把它们的模型也列进下拉 */
  customProviders?: CustomProviderConfig[];
}

// DeepSeek 入口已移除：站点不提供 DeepSeek Key，界面不再列出
const PROVIDER_ORDER: ProviderId[] = ["agnes", "inkstone"];

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
export function ModelPicker({ value, onChange, className, customProviders = [] }: ModelPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLButtonElement>(null);

  /** 内置 + 自定义，拼成统一的分组列表 */
  const groups = React.useMemo(() => {
    const builtin = PROVIDER_ORDER.map((pid) => ({
      key: pid as string,
      label: PROVIDERS[pid].label,
      items: CHAT_MODELS.filter((m) => m.provider === pid).map((m) => ({
        id: m.id,
        label: m.label,
        desc: m.desc,
      })),
    }));
    const custom = customProviders.map((c) => ({
      key: c.id,
      label: c.label,
      items: c.models.map((id) => ({ id, label: id, desc: t("model.customProvider") })),
    }));
    return [...builtin, ...custom].filter((g) => g.items.length > 0);
  }, [customProviders]);

  const allModels = React.useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const current = allModels.find((m) => m.id === value) ?? allModels[0] ?? CHAT_MODELS[0];

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
    setOpen((v) => {
      if (!v) measure();
      return !v;
    });
  }

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
              {groups.map((g) => (
                <div key={g.key} className="mb-1 last:mb-0">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.label}
                  </div>
                  {g.items.map((m) => {
                    const active = m.id === value;
                    return (
                      <button
                        key={m.id}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
