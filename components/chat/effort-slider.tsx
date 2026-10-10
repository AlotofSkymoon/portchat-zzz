"use client";

import * as React from "react";
import { EFFORT_LEVELS, type EffortLevel } from "@/lib/config";

/*
 * 推理等级滑条 —— 交互与视觉移植自 dsh-codex-effort-slider（MIT）。
 *
 * 移植的两条主线：
 *
 * ① 手势：Pointer Events + setPointerCapture，按下即响应、拖动 1:1 跟手，
 *    松手才提交。拖动过程中视觉走「草稿值」（draft），不等提交回调，
 *    所以手指到哪、颜色/星空/旋钮就到哪 —— 这是「跟手」的唯一来源。
 *
 * ② 星空：数量、速率、透明度全部由**位置**连续驱动（不是档位写死），
 *    22 颗星的相位/高度用确定性伪随机，重渲染不跳变。
 *
 * ── 几何（照参考实现，别改） ──────────────────────────────
 * 旋钮直径 = 轨道高度，圆心只在 [R, 宽−R] 之间移动：
 *     left = R + pct × (100% − 2R)
 * 若直接用 pct×100%，pct=0 时圆心落在 0，左半圆会被菜单 overflow 切掉。
 * 指针落点用同一个公式反解，所以拖到最左/最右必定命中端点档位。
 */

const TRACK_HEIGHT = 28;
const KNOB_SIZE = TRACK_HEIGHT;
const KNOB_RADIUS = KNOB_SIZE / 2;

const ENERGY_START = 1 / 3;
const ENERGY_END = 2 / 3;

const COLOR_BLUE = [77, 147, 248];
const COLOR_VIOLET = [147, 51, 234];
const COLOR_DEEP = [76, 29, 149];
const COLOR_TEXT_VIOLET = [139, 92, 246];

const STAR_COUNT = 22;
const STARFIELD_DURATION_MEAN = 1.5;
const STARFIELD_DURATION_SPREAD = 0.08;
const STARFIELD_MIN = 0.5;
const GOLDEN_RATIO = 0.6180339887498949;
const MIN_HEIGHT_SLOTS = 3;
const MAX_SPEED_FACTOR = 2;
const REDUCED_MOTION_SLOWDOWN = 2.6;
const COMMIT_THROTTLE_MS = 120;

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function rgbOf(c: number[]) {
  return "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";
}

function mixColor(a: number[], b: number[], t: number) {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function pctFromIndex(index: number, count: number) {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(count - 1, index)) / (count - 1);
}

function indexFromPct(pct: number, count: number) {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(clamp01(pct) * (count - 1))));
}

function energyFor(pct: number) {
  return clamp01((clamp01(pct) - ENERGY_START) / (1 - ENERGY_START));
}

/** 位置 → 当前点的颜色（渐变右端色）。 */
function fillColorFor(pct: number) {
  const t = clamp01(pct);
  if (t <= ENERGY_START) return rgbOf(COLOR_BLUE);
  if (t <= ENERGY_END) {
    return rgbOf(mixColor(COLOR_BLUE, COLOR_VIOLET, (t - ENERGY_START) / (ENERGY_END - ENERGY_START)));
  }
  return rgbOf(mixColor(COLOR_VIOLET, COLOR_DEEP, (t - ENERGY_END) / (1 - ENERGY_END)));
}

function fillBackgroundFor(pct: number) {
  return "linear-gradient(90deg, " + rgbOf(COLOR_BLUE) + ", " + fillColorFor(pct) + ")";
}

function valueColorFor(pct: number, level: EffortLevel) {
  if (level === "off") return "";
  return rgbOf(mixColor(COLOR_BLUE, COLOR_TEXT_VIOLET, energyFor(pct)));
}

/** 圆心 / 填充终点 / 刻度：`R + pct × (100% − 2R)`。 */
function knobOffsetOf(pct: number, radius: number) {
  const t = Math.round(clamp01(pct) * 10000) / 10000;
  return "calc(" + radius + "px + " + t + " * (100% - " + radius * 2 + "px))";
}

/** 确定性伪随机 [0,1)：不用 Math.random，重渲染不跳变。 */
function starHash01(index: number, salt: number) {
  const value = ((index + 1) * salt * 2654435761) % 4294967296;
  return ((value >>> 8) % 1000) / 1000;
}

