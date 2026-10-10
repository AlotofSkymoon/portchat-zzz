"use client";

import * as React from "react";

import { SITE_THEME, THEME_IDS, type ThemePreset } from "@/lib/site";

/**
 * 明暗模式三态。
 *
 * "system" 跟随系统偏好，并实时响应系统切换；
 * "light" / "dark" 是用户手动锁定。
 *
 * 为什么需要三态而不是只有亮/暗两态：
 * 只有两态时，用户点一下就被"锁死"在某一侧 —— 之后再改系统设置，
 * 站点不会跟着变，用户还得回来再点一次。三态保留了「跟随」这个选项。
 */
export type Theme = "light" | "dark" | "system";

/** 实际生效的明暗（system 已解析成具体值） */
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "agnes:theme";
const PRESET_KEY = "agnes:theme-preset";
const VARIANT_KEY = "agnes:ui-variant";
/**
 * iOS 观感解锁标记。
 *
 * SwiftUI 主题属于配色（跟 Anthropic / Fuwari 并列），不是"界面变体"。
 * 规则是：只有在 iOS 上把站点装到主屏幕（standalone）才算解锁，
 * 解锁后写进 localStorage，之后在浏览器里也能继续用 —— 否则每次
 * 从 Safari 打开就掉回默认主题，等于惩罚用户。
 */
const IOS_UNLOCK_KEY = "agnes:ios-unlocked";

/** 读取是否已解锁（SSR 安全） */
export function isIosUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(IOS_UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 是否是 iOS / iPadOS 设备。
 *
 * iPadOS 13+ 的 UA 已经伪装成 Macintosh，靠 UA 里的 "iPhone/iPad" 会漏，
 * 所以补一条：Mac 且支持多点触控（maxTouchPoints > 1）也判为 iPad。
 */
export function isIOSDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    const isMac = /Macintosh/i.test(ua);
    if (isMac && (navigator.maxTouchPoints || 0) > 1) return true;
    // iPadOS 13+ 还有一种：platform 是 MacIntel 但带触控
    return false;
  } catch {
    return false;
  }
}

/**
 * 界面变体。
 *
 * "web" 是常规浏览器观感；"ios" 是装成 PWA（添加到主屏幕 / 已安装）
 * 之后解锁的 Apple 观感：SF 字体、更厚的半透明材质、更大的连续圆角、
 * 发丝级分隔线、安全区内边距、弹簧曲线。
 *
 * 默认自动：以 standalone 打开就启用。用户可以用 ?ios=1 / ?ios=0
 * 或设置里的开关手动覆盖。
 */
export type UiVariant = "web" | "ios";

/**
 * 界面变体的用户意图。
 *
 * "auto" 跟着运行环境走：装成 PWA（standalone）就是 ios，浏览器标签里就是 web。
 * 之前只有隐式的"跟着环境走"，用户在浏览器里根本没法主动开，
 * 加到主屏幕一旦判定失败也无从手动补救 —— 所以这里把它变成显式三态。
 */
export type VariantPref = "auto" | "ios" | "web";

