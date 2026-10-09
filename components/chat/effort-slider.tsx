"use client";

import { useMemo } from "react";
import { EFFORT_LEVELS, type EffortLevel } from "@/lib/config";

/*
 * 推理等级滑条。
 *
 * 视觉逻辑移植自 Codex 风格滑条实现（蓝 → 紫 → 深紫三段插值）：
 * 填充层左端恒为蓝、右端（旋钮处）是当前位置的颜色，所以越往右整条越紫越深。
 * Off 档的数值文字刻意不上色，保持原本的灰。
 *
 * ── 几何（照参考实现，别改） ──────────────────────────────
 * 旋钮直径 = 轨道高度，圆心只在 [R, 宽-R] 之间移动：
 *     left = R + pct × (100% − 2R)
 * 若直接用 pct×100%，pct=0 时圆心落在 0，左半圆会被菜单的 overflow 切掉。
 * 填充宽度与刻度位置用同一个「到圆心」公式。
 *
 * ── 星尘 ────────────────────────────────────────────────
 * 22 颗，整轨横穿（不是原地闪烁）。位置用确定性伪随机 + 黄金比低差异
 * 相位，重渲染不跳变。横穿用 cqw 单位（容器 = 轨道宽），所以是 transform
 * 动画走合成层，不触发 layout。
 */

const TRACK_HEIGHT = 28;
const KNOB_SIZE = 28;

const ENERGY_START = 1 / 3;
const ENERGY_END = 2 / 3;

const COLOR_BLUE = [77, 147, 248];
const COLOR_VIOLET = [147, 51, 234];
const COLOR_DEEP = [76, 29, 149];
const COLOR_TEXT_VIOLET = [139, 92, 246];

function clamp01(n: number) {
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
  return clamp01(index / (count - 1));
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

/** 左端恒蓝、右端为当前点颜色。 */
function fillBackgroundFor(pct: number) {
  return "linear-gradient(90deg, " + rgbOf(COLOR_BLUE) + ", " + fillColorFor(pct) + ")";
}

function energyFor(pct: number) {
  return clamp01((clamp01(pct) - ENERGY_START) / (1 - ENERGY_START));
}

function valueColorFor(pct: number, level: EffortLevel) {
  if (level === "off") return "";
  return rgbOf(mixColor(COLOR_BLUE, COLOR_TEXT_VIOLET, energyFor(pct)));
}

/**
 * 22 颗星尘：确定性伪随机，不用 Math.random（否则每次渲染都跳）。
 * 横向位置用黄金比低差异序列，避免聚簇。
 */
const STAR_COUNT = 22;
const STARS = (() => {
  const out: { top: number; delay: number; dur: number }[] = [];
  let seed = 20261009;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < STAR_COUNT; i++) {
    out.push({
      top: 10 + rnd() * 80,
      delay: -(rnd() * 3.2),
      dur: 1.6 + rnd() * 2.0,
    });
  }
  return out;
})();

export function EffortSlider({
  level,
  onChange,
  height = TRACK_HEIGHT,
}: {
  level: EffortLevel;
  onChange: (next: EffortLevel) => void;
  height?: number;
}) {
  const count = EFFORT_LEVELS.length;
  const rawIndex = EFFORT_LEVELS.indexOf(level);
  const index = rawIndex < 0 ? 1 : rawIndex;
  const pct = pctFromIndex(index, count);

  // 旋钮直径 = 轨道高度（参考实现的几何前提）
  const r = height / 2;

  /** 圆心位置：R + pct × (100% − 2R) */
  const centerAt = (p: number) =>
    "calc(" + r.toFixed(2) + "px + " + (p * 100).toFixed(2) + "% - " + (p * 2 * r).toFixed(2) + "px)";

  const fillStyle = useMemo(
    () => ({
      width: centerAt(pct),
      background: fillBackgroundFor(pct),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pct, r],
  );

  const energy = energyFor(pct);

  return (
    <div className="ces-inline">
      <div className="ces-track" style={{ height }} role="group" aria-label="thinking-effort">
        <div className="ces-fill" style={fillStyle}>
          <div
            className="ces-energy"
            aria-hidden="true"
            style={{ ["--ces-energy" as string]: energy.toFixed(3) }}
          >
            <div className="ces-stars">
              {STARS.map((s, i) => (
                <span
                  key={i}
                  className="ces-star"
                  style={{
                    // 低差异相位决定出发时机，形成连续星流而非齐步走
                    left: "0px",
                    top: s.top.toFixed(2) + "%",
                    animationDelay: (s.delay - (i * 0.6180339887) % 1 * 2.4).toFixed(2) + "s",
                    animationDuration: s.dur.toFixed(2) + "s",
                  }}
                >
                  <i className="ces-star__dot" />
                </span>
              ))}
            </div>
            <div className="ces-energy__sweep" />
          </div>
        </div>

        {EFFORT_LEVELS.map((lv, i) => (
          <span
            key={lv}
            className="ces-tick"
            data-on={i <= index ? "1" : "0"}
            style={{ left: centerAt(pctFromIndex(i, count)) }}
            aria-hidden="true"
          />
        ))}

        <span
          className="ces-knob"
          style={{
            width: height,
            height: height,
            marginLeft: -r,
            marginTop: -r,
            left: centerAt(pct),
            ["--ces-knob-tint" as string]: fillColorFor(pct),
          }}
          aria-hidden="true"
        />

        <input
          className="ces-input"
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={index}
          aria-label="thinking-effort"
          onChange={(e) => {
            const next = EFFORT_LEVELS[Number(e.target.value)];
            if (next) onChange(next);
          }}
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