/**
 * 22 颗星：相位用黄金比低差异序列（任意前缀都铺得开），高度用哈希排序的
 * 等距槽位，并要求相位相邻的两颗高度至少差 MIN_HEIGHT_SLOTS 槽 ——
 * 否则在轨道上会一直并排走，看起来像一坨。
 */
const PARTICLES: { y: number; phase: number }[] = (() => {
  const out: { y: number; phase: number }[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    out.push({ y: 0, phase: ((i + 1) * GOLDEN_RATIO) % 1 });
  }
  const byPhase = out.map((_, i) => i).sort((a, b) => out[a].phase - out[b].phase);
  let slots: number[] | null = null;
  for (let salt = 71; salt < 4000 && slots === null; salt += 1) {
    const candidate = out.map((_, i) => i).sort((a, b) => {
      const ha = starHash01(a, salt);
      const hb = starHash01(b, salt);
      return ha === hb ? a - b : ha - hb;
    });
    let ok = true;
    for (let k = 1; k < STAR_COUNT && ok; k += 1) {
      if (Math.abs(candidate[k] - candidate[k - 1]) < MIN_HEIGHT_SLOTS) ok = false;
    }
    if (ok) slots = candidate;
  }
  const rank = slots ?? out.map((_, i) => i);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    out[i].y = (rank[i] + 0.5) * (100 / STAR_COUNT);
  }
  void byPhase;
  return out;
})();

function starBrightnessFor(index: number) {
  return STARFIELD_MIN + (1 - STARFIELD_MIN) * starHash01(index, 61);
}

/** 位置 → 速率倍数：high 档 1×、最高档 2×、左端不低于 0.35×（免得静止）。 */
function speedFor(pct: number) {
  return Math.min(MAX_SPEED_FACTOR, Math.max(0.35, 3 * clamp01(pct) - 1));
}

function starDurationFor(index: number, speedFactor: number) {
  const speed = Math.min(MAX_SPEED_FACTOR, Math.max(0.35, speedFactor));
  const spread =
    1 - STARFIELD_DURATION_SPREAD + 2 * STARFIELD_DURATION_SPREAD * starHash01(index, 29);
  return (STARFIELD_DURATION_MEAN * MAX_SPEED_FACTOR * spread) / speed;
}

function starDelayFor(index: number, duration: number) {
  const p = PARTICLES[index];
  const phase = p ? p.phase : 0;
  const jitter = starHash01(index, 53) * 0.03;
  return -(((phase + jitter) % 1) * duration);
}

/** 位置 → 可见星数（「逐渐出现、变密集」）。 */
function starCountFor(pct: number) {
  return Math.round(energyFor(pct) * PARTICLES.length);
}

/**
 * 位置 → 星星层不透明度。
 * 星星不能跟着星云一起淡入：high 档能量只有 0.5，压上去就看不见了。
 * 所以给一个下限，「逐渐出现」交给星数表达。
 */
function starLayerOpacityFor(pct: number) {
  return 0.6 + 0.4 * energyFor(pct);
}

