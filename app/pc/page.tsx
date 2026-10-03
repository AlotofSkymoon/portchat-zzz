"use client";

import * as React from "react";
import Link from "next/link";
import {
  Calculator as CalculatorIcon,
  Clock,
  Info,
  NotebookPen,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * 云电脑 —— 本站的"奇怪功能"。
 *
 * 一个跑在浏览器里的迷你桌面环境：可以开窗口、拖动、最小化，
 * 内置几个小程序（终端 / 记事本 / 计算器 / 时钟 / 关于本机）。
 *
 * 为什么做它：
 *   纯聊天站太单薄，这里给访客一个能动手玩的东西。
 *   所有数据都存在浏览器本地，不上传任何内容。
 */

/* ------------------------------ 窗口管理 ------------------------------ */

interface WinState {
  id: string;
  app: AppId;
  x: number;
  y: number;
  z: number;
  minimized: boolean;
}

type AppId = "terminal" | "notes" | "calculator" | "clock" | "about";

const APPS: Record<AppId, { label: string; icon: React.ReactNode }> = {
  // label 存词典 key：语言切换后要跟着变
  terminal: { label: "pc.terminal", icon: <TerminalIcon className="h-5 w-5" /> },
  notes: { label: "pc.notes", icon: <NotebookPen className="h-5 w-5" /> },
  calculator: { label: "pc.calculator", icon: <CalculatorIcon className="h-5 w-5" /> },
  clock: { label: "pc.clock", icon: <Clock className="h-5 w-5" /> },
  about: { label: "pc.about", icon: <Info className="h-5 w-5" /> },
};

export default function CloudPcPage() {
  const { t } = useI18n();
  const [wins, setWins] = React.useState<WinState[]>([]);
  const [topZ, setTopZ] = React.useState(10);
  const desktopRef = React.useRef<HTMLDivElement>(null);

  /** 打开应用：已开则取消最小化并置顶 */
  const open = React.useCallback(
    (app: AppId) => {
      setWins((prev) => {
        const exist = prev.find((w) => w.app === app);
        const z = topZ + 1;
        if (exist) {
          return prev.map((w) =>
            w.app === app ? { ...w, minimized: false, z } : w,
          );
        }
        // 新窗口层叠排布，避免完全重叠
        const offset = prev.length * 28;
        return [
          ...prev,
          {
            id: `${app}-${Date.now()}`,
            app,
            x: 80 + offset,
            y: 70 + offset,
            z,
            minimized: false,
          },
        ];
      });
      setTopZ((z) => z + 1);
    },
    [topZ],
  );

  const close = React.useCallback((id: string) => {
    setWins((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimize = React.useCallback((id: string) => {
    setWins((prev) => prev.map((w) => (w.id === id ? { ...w, minimized: true } : w)));
  }, []);

  const focus = React.useCallback((id: string) => {
    setTopZ((z) => {
      const nz = z + 1;
      setWins((prev) => prev.map((w) => (w.id === id ? { ...w, z: nz, minimized: false } : w)));
      return nz;
    });
  }, []);

  /** 拖动窗口：按下标题栏后跟随指针 */
  const startDrag = React.useCallback(
    (id: string, e: React.PointerEvent) => {
      e.preventDefault();
      focus(id);
      const win = wins.find((w) => w.id === id);
      if (!win) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const origX = win.x;
      const origY = win.y;

      const onMove = (ev: PointerEvent) => {
        setWins((prev) =>
          prev.map((w) =>
            w.id === id
              ? { ...w, x: origX + ev.clientX - startX, y: origY + ev.clientY - startY }
              : w,
          ),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [wins, focus],
  );

  return (
    <div
      ref={desktopRef}
      className="relative h-screen-safe overflow-hidden bg-gradient-to-br from-[hsl(var(--background))] via-[hsl(var(--background))] to-[hsl(var(--primary)/0.10)]"
    >
      {/* 顶栏 */}
      <header className="ios-glass absolute inset-x-3 top-3 z-[60] flex items-center justify-between rounded-[var(--radius-ios-lg)] px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/chat" className="text-sm font-medium text-primary hover:underline">
            {t("pc.back")}
          </Link>
          <span className="text-xs text-fg-tertiary">{t("pc.localNote")}</span>
        </div>
        <ThemeToggle />
      </header>

      {/* 桌面图标区 */}
      <div className="absolute left-6 top-24 flex flex-col gap-3">
        {(Object.keys(APPS) as AppId[]).map((app) => (
          <button
            key={app}
            onClick={() => open(app)}
            className="group flex w-20 flex-col items-center gap-1.5 rounded-2xl p-2 text-center transition-transform hover:scale-105"
          >
            <span className="ios-glass flex h-12 w-12 items-center justify-center rounded-2xl text-primary">
              {APPS[app].icon}
            </span>
            <span className="text-[11px] text-fg-secondary group-hover:text-foreground">
              {APPS[app].label}
            </span>
          </button>
        ))}
      </div>

      {/* 窗口 */}
      {wins
        .filter((w) => !w.minimized)
        .map((w) => (
          <div
            key={w.id}
            style={{ left: w.x, top: w.y, zIndex: w.z }}
            onPointerDown={() => focus(w.id)}
            className="absolute w-[min(560px,92vw)] overflow-hidden rounded-[var(--radius-ios-xl)] border border-[hsl(var(--glass-border)/0.6)] bg-[hsl(var(--popover)/0.92)] shadow-2xl backdrop-blur-2xl"
          >
            {/* 标题栏：拖动区 + 红绿灯 */}
            <div
              onPointerDown={(e) => startDrag(w.id, e)}
              className="flex cursor-grab items-center gap-2 border-b border-border/60 bg-[hsl(var(--muted)/0.5)] px-3 py-2 active:cursor-grabbing"
            >
              <div className="flex gap-1.5">
                <button
                  onClick={() => close(w.id)}
                  className="h-3 w-3 rounded-full bg-[#FF5F57] transition hover:brightness-90"
                  aria-label={t("pc.close")}
                />
                <button
                  onClick={() => minimize(w.id)}
                  className="h-3 w-3 rounded-full bg-[#FEBC2E] transition hover:brightness-90"
                  aria-label={t("pc.minimize")}
                />
                <span className="h-3 w-3 rounded-full bg-[#28C840]" />
              </div>
              <span className="ml-2 select-none text-xs font-medium text-fg-secondary">
                {APPS[w.app].label}
              </span>
            </div>
            <div className="max-h-[60vh] overflow-auto p-4">
              <AppView app={w.app} />
            </div>
          </div>
        ))}

      {/* Dock */}
      <div className="ios-glass absolute bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2">
        {(Object.keys(APPS) as AppId[]).map((app) => {
          const running = wins.filter((w) => w.app === app && !w.minimized).length;
          return (
            <button
              key={app}
              onClick={() => open(app)}
              title={APPS[app].label}
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-2xl transition-all hover:scale-110",
                running ? "bg-primary/15 text-primary" : "text-fg-secondary hover:bg-muted",
              )}
            >
              {APPS[app].icon}
              {running ? (
                <span className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------ 各个应用 ------------------------------ */

function AppView({ app }: { app: AppId }) {
  const { t } = useI18n();
  switch (app) {
    case "terminal":
      return <TerminalApp />;
    case "notes":
      return <NotesApp />;
    case "calculator":
      return <CalculatorApp />;
    case "clock":
      return <ClockApp />;
    case "about":
      return <AboutApp />;
    default:
      return null;
  }
}

/** 终端：模拟几条常用命令，纯前端，不执行任何真实操作 */
function TerminalApp() {
  const { t } = useI18n();
  const [lines, setLines] = React.useState<string[]>([
    t("pc.termWelcome"),
  ]);
  const [input, setInput] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  function run(cmd: string) {
    const raw = cmd.trim();
    const echo = `agnes-cloud-pc ~ % ${raw}`;
    if (!raw) return setLines((l) => [...l, echo]);

    const [name, ...args] = raw.split(/\s+/);
    const out: string[] = [echo];

    switch (name) {
      case "help":
        out.push(
          t("pc.cmdHelpTitle"),
          t("pc.cmdHelp"),
          t("pc.cmdLs"),
          t("pc.cmdEcho"),
          t("pc.cmdDate"),
          t("pc.cmdWhoami"),
          t("pc.cmdNeofetch"),
          t("pc.cmdClear"),
        );
        break;
      case "ls":
        out.push("README.md    notes.txt    .config/    desktop/");
        break;
      case "echo":
        out.push(args.join(" "));
        break;
      case "date":
        out.push(new Date().toString());
        break;
      case "whoami":
        out.push(t("pc.whoamiGuest"));
        break;
      case "neofetch":
        out.push(
          t("pc.neofetchOs"),
          t("pc.neofetchKernel", { ua: navigator.userAgent.slice(0, 60) }),
          t("pc.neofetchRes", { w: window.screen.width, h: window.screen.height }),
          t("pc.neofetchLang", { lang: navigator.language }),
        );
        break;
      case "clear":
        setLines([]);
        setInput("");
        return;
      default:
        out.push(t("pc.notFound", { name }));
    }
    setLines((l) => [...l, ...out]);
    setInput("");
  }

  return (
    <div className="font-mono text-xs">
      <div className="max-h-64 space-y-0.5 overflow-auto rounded-xl bg-black/80 p-3 text-green-300">
        {lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap break-words">
            {l}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
        className="mt-2 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("pc.cmdPlaceholder")}
          className="flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary/50"
          autoComplete="off"
        />
        <button
          type="submit"
          className="ios-pill bg-primary px-4 text-xs font-medium text-primary-foreground"
        >
          {t("pc.run")}
        </button>
      </form>
    </div>
  );
}

/** 记事本：内容存 localStorage */
function NotesApp() {
  const { t } = useI18n();
  const KEY = "agnes:cloudpc:notes";
  const [text, setText] = React.useState("");

  React.useEffect(() => {
    try {
      setText(localStorage.getItem(KEY) ?? "");
    } catch {
      /* 忽略 */
    }
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(KEY, text);
    } catch {
      /* 忽略 */
    }
  }, [text]);

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-fg-tertiary">{t("pc.autoSaveNote")}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("pc.notesPlaceholder")}
        className="h-52 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-primary/50"
      />
    </div>
  );
}

/** 计算器：四则运算，带键盘输入 */
function CalculatorApp() {
  const { t } = useI18n();
  const [disp, setDisp] = React.useState("0");
  const [acc, setAcc] = React.useState<number | null>(null);
  const [op, setOp] = React.useState<string | null>(null);
  const [fresh, setFresh] = React.useState(true);

  function num(n: string) {
    setDisp((d) => (fresh || d === "0" ? n : d + n));
    setFresh(false);
  }

  function setOperator(o: string) {
    setAcc(Number(disp));
    setOp(o);
    setFresh(true);
  }

  function calc() {
    if (acc === null || !op) return;
    const b = Number(disp);
    const r =
      op === "+" ? acc + b : op === "-" ? acc - b : op === "×" ? acc * b : op === "÷" ? (b === 0 ? NaN : acc / b) : b;
    setDisp(Number.isNaN(r) ? t("pc.error") : String(Math.round(r * 1e10) / 1e10));
    setAcc(null);
    setOp(null);
    setFresh(true);
  }

  const keys = ["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "-", "0", ".", "=", "+"];

  return (
    <div className="mx-auto w-64 space-y-2">
      <div className="ios-card truncate px-4 py-3 text-right text-2xl font-medium">{disp}</div>
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => {
            setDisp("0");
            setAcc(null);
            setOp(null);
            setFresh(true);
          }}
          className="ios-pill col-span-2 bg-muted py-2.5 text-sm"
        >
          {t("pc.clear")}
        </button>
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => {
              if (/[0-9.]/.test(k)) num(k);
              else if (k === "=") calc();
              else setOperator(k);
            }}
            className={cn(
              "ios-pill py-2.5 text-sm font-medium",
              /[+\-×÷]/.test(k) || k === "="
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:brightness-95",
            )}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 时钟 */
function ClockApp() {
  const { t } = useI18n();
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) return <div className="py-8 text-center text-sm text-fg-tertiary">{t("common.loading")}</div>;

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="py-6 text-center">
      <div className="text-5xl font-light tabular-nums">
        {pad(now.getHours())}:{pad(now.getMinutes())}
        <span className="text-2xl text-fg-tertiary">:{pad(now.getSeconds())}</span>
      </div>
      <div className="mt-2 text-sm text-fg-secondary">
        {t("pc.dateFmt", {
          y: now.getFullYear(),
          m: now.getMonth() + 1,
          d: now.getDate(),
        })}
      </div>
    </div>
  );
}

/** 关于本机 */
function AboutApp() {
  const { t } = useI18n();
  const [info, setInfo] = React.useState<{ os: string; screen: string; lang: string } | null>(null);

  React.useEffect(() => {
    setInfo({
      os: navigator.userAgent.slice(0, 70) + "…",
      screen: `${window.screen.width} × ${window.screen.height}`,
      lang: navigator.language,
    });
  }, []);

  if (!info) return <div className="py-6 text-center text-sm text-fg-tertiary">{t("pc.reading")}</div>;

  return (
    <div className="space-y-2 text-sm">
      <Row k={t("pc.aboutSystem")} v={t("pc.aboutSystemVal")} />
      <Row k={t("pc.aboutKernel")} v={info.os} />
      <Row k={t("pc.aboutScreen")} v={info.screen} />
      <Row k={t("pc.aboutLang")} v={info.lang} />
      <Row k={t("pc.aboutStorage")} v={t("pc.aboutStorageVal")} />
      <p className="pt-2 text-[11px] text-fg-tertiary">
        {t("pc.aboutNote")}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 border-b border-border/50 pb-1.5">
      <span className="w-16 shrink-0 text-fg-tertiary">{k}</span>
      <span className="min-w-0 flex-1 break-words">{v}</span>
    </div>
  );
}
