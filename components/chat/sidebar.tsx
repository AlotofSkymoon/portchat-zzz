"use client";

import * as React from "react";
import Link from "next/link";
import {
  HeartHandshake,
  LogIn,
  MessageSquare,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings2,
  Shield,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { PortchatIcon } from "@/components/portchat-logo";
import { BY_LINE, SITE_NAME, SPONSOR_ENABLED } from "@/lib/site";
import { Button } from "@/components/ui/button";
import type { Conversation } from "@/lib/use-conversations";
import { cn } from "@/lib/utils";

interface SidebarProps {
  conversations: Conversation[];
  currentId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClearAll: () => void;
  onOpenSettings: () => void;
  open: boolean;
  onClose: () => void;
  user: { email: string; role: string } | null;
  /** 桌面端是否收起（宽度归零，主内容区补位） */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

/**
 * 底部行的 Aceternity 风格改良：hover 时有一道柔光横向扫过。
 *
 * 纯 CSS 实现（group-hover + translate），不引入动画库 ——
 * 上次升级因为 peer 依赖冲突折腾过一轮，能不加依赖就不加。
 */
const GLOW_ROW =
  "group relative overflow-hidden rounded-xl transition-colors duration-300 hover:bg-white/[0.06]";
const GLOW_BAR =
  "pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.14] to-transparent transition-transform duration-700 group-hover:translate-x-full";

export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onClearAll,
  onOpenSettings,
  open,
  onClose,
  user,
  collapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  /** 正在重命名的会话 id；null 表示没在编辑 */
  const { t } = useI18n();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  // 进入编辑后自动聚焦并全选，直接打字覆盖最顺手
  React.useEffect(() => {
    if (!editingId) return;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [editingId]);

  function startRename(id: string, current: string) {
    setEditingId(id);
    setDraft(current === t("chat.newChat") ? "" : current);
  }

  function commitRename() {
    if (!editingId) return;
    onRename(editingId, draft);
    setEditingId(null);
  }

  function cancelRename() {
    setEditingId(null);
  }

  return (
    <>
      {/* 移动端遮罩 */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      {/*
        外层控制宽度（可收起），内层保持固定 260px，收起时内容被裁切而非挤压变形。

        桌面端改成 **iOS 26 悬浮卡片**：不贴边、四周留白、整块圆角，
        浮在内容之上而不是像分隔栏那样竖着切一刀。
        移动端保持原来的全屏抽屉（屏幕窄，悬浮会浪费空间）。
      */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 shrink-0 overflow-hidden border-r border-border bg-[hsl(var(--sidebar))] backdrop-blur-xl transition-[width,transform] [transition-duration:420ms] ease-elegant",
          "md:relative md:my-2 md:ml-2 md:h-[calc(100vh-1rem)] md:w-[260px] md:translate-x-0 md:rounded-[22px] md:border md:border-border/60 md:shadow-[0_8px_30px_rgb(0_0_0/0.08)]",
          open ? "w-[260px] translate-x-0" : "w-0 -translate-x-full",
          collapsed && "md:w-0 md:my-0 md:ml-0 md:border-0 md:shadow-none",
        )}
        aria-hidden={collapsed ? true : undefined}
      >
        <div className="flex h-full w-[260px] flex-col md:overflow-hidden md:rounded-[22px]">
          {/* 顶部：Logo + 收起/关闭 */}
          <div className="flex items-center justify-between px-3 py-3">
            <Link href="/" className="flex items-center gap-2">
              {/* 透明底 logo：不加蓝底圆，否则蓝色图形糊在蓝色底上 */}
              <span className="inline-flex h-7 w-7 items-center justify-center">
                <PortchatIcon />
              </span>
              <span className="text-sm font-semibold">{SITE_NAME}</span>
            </Link>
            <div className="flex items-center gap-0.5">
              {onToggleCollapse ? (
                <button
                  onClick={onToggleCollapse}
                  className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:block"
                  aria-label={t("sidebar.collapse")}
                  title={t("sidebar.collapse")}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              ) : null}
              <button
                onClick={onClose}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted md:hidden"
                aria-label={t("sidebar.closeSidebar")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 新对话 */}
          <div className="px-3 pb-2">
            <Button
              onClick={() => {
                onNew();
                onClose();
              }}
              className="w-full justify-start gap-2 bg-[#4D6BFE] text-white hover:bg-[#3757E4]"
              size="sm"
            >
              <Plus className="h-4 w-4" />
              {t("sidebar.newChat")}
            </Button>
          </div>

          {/* 历史对话 */}
          <div className="flex min-h-0 flex-1 flex-col px-3">
            <p className="px-1 pb-1.5 pt-2 text-xs font-medium text-fg-tertiary">{t("sidebar.history")}</p>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {conversations.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {t("sidebar.emptyHistory")}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      data-active={c.id === currentId}
                      className={cn(
                        "liquid-item group flex items-center gap-2 px-2.5 py-2 text-sm",
                        c.id === currentId
                          ? "text-primary"
                          : "text-[hsl(var(--sidebar-foreground))]",
                      )}
                    >
                      {editingId === c.id ? (
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          placeholder={t("sidebar.autoName")}
                          className="min-w-0 flex-1 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm outline-none"
                        />
                      ) : (
                        <button
                          onClick={() => {
                            onSelect(c.id);
                            onClose();
                          }}
                          onDoubleClick={() => startRename(c.id, c.title)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                          <span className="truncate">{c.title}</span>
                        </button>
                      )}
                      <button
                        onClick={() => startRename(c.id, c.title)}
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                        title={t("sidebar.renameTip")}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                        title={t("sidebar.deleteTip")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 底部操作 */}
          <div className="space-y-0.5 border-t border-border px-3 py-2">
            <button
              onClick={onOpenSettings}
              className={`liquid-item ${GLOW_ROW} flex w-full items-center gap-2 px-2.5 py-2 text-sm text-[hsl(var(--sidebar-foreground))]`}
            >
              <span className={GLOW_BAR} aria-hidden />
              <Settings2 className="h-4 w-4" />
              {t("sidebar.settings")}
            </button>
            {user ? (
              <>
                {user.role === "admin" ? (
                  <Link
                    href="/admin"
                    className={`liquid-item ${GLOW_ROW} flex w-full items-center gap-2 px-2.5 py-2 text-sm text-[hsl(var(--sidebar-foreground))]`}
                  >
                    <span className={GLOW_BAR} aria-hidden />
                    <Shield className="h-4 w-4" />
                    {t("sidebar.admin")}
                  </Link>
                ) : null}
                <Link
                  href="/account"
                  className={`liquid-item ${GLOW_ROW} flex w-full items-center gap-2 px-2.5 py-2 text-sm text-[hsl(var(--sidebar-foreground))]`}
                >
                  <span className={GLOW_BAR} aria-hidden />
                  <UserIcon className="h-4 w-4" />
                  <span className="truncate">{user.email}</span>
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className={`liquid-item ${GLOW_ROW} flex w-full items-center gap-2 px-2.5 py-2 text-sm text-[hsl(var(--sidebar-foreground))]`}
              >
                <span className={GLOW_BAR} aria-hidden />
                <LogIn className="h-4 w-4" />
                {t("sidebar.login")}
              </Link>
            )}
            {/* 赞助入口：站长可在环境变量里关掉（NEXT_PUBLIC_SPONSOR_ENABLED=false） */}
            {SPONSOR_ENABLED ? (
              <Link
                href="/sponsor"
                className={`liquid-item ${GLOW_ROW} flex w-full items-center gap-2 px-2.5 py-2 text-sm text-[hsl(var(--sidebar-foreground))]`}
              >
                <span className={GLOW_BAR} aria-hidden />
                <HeartHandshake className="h-4 w-4" />
                {t("sidebar.sponsor")}
              </Link>
            ) : null}
            {/* 署名标识：按 LICENSE 要求保留 */}
            <p className="px-2.5 pt-1.5 text-[10px] text-fg-quaternary">{BY_LINE}</p>
          </div>
        </div>
      </aside>
    </>
  );
}