interface ThemeContextValue {
  /** 用户的选择（可能是 system） */
  theme: Theme;
  /** 实际生效值，拿去渲染用这个 */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** 在 light / dark 之间切换（点了就锁定，不再跟随系统） */
  toggleTheme: (origin?: { x: number; y: number }) => void;
  /** 三态循环：亮 → 暗 → 跟随系统 */
  cycleTheme: (origin?: { x: number; y: number }) => void;
  /** 系统偏好（供 UI 显示「跟随系统（当前暗）」这类提示） */
  systemTheme: ResolvedTheme;
  /** 界面风格预设：anthropic / fuwari / violet-rose / sidefolio / minimalist */
  preset: ThemePreset;
  setPreset: (preset: ThemePreset) => void;
  /** 界面变体：web = 常规，ios = PWA 解锁的 Apple 观感 */
  variant: UiVariant;
  setVariant: (variant: UiVariant) => void;
  /** 用户的意图：auto 跟随环境，ios / web 手动锁定 */
  variantPref: VariantPref;
  setVariantPref: (pref: VariantPref) => void;
  /** 当前是否以 standalone（已安装 PWA）方式运行 */
  standalone: boolean;
  /** SwiftUI 配色主题是否已解锁（iOS 装到主屏幕过） */
  iosUnlocked: boolean;
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 判断是否以"已安装"的方式运行。
 *
 * 四种情况都要算进来，少一种就会有用户加到主屏幕却拿不到 iOS 观感：
 * - display-mode: standalone —— 标准写法，iOS 15.4+ / Chrome / Edge
 * - display-mode: fullscreen —— 部分 Android 桌面应用模式
 * - display-mode: minimal-ui —— iOS 某些从主屏幕打开的降级情形
 * - navigator.standalone —— iOS 的老私有属性，至今仍是判定的兜底
 *
 * iOS 上如果站点缺 apple-mobile-web-app-capable，从主屏幕打开会走普通 Safari，
 * 上面四种全为 false —— 那种情况只能靠设置里手动锁定。
 */
export function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const mm = window.matchMedia?.bind(window);
    if (mm) {
      const modes = ["(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"];
      for (const m of modes) {
        if (mm(m).matches) return true;
      }
    }
  } catch {
    /* matchMedia 在某些内置浏览器里会抛，忽略后走 navigator 兜底 */
  }
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/**
 * 用 View Transitions 做圆形扩散切换。
 *
 * 现代浏览器（Chrome 111+ / Safari 18+）支持时，从点击位置扩散出
 * 一个新主题的圆，比整屏硬切自然得多。不支持时静默退回普通切换，
 * 不会报错也不会卡顿 —— 所以可以无条件调用。
 */
