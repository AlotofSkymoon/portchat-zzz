"use client";

import { useMemo } from "react";
import { EFFORT_LEVELS, type EffortLevel } from "@/lib/config";

/*
 * 推理等级滑条。
 *
 * 视觉逻辑移植自 Codex 风格滑条实现（蓝 → 紫 → 深紫三段插值）：
 * 填充层左端恒为蓝、右端（旋钮处）是当前位置的颜色，所以越往右整条越紫越深。
 * Off 档的数值文字刻意不上色，保持原本的灰。
 */

const TRACK_HEIGHT = 28;
const KNOB_SIZE = 28;
const KNOB_RADIUS = 14;

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

/** Max 档的星尘：位置固定（不用随机，避免每次渲染跳动）。 */
const STARS = [
  { left: 18, top: 34, delay: 0, dur: 2.6 },
  { left: 31, top: 62, delay: 0.4, dur: 3.1 },
  { left: 44, top: 28, delay: 0.9, dur: 2.2 },
  { left: 57, top: 68, delay: 1.3, dur: 3.4 },
  { left: 69, top: 36, delay: 0.2, dur: 2.9 },
  { left: 82, top: 58, delay: 1.1, dur: 2.4 },
  { left: 91, top: 30, delay: 0.7, dur: 3.2 },
  { left: 25, top: 48, delay: 1.6, dur: 2.7 },
  { left: 52, top: 44, delay: 0.5, dur: 3.0 },
  { left: 76, top: 50, delay: 1.9, dur: 2.3 },
];

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

  const fillStyle = useMemo(
    () => ({ width: "calc(" + (pct * 100).toFixed(2) + "% )", background: fillBackgroundFor(pct) }),
    [pct],
  );

  const knobSize = height;
  const knobRadius = height / 2;

  return (
    <div className="ces-inline">
      <div
        className="ces-track"
        style={{ height }}
        role="group"
        aria-label="thinking-effort"
      >
        <div className="ces-fill" style={fillStyle} />

        {level === "max" ? (
          <div className="ces-energy" aria-hidden="true">
            <div className="ces-stars">
              {STARS.map((s, i) => (
                <span
                  key={i}
                  className="ces-star"
                  style={{
                    left: s.left + "%",
                    top: s.top + "%",
                    animationDelay: s.delay + "s",
                    animationDuration: s.dur + "s",
                  }}
                >
                  <i className="ces-star__dot" />
                </span>
              ))}
            </div>
            <div className="ces-energy__sweep" />
          </div>
        ) : null}

        {EFFORT_LEVELS.map((lv, i) => (
          <span
            key={lv}
            className="ces-tick"
            data-on={i <= index ? "1" : "0"}
            style={{ left: "calc(" + (pctFromIndex(i, count) * 100).toFixed(2) + "% )" }}
            aria-hidden="true"
          />
        ))}

        <span
          className="ces-knob"
          style={{
            width: knobSize,
            height: knobSize,
            marginLeft: -knobRadius,
            marginTop: -knobRadius,
            left: fillStyle.width,
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