export function EffortSlider({
  level,
  onChange,
  height = TRACK_HEIGHT,
  costLabel,
  costMaxLabel,
}: {
  level: EffortLevel;
  onChange: (next: EffortLevel) => void;
  height?: number;
  costLabel?: string;
  costMaxLabel?: string;
}) {
  const count = EFFORT_LEVELS.length;
  const rawIndex = EFFORT_LEVELS.indexOf(level);
  const committedIndex = rawIndex < 0 ? 1 : rawIndex;

  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  /** 拖动中的草稿：视觉立刻跟手，提交走节流 */
  const draftRef = React.useRef<{ pct: number; index: number } | null>(null);
  const [draft, setDraft] = React.useState<{ pct: number; index: number } | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef<EffortLevel | null>(null);

  const reducedMotion = useReducedMotion();

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const shown = draft ?? { pct: pctFromIndex(committedIndex, count), index: committedIndex };
  const pct = shown.pct;
  const index = shown.index;
  const shownLevel = EFFORT_LEVELS[index] ?? level;

  const radius = height / 2;
  const energy = energyFor(pct);

  function flush() {
    const next = pendingRef.current;
    pendingRef.current = null;
    if (next && next !== level) onChange(next);
  }

  function requestCommit(next: EffortLevel | undefined, immediate: boolean) {
    if (!next) return;
    pendingRef.current = next;
    if (immediate) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
      return;
    }
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, COMMIT_THROTTLE_MS);
  }

  /** 指针 x → pct，与视觉几何同一公式，端点必定命中 */
  function pctAt(clientX: number) {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - radius * 2;
    if (!(usable > 0)) return null;
    return clamp01((clientX - rect.left - radius) / usable);
  }

  function moveTo(clientX: number, immediate: boolean) {
    if (count === 0) return;
    const p = pctAt(clientX);
    if (p === null) return;
    const i = indexFromPct(p, count);
    const next = { pct: p, index: i };
    draftRef.current = next;
    setDraft(next);
    requestCommit(EFFORT_LEVELS[i], immediate);
  }

  function endDrag() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const latest = draftRef.current;
    if (latest && count > 0) requestCommit(EFFORT_LEVELS[latest.index], true);
    draftRef.current = null;
    setDraft(null);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (count === 0) return;
    e.stopPropagation();
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败不影响拖动 */
    }
    moveTo(e.clientX, false);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    e.stopPropagation();
    moveTo(e.clientX, false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (count === 0) return;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, index - 1);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(count - 1, index + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else return;
    e.stopPropagation();
    e.preventDefault();
    setDraft(null);
    draftRef.current = null;
    requestCommit(EFFORT_LEVELS[next], true);
  }

  const stars = [];
  const visible = starCountFor(pct);
  const speed = speedFor(pct);
  for (let s = 0; s < visible; s += 1) {
    const brightness = starBrightnessFor(s);
    const dur = starDurationFor(s, speed) * (reducedMotion ? REDUCED_MOTION_SLOWDOWN : 1);
    stars.push(
      <span
        key={"star-" + s}
        className="ces-star"
        style={{
          top: PARTICLES[s].y.toFixed(3) + "%",
          // 时长与负相位必须内联：写成 CSS 变量时相位不生效，会出现「一打开星星全挤在起点」
          animationDuration: dur.toFixed(3) + "s",
          animationDelay: starDelayFor(s, dur).toFixed(3) + "s",
        }}
      >
        <span className="ces-star__dot" style={{ ["--ces-b" as string]: brightness.toFixed(3) }} />
      </span>,
    );
  }

  const showCost = Boolean(costLabel || costMaxLabel);

  return (
    <div className="ces-inline" data-energy={energy > 0 ? "1" : "0"} data-motion={reducedMotion ? "reduced" : "full"}>
      {showCost ? (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 6,
            fontSize: 11,
            fontWeight: 600,
            color: valueColorFor(pct, shownLevel) || "#8b5cf6",
          }}
          aria-hidden="true"
        >
          <span style={{ opacity: 0.72, fontWeight: 500 }}>{costLabel}</span>
          {index === count - 1 && costMaxLabel ? <span>{costMaxLabel}</span> : null}
        </div>
      ) : null}

      <div
        ref={trackRef}
        className="ces-track"
        style={{ height }}
        data-dragging={draft ? "1" : "0"}
        role="slider"
        tabIndex={0}
        aria-label="thinking-effort"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={index}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div
          className="ces-fill"
          style={{ width: knobOffsetOf(pct, radius), background: fillBackgroundFor(pct) }}
        >
          <div className="ces-energy" style={{ ["--ces-energy" as string]: energy.toFixed(3) }}>
            <div className="ces-energy__sweep" />
          </div>
          <div className="ces-stars" style={{ opacity: starLayerOpacityFor(pct).toFixed(3) }}>
            {stars}
          </div>
        </div>

        {EFFORT_LEVELS.map((lv, i) => (
          <span
            key={lv}
            className="ces-tick"
            data-on={i <= index ? "1" : "0"}
            style={{ left: knobOffsetOf(pctFromIndex(i, count), radius) }}
            aria-hidden="true"
          />
        ))}

        <span
          className="ces-knob"
          style={{
            width: height,
            height: height,
            marginLeft: -radius,
            marginTop: -radius,
            left: knobOffsetOf(pct, radius),
            ["--ces-knob-tint" as string]: fillColorFor(pct),
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export function effortValueColor(level: EffortLevel) {
  const count = EFFORT_LEVELS.length;
  const idx = EFFORT_LEVELS.indexOf(level);
  return valueColorFor(pctFromIndex(idx < 0 ? 1 : idx, count), level);
}

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}
