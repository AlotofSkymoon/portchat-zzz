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

/** 挑一个匹配语言的语音，挑不到就交给浏览器默认。 */
export function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    return null;
  }
  if (!voices.length) return null;
  const want = lang.toLowerCase();
  const base = want.split("-")[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === want) ||
    voices.find((v) => v.lang.toLowerCase().split("-")[0] === base) ||
    null
  );
}