function applyWithTransition(
  origin: { x: number; y: number } | undefined,
  apply: () => void,
): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void> };
  };

  // 不支持 View Transitions，或没给点击位置 → 直接切换
  if (!origin || typeof doc.startViewTransition !== "function") {
    apply();
    return;
  }

  try {
    const transition = doc.startViewTransition(() => {
      apply();
    });

    transition.ready
      .then(() => {
        // 从点击点到最远角的距离，保证圆能覆盖整屏
        const endRadius = Math.hypot(
          Math.max(origin.x, window.innerWidth - origin.x),
          Math.max(origin.y, window.innerHeight - origin.y),
        );

        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${origin.x}px ${origin.y}px)`,
              `circle(${endRadius}px at ${origin.x}px ${origin.y}px)`,
            ],
          },
          {
            duration: 420,
            easing: "cubic-bezier(0.4, 0, 0.2, 1)",
            // 作用在"新画面"上，让它从点击处展开盖住旧画面
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        /* 动画失败不影响切换结果 —— class 已经改完了 */
      });
  } catch {
    apply();
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system");
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>("light");
  const [preset, setPresetState] = React.useState<ThemePreset>(SITE_THEME);
  const [variant, setVariantState] = React.useState<UiVariant>("web");
  const [variantPref, setVariantPrefState] = React.useState<VariantPref>("auto");
  const [standalone, setStandalone] = React.useState(false);
  const [iosUnlocked, setIosUnlockedState] = React.useState(false);

  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const valid = stored === "light" || stored === "dark" || stored === "system";
    const initial: Theme = valid ? stored : "system";

    const sys = readSystemTheme();
    setSystemTheme(sys);
    setThemeState(initial);
    document.documentElement.classList.toggle("dark", initial === "system" ? sys === "dark" : initial === "dark");

    const storedPreset = localStorage.getItem(PRESET_KEY) as ThemePreset | null;
    let initialPreset: ThemePreset = THEME_IDS.includes(storedPreset as ThemePreset)
      ? (storedPreset as ThemePreset)
      : SITE_THEME;
    setPresetState(initialPreset);
    document.documentElement.dataset.theme = initialPreset;

    /* ---- 界面变体：装成 PWA 就自动解锁 iOS 观感 ---- */
    const q = new URLSearchParams(window.location.search);
    const forcedIos = q.get("ios") === "1";
    const forcedWeb = q.get("ios") === "0";
    const storedVariant = localStorage.getItem(VARIANT_KEY);
    const saMq = window.matchMedia?.("(display-mode: standalone)");
    const isStandalone = detectStandalone();
    setStandalone(isStandalone);

    /**
     * iOS 观感解锁：只有「iOS 设备 + 从主屏幕打开」才写进存储。
     *
     * ⚠️ ?ios=1 只在内存里解锁、不落盘 —— 它是给站长在桌面浏览器上
     * 预览用的，不该让随便加个参数就永久解锁。
     */
    let unlocked = false;
    try {
      unlocked = localStorage.getItem(IOS_UNLOCK_KEY) === "1";
    } catch {
      unlocked = false;
    }
    if (isStandalone && isIOSDevice() && !unlocked) {
      try {
        localStorage.setItem(IOS_UNLOCK_KEY, "1");
      } catch {
        /* 隐私模式下写不进，只影响跨会话保留，不影响本次 */
      }
      unlocked = true;
    }
    if (forcedIos) unlocked = true;
    setIosUnlockedState(unlocked);
    // 未解锁却存着 swiftui（换设备、清了标记等），回落到站点默认主题，
    // 免得看到一个"应该锁着"的主题。
    if (initialPreset === "swiftui" && !unlocked) {
      initialPreset = SITE_THEME;
      try {
        localStorage.setItem(PRESET_KEY, initialPreset);
      } catch {
        /* 写不进就算了，下次还会再回落一次 */
      }
    }

    // 旧的存储值只有 "ios" / "web"，等价于手动锁定；"auto" 是新增的跟随态。
    const storedPref: VariantPref =
      storedVariant === "ios" || storedVariant === "web" || storedVariant === "auto"
        ? (storedVariant as VariantPref)
        : "auto";
    const initialPref: VariantPref = forcedIos ? "ios" : forcedWeb ? "web" : storedPref;
    setVariantPrefState(initialPref);

    const initialVariant: UiVariant =
      initialPref === "auto" ? (isStandalone ? "ios" : "web") : initialPref;
    setVariantState(initialVariant);
    document.documentElement.dataset.variant = initialVariant;
    // 只有显式用 ?ios= 才写进存储 —— 否则 auto 是"跟着环境走"，
    // 用户从主屏幕切回浏览器标签时会自动回到 web 观感，不会锁死。
    if (forcedIos || forcedWeb) localStorage.setItem(VARIANT_KEY, initialPref);

    /**
     * 监听系统偏好变化。
     * 只有处在 "system" 模式时才需要跟着变 —— 用户手动锁定后就不再打扰。
     */
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      const next: ResolvedTheme = e.matches ? "dark" : "light";
      setSystemTheme(next);
      // 读最新值而不是闭包里的 theme，避免拿到过期状态
      const current = localStorage.getItem(STORAGE_KEY);
      if (current === "system" || !current) {
        document.documentElement.classList.toggle("dark", next === "dark");
      }
    };
    mq?.addEventListener("change", onChange);

    // 从浏览器标签装到主屏幕（或反过来）时实时跟随
    const onSa = () => {
      const sa = detectStandalone();
      setStandalone(sa);
      const pinned = localStorage.getItem(VARIANT_KEY);
      // 手动锁定过（ios / web）就不跟着环境跳，只有 auto 才跟随
      if (pinned === "ios" || pinned === "web") return;
      const next: UiVariant = sa ? "ios" : "web";
      setVariantState(next);
      document.documentElement.dataset.variant = next;
    };
    saMq?.addEventListener("change", onSa);

    return () => {
      mq?.removeEventListener("change", onChange);
      saMq?.removeEventListener("change", onSa);
    };
  }, []);

  /** 真正写 DOM 的动作 */
  const commit = React.useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem(STORAGE_KEY, next);
    const resolved: ResolvedTheme =
      next === "system" ? readSystemTheme() : (next as ResolvedTheme);
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, []);

  const setTheme = React.useCallback(
    (next: Theme) => {
      applyWithTransition(undefined, () => commit(next));
    },
    [commit],
  );

  /** 两态切换：点了就锁定，从 system 切走时也锁定 */
  const toggleTheme = React.useCallback(
    (origin?: { x: number; y: number }) => {
      const isDark = document.documentElement.classList.contains("dark");
      applyWithTransition(origin, () => commit(isDark ? "light" : "dark"));
    },
    [commit],
  );

  /** 三态循环：亮 → 暗 → 跟随系统 */
  const cycleTheme = React.useCallback(
    (origin?: { x: number; y: number }) => {
      const order: Theme[] = ["light", "dark", "system"];
      const current = (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
      const idx = order.indexOf(current);
      const next = order[(idx + 1) % order.length];
      applyWithTransition(origin, () => commit(next));
    },
    [commit],
  );

  const setPreset = React.useCallback((next: ThemePreset) => {
    setPresetState(next);
    localStorage.setItem(PRESET_KEY, next);
    document.documentElement.dataset.theme = next;
  }, []);

  const setVariant = React.useCallback((next: UiVariant) => {
    setVariantState(next);
    setVariantPrefState(next);
    localStorage.setItem(VARIANT_KEY, next);
    document.documentElement.dataset.variant = next;
  }, []);

  /**
   * 设置意图。auto 不直接决定外观 —— 要按当前是否在 standalone 里再算一次，
   * 否则用户在浏览器里切到 auto 会瞬间变成 web，切到主屏幕又不会自动变 ios。
   */
  const setVariantPref = React.useCallback((next: VariantPref) => {
    setVariantPrefState(next);
    localStorage.setItem(VARIANT_KEY, next);
    const resolved: UiVariant = next === "auto" ? (detectStandalone() ? "ios" : "web") : next;
    setVariantState(resolved);
    document.documentElement.dataset.variant = resolved;
  }, []);

  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme : (theme as ResolvedTheme);

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      cycleTheme,
      systemTheme,
      preset,
      setPreset,
      variant,
      setVariant,
      variantPref,
      setVariantPref,
      standalone,
      iosUnlocked,
    }),
    [
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      cycleTheme,
      systemTheme,
      preset,
      setPreset,
      variant,
      setVariant,
      variantPref,
      setVariantPref,
      standalone,
      iosUnlocked,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}

/**
 * 防止刷新时闪白/闪主题：在 <head> 中同步执行。
 *
 * 明暗用 .dark class，配色用 data-theme 属性，两者互不干扰。
 * 这里必须处理 "system" —— 存的是 system 时要现算一次，
 * 否则刷新瞬间会退回浅色再跳到深色。
 */
export const themeInitScript = `(function(){try{
var t=localStorage.getItem('${STORAGE_KEY}');
var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)');
var sys=m?m.matches:false;
var d=(t==='system'||!t)?sys:(t==='dark');
var r=document.documentElement;
if(d)r.classList.add('dark');else r.classList.remove('dark');
var p=localStorage.getItem('${PRESET_KEY}');
r.dataset.theme=${JSON.stringify(THEME_IDS)}.indexOf(p)>=0?p:'${SITE_THEME}';
// SwiftUI 主题锁：未解锁（没在 iOS 主屏幕装过）就回落，避免首屏闪一下锁定主题
if(r.dataset.theme==='swiftui'&&localStorage.getItem('${IOS_UNLOCK_KEY}')!=='1'){r.dataset.theme='${SITE_THEME}';}
}catch(e){document.documentElement.classList.remove('dark');}})();`;

/**
 * 界面变体的首屏同步脚本。
 *
 * 必须在 <head> 里同步跑完：iOS 观感会改字体栈、圆角和安全区内边距，
 * 如果等 hydration 再生效，首帧会先用 web 观感渲染再跳变 —— 肉眼可见。
 *
 * 判定优先级：?ios=0 > ?ios=1 > 用户手动存的选择 > 是否 standalone 运行。
 */
export const variantInitScript = `(function(){try{
var r=document.documentElement;
var q=location.search;
var force1=/[?&]ios=1(?![\\w=])/.test(q);
var force0=/[?&]ios=0(?![\\w=])/.test(q);
var s=localStorage.getItem('${VARIANT_KEY}');
var sa=false;
try{
  var mm=window.matchMedia;
  if(mm){
    sa=mm('(display-mode: standalone)').matches||mm('(display-mode: fullscreen)').matches||mm('(display-mode: minimal-ui)').matches;
  }
}catch(e){}
try{ if(!sa){ sa=navigator.standalone===true; } }catch(e){}
var v;
if(force0)v='web';
else if(force1)v='ios';
else if(s==='ios'||s==='web')v=s;
else v=sa?'ios':'web';
r.setAttribute('data-variant',v);
if(force0){try{localStorage.setItem('${VARIANT_KEY}','web');}catch(e){}}
else if(force1){try{localStorage.setItem('${VARIANT_KEY}','ios');}catch(e){}}
}catch(e){document.documentElement.setAttribute('data-variant','web');}})();`;