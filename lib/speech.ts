/**
 * 朗读前的文本清洗。
 *
 * 目的：把给模型看的内容，翻译成给人听的内容。
 * 模型输出里大量符号（markdown 标记、emoji、URL、引用标号）眼睛能自动跳过，
 * 但语音引擎会老老实实全念出来 —— 所以这里必须逐类清掉。
 */

/**
 * emoji 与装饰性符号。
 *
 * 不用 \p{Extended_Pictographic} 是因为项目构建目标低于 ES2018，
 * 属性转义会报编译错误，所以这里显式列出码点区间。
 */
const SYMBOL_RE = new RegExp(
  "[" +
    "\\u{1F000}-\\u{1FAFF}" + // 表情、象形文字、补充符号
    "\\u{1F1E6}-\\u{1F1FF}" + // 区域指示符（国旗）
    "\\u{1F3FB}-\\u{1F3FF}" + // 肤色修饰符
    "\\u{2600}-\\u{27BF}" + // 杂项符号、装饰符号、Dingbats
    "\\u{2B00}-\\u{2BFF}" + // 杂项符号与箭头
    "\\u{FE0F}" + // 变体选择符-16（把普通字符变成彩色 emoji）
    "\\u{200D}" + // 零宽连字（👨‍👩‍👧 这类合体）
    "\\u{20E3}" + // keycap：1️⃣
    "\\u{E0020}-\\u{E007F}" + // tag 序列（🏴󠁧󠁢󠁳󠁣󠁴󠁿）
    "]",
  "gu",
);

/** 控制字符（保留换行与制表，它们有朗读意义）。 */
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * 清洗成适合朗读的纯文本。
 *
 * 返回空串表示这条消息没有可读内容，调用方应直接放弃朗读。
 */
export function sanitizeForSpeech(raw: string): string {
  if (!raw) return "";
  let text = raw;

  // 代码块整体跳过 —— 逐字符念代码毫无意义
  text = text.replace(/```[\s\S]*?```/g, " （此处为代码，已跳过） ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " （此处为代码，已跳过） ");

  // HTML 标签与注释
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<[^>]{1,200}>/g, " ");

  // 行内代码、图片、链接：只保留可读的标题部分
  text = text.replace(/`([^`\n]+)`/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 站点注入的引用标号，形如 [citation:3]
  text = text.replace(/\[\s*citation\s*[:：]\s*\d+\s*\]/gi, " ");

  // 裸链接：念一长串 URL 是最糟的体验
  text = text.replace(/\bhttps?:\/\/\S+/gi, " （链接已省略） ");
  text = text.replace(/\bwww\.[^\s]+\.[^\s]+/gi, " （链接已省略） ");

  // 表格分隔行，如 | --- | :---: |
  text = text.replace(/^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/gm, " ");

  // 行首的标题井号、引用箭头、列表符号
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s{0,3}[-+*]\s+/gm, "");
  text = text.replace(/^\s{0,3}\d+[.)]\s+/gm, "");

  // markdown 强调符号与表格竖线
  text = text.replace(/[*_~`|]/g, "");

  // HTML 实体
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&[a-z]{2,10};/gi, " ");
  text = text.replace(/&#\d{1,5};/g, " ");

  // keycap 序列整体去掉，否则只留一个数字会被念成「一」
  text = text.replace(/[#*0-9]\uFE0F?\u20E3/gu, " ");

  // emoji 与装饰符号 —— 放在最后，避免前面的替换又生成新符号
  text = text.replace(SYMBOL_RE, " ");

  // 控制字符
  text = text.replace(CONTROL_RE, " ");

  // 收尾：把连续空白压成一个，去掉行首行尾空格
  text = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

/**
 * 按句切成小段。
 *
 * 浏览器语音引擎对长文本有隐形上限（Chrome 约 15 秒后会自行中断），
 * 所以必须切段排队，否则长回答念一半就没声了。
 */
export function splitSpeechChunks(text: string, maxLen = 160): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  let buf = "";

  const flush = () => {
    const s = buf.trim();
    if (s) chunks.push(s);
    buf = "";
  };

  // 以句末标点为切点，保留标点让语气自然。
  // 不用 lookbehind，因为项目构建目标低于 ES2018。
  const SEP = "\u0001";
  const parts = text.replace(/([。．！？!?；;\n])/g, "$1" + SEP).split(SEP);
  for (const part of parts) {
    if (buf.length + part.length > maxLen && buf.trim()) flush();
    // 单句本身就超长（比如没有标点的长段落），再按长度硬切
    if (part.length > maxLen) {
      flush();
      for (let i = 0; i < part.length; i += maxLen) {
        chunks.push(part.slice(i, i + maxLen).trim());
      }
      continue;
    }
    buf += part;
  }
  flush();
  return chunks.filter(Boolean).slice(0, 40); // 最多 40 段，避免超长回答念太久
}

/** 粗略判断文本是否以中文为主，用于挑语音。 */
export function detectSpeechLang(text: string, fallback: string): string {
  const cjk = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)?.length ?? 0;
  const total = text.replace(/\s/g, "").length || 1;
  if (cjk / total > 0.15) return /^zh/i.test(fallback) ? fallback : "zh-CN";
  return fallback;
}

/** 朗读偏好：指定语音、语速、音调。 */
export type SpeechPrefs = {
  /** 语音的 voiceURI；空串表示交给本模块自动挑。 */
  voiceURI: string;
  /** 语速，0.5–2，1 为正常。 */
  rate: number;
  /** 音调，0–2，1 为正常。 */
  pitch: number;
};

export const DEFAULT_SPEECH_PREFS: SpeechPrefs = { voiceURI: "", rate: 1, pitch: 1 };

const SPEECH_PREFS_KEY = "pot_speech_prefs_v1";

/** 读出偏好；设备不支持或数据损坏时回落默认值。 */
export function loadSpeechPrefs(): SpeechPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_SPEECH_PREFS };
  try {
    const raw = window.localStorage.getItem(SPEECH_PREFS_KEY);
    if (!raw) return { ...DEFAULT_SPEECH_PREFS };
    const parsed = JSON.parse(raw) as Partial<SpeechPrefs>;
    return {
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : "",
      rate: clampNum(parsed.rate, 0.5, 2, 1),
      pitch: clampNum(parsed.pitch, 0, 2, 1),
    };
  } catch {
    return { ...DEFAULT_SPEECH_PREFS };
  }
}

export function saveSpeechPrefs(p: SpeechPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPEECH_PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式下写入会抛错，忽略 */
  }
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" && isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

/** 当前设备可用的语音；不可用时返回空数组。 */
export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

/**
 * 监听语音列表就绪。
 *
 * getVoices() 首次调用常返回空数组（语音表是异步加载的），
 * 直接挑就会挑不到、退回浏览器默认那个最难听的 —— 所以必须等 voiceschanged。
 * 返回一个取消订阅的函数。
 */
export function onVoicesReady(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  const first = listVoices();
  if (first.length) cb(first);
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return () => {};
  const handler = () => cb(listVoices());
  try {
    window.speechSynthesis.addEventListener("voiceschanged", handler);
  } catch {
    return () => {};
  }
  // 部分浏览器不触发 voiceschanged（尤其 iOS Safari），补一次轮询兜底
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const v = listVoices();
    if (v.length || tries >= 10) {
      clearInterval(timer);
      if (v.length) cb(v);
    }
  }, 250);
  return () => {
    clearInterval(timer);
    try {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
    } catch {
      /* 忽略 */
    }
  };
}

/** 听起来像真人、或至少是新一代合成器的语音；命中即加分。 */
const GOOD_HINTS: Array<[string, number]> = [
  ["siri", 60],
  ["enhanced", 55],
  ["premium", 55],
  ["neural", 50],
  ["natural", 50],
  ["online", 38],
  ["google", 34],
  ["xiaoxiao", 34],
  ["yunxi", 30],
  ["yunyang", 30],
  ["xiaoyi", 30],
  ["yaoyao", 24],
  ["huihui", 22],
  ["tingting", 20],
  ["sinji", 20],
  ["meijia", 18],
  ["yating", 18],
  ["jenny", 16],
  ["aria", 16],
  ["guy", 14],
  ["libby", 14],
  ["sonia", 12],
  ["microsoft", 10],
];

/** 机械感强或纯恶搞的语音；命中即大幅扣分。 */
const BAD_HINTS: Array<[string, number]> = [
  ["espeak", -300],
  ["pico", -300],
  ["compact", -160],
  ["robot", -120],
  ["zarvox", -120],
  ["trinoids", -120],
  ["deranged", -120],
  ["bahh", -120],
  ["bells", -120],
  ["boing", -120],
  ["bubbles", -120],
  ["cellos", -120],
  ["jester", -120],
  ["organ", -120],
  ["superstar", -120],
  ["wobble", -120],
  ["albert", -100],
  ["whisper", -80],
];

/**
 * 给语音打分。
 *
 * 同一语言下设备里往往同时装着好几代合成器（比如 iOS 的旧版 Ting-Ting 和
 * 新版 Sinji、Windows 的老 Desktop 语音和 Neural 语音）。
 * 按 lang 精确匹配取第一个 —— 拿到的几乎总是最老的那个，所以必须排序。
 */
export function scoreVoice(v: SpeechSynthesisVoice, want: string): number {
  const lang = (v.lang || "").toLowerCase().replace("_", "-");
  const target = (want || "").toLowerCase().replace("_", "-");
  const base = target.split("-")[0];

  let score = 0;
  if (lang === target) score += 120;
  else if (base && lang.split("-")[0] === base) score += 50;
  else if (base === "zh" && lang.split("-")[0] === "cmn") score += 40;
  else score -= 300; // 语言完全不匹配，基本不可用

  const name = (v.name || "").toLowerCase();
  for (const [hint, add] of GOOD_HINTS) if (name.includes(hint)) score += add;
  for (const [hint, add] of BAD_HINTS) if (name.includes(hint)) score += add;

  // 已下载到本地的语音通常更新、更自然；但 Google 系是远端却不差，故只轻加权
  if (v.localService) score += 12;

  // 旧版 iOS 中文音「Ting-Ting」带连字符，是老合成器
  if (name.includes("ting-ting")) score -= 40;
  // Windows 上标注 Desktop 的是老一代
  if (name.includes("desktop")) score -= 35;

  return score;
}

/**
 * 挑一个匹配语言的语音。
 *
 * 传了 prefs 且指定过 voiceURI 时优先用用户选的。
 * 挑不到就返回 null，交给浏览器默认。
 */
export function pickVoice(lang: string, prefs?: SpeechPrefs | null): SpeechSynthesisVoice | null {
  const voices = listVoices();
  if (!voices.length) return null;

  if (prefs && prefs.voiceURI) {
    const chosen = voices.find((v) => v.voiceURI === prefs.voiceURI);
    if (chosen) return chosen;
  }

  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreVoice(v, lang);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return best;
}
