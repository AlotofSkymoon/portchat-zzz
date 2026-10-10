/**
 * 极简 QR 码生成器（byte 模式 / 纠错等级 M / 版本 1–10）。
 *
 * 为什么自己写：项目里没装 qrcode 库，而二维码登录只需要「把一段 URL 画出来」，
 * 引一个依赖（连带它的 canvas / png 依赖）不划算。
 * 生成的是布尔矩阵，页面直接拿去画 SVG，没有位图、没有外部请求。
 *
 * 覆盖范围刻意做窄：只支持 byte 模式 + 等级 M，版本最多 10（可容 213 字节）。
 * 登录链接远小于这个量，超出就明确报错，不静默截断。
 */

/* ---------------- GF(256)，本原多项式 0x11d ---------------- */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** 生成多项式 (x-α^0)(x-α^1)…(x-α^{n-1})，高次在前。 */
function genPoly(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i += 1) {
    const ng = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j += 1) {
      ng[j] ^= g[j];
      ng[j + 1] ^= gfMul(g[j], GF_EXP[i]);
    }
    g = ng;
  }
  return g;
}

/** Reed–Solomon 余式，即纠错码字。 */
function eccFor(data: number[], n: number): number[] {
  const g = genPoly(n);
  const res = new Array<number>(n).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < n; i += 1) res[i] ^= gfMul(g[i + 1], factor);
  }
  return res;
}

/* ---------------- 版本表（等级 M） ----------------
 * ecPerBlock：每块纠错码字数
 * g1Blocks / g1Data：第一组块数与每块数据码字
 * g2Blocks / g2Data：第二组（不足时为 0）
 */
type VerSpec = {
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
  align: number[];
};
const VERSIONS: Record<number, VerSpec> = {
  1: { ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0, align: [] },
  2: { ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0, align: [6, 18] },
  3: { ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0, align: [6, 22] },
  4: { ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0, align: [6, 26] },
  5: { ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0, align: [6, 30] },
  6: { ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0, align: [6, 34] },
  7: { ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0, align: [6, 22, 38] },
  8: { ecPerBlock: 22, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39, align: [6, 24, 42] },
  9: { ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37, align: [6, 26, 46] },
  10: { ecPerBlock: 26, g1Blocks: 4, g1Data: 43, g2Blocks: 1, g2Data: 44, align: [6, 28, 50] },
};

function bitLen(x: number): number {
  let n = 0;
  while (x !== 0) {
    n += 1;
    x >>>= 1;
  }
  return n;
}
function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

/** 等级 M 的指示位为 00；这里固定只用 M。 */
function formatBits(mask: number): number {
  const data = (0 << 3) | mask;
  let rem = data << 10;
  while (bitLen(rem) >= 11) rem ^= 0x537 << (bitLen(rem) - 11);
  return ((data << 10) | rem) ^ 0x5412;
}
function versionBits(v: number): number {
  let rem = v << 12;
  while (bitLen(rem) >= 13) rem ^= 0x1f25 << (bitLen(rem) - 13);
  return (v << 12) | rem;
}

/* ---------------- 掩码 ---------------- */
const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(m: boolean[][], size: number): number {
  let p = 0;
  const line = (get: (i: number) => boolean): void => {
    let run = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === get(i - 1)) {
        run += 1;
      } else {
        if (run >= 5) p += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) p += 3 + (run - 5);
  };
  for (let r = 0; r < size; r += 1) line((i) => m[r][i]);
  for (let c = 0; c < size; c += 1) line((i) => m[i][c]);

  // 2x2 同色
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
  }

  // 1:1:3:1:1 前后各 4 个浅色的图形
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  const match = (seq: boolean[], at: number, pat: boolean[]): boolean => {
    for (let k = 0; k < pat.length; k += 1) if (seq[at + k] !== pat[k]) return false;
    return true;
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c + 11 <= size; c += 1) {
      for (let i = 0; i + 11 <= size; i += 1) void i;
      const row: boolean[] = [];
      const col: boolean[] = [];
      for (let k = 0; k < 11; k += 1) {
        row.push(m[r][c + k]);
        col.push(m[c + k][r]);
      }
      if (match(row, 0, pat1) || match(row, 0, pat2)) p += 40;
      if (r + 11 <= size && (match(col, 0, pat1) || match(col, 0, pat2))) p += 40;
    }
  }

  // 黑白比例偏离 50% 的程度
  let dark = 0;
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (m[r][c]) dark += 1;
  }
  const percent = (dark * 100) / (size * size);
  p += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return p;
}

/** 生成二维码矩阵。text 会自动按 UTF-8 编码。 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v += 1) {
    const s = VERSIONS[v];
    const dataCodewords = s.g1Blocks * s.g1Data + s.g2Blocks * s.g2Data;
    const countBits = v <= 9 ? 8 : 16;
    const needBits = 4 + countBits + bytes.length * 8;
    if (needBits <= dataCodewords * 8) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error("QR_TOO_LONG");

  const spec = VERSIONS[version];
  const size = version * 4 + 17;
  const countBits = version <= 9 ? 8 : 16;
  const dataCodewords = spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data;

  /* --- 位流 --- */
  const bits: number[] = [];
  const pushBits = (val: number, n: number): void => {
    for (let i = n - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(bytes.length, countBits);
  for (const b of bytes) pushBits(b, 8);
  // 终止符 + 补齐到字节
  const cap = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < cap; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k += 1) b = (b << 1) | bits[i + k];
    codewords.push(b);
  }
  const pads = [0xec, 0x11];
  let pi = 0;
  while (codewords.length < dataCodewords) {
    codewords.push(pads[pi % 2]);
    pi += 1;
  }

  /* --- 分块 + 纠错 --- */
  const blocks: number[][] = [];
  let off = 0;
  for (let i = 0; i < spec.g1Blocks; i += 1) {
    blocks.push(codewords.slice(off, off + spec.g1Data));
    off += spec.g1Data;
  }
  for (let i = 0; i < spec.g2Blocks; i += 1) {
    blocks.push(codewords.slice(off, off + spec.g2Data));
    off += spec.g2Data;
  }
  const ecs = blocks.map((b) => eccFor(b, spec.ecPerBlock));

  const finalBytes: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const b of blocks) if (i < b.length) finalBytes.push(b[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const e of ecs) finalBytes.push(e[i]);
  }

  /* --- 画功能图形 --- */
  const m: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, v: boolean): void => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    m[r][c] = v;
    fn[r][c] = true;
  };
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && y >= 0 && x < size && y < size) set(y, x, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const ax of spec.align) {
    for (const ay of spec.align) {
      // 与定位图案重叠的三个位置不画
      const near =
        (ax === 6 && ay === 6) ||
        (ax === 6 && ay === size - 7) ||
        (ax === size - 7 && ay === 6);
      if (near) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          set(ay + dy, ax + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // 预留格式信息区
  for (let i = 0; i < 9; i += 1) {
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(b, a, false);
      set(a, b, false);
    }
  }

  /* --- 填数据 --- */
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < finalBytes.length * 8) {
          m[y][x] = getBit(finalBytes[bi >>> 3], 7 - (bi & 7));
          bi += 1;
        }
      }
    }
  }

  /* --- 选掩码 --- */
  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  let best: boolean[][] = m;
  for (let mask = 0; mask < 8; mask += 1) {
    const cand = m.map((row, r) => row.map((v, c) => (fn[r][c] ? v : v !== MASKS[mask](r, c))));
    // 画上格式信息（用当前掩码）+ 版本信息
    const fb = formatBits(mask);
    for (let i = 0; i <= 5; i += 1) cand[i][8] = getBit(fb, i);
    cand[7][8] = getBit(fb, 6);
    cand[8][8] = getBit(fb, 7);
    cand[8][7] = getBit(fb, 8);
    for (let i = 9; i < 15; i += 1) cand[8][14 - i] = getBit(fb, i);
    for (let i = 0; i < 8; i += 1) cand[8][size - 1 - i] = getBit(fb, i);
    for (let i = 8; i < 15; i += 1) cand[size - 15 + i][8] = getBit(fb, i);
    cand[size - 8][8] = true;
    if (version >= 7) {
      const vb = versionBits(version);
      for (let i = 0; i < 18; i += 1) {
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        const bit = getBit(vb, i);
        cand[b][a] = bit;
        cand[a][b] = bit;
      }
    }
    const score = penalty(cand, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      best = cand;
    }
  }
  void bestMask;
  return best;
}

/** 矩阵 → SVG 路径（viewBox 用格数，方便自适应缩放）。 */
export function qrSvgPath(matrix: boolean[][], quiet = 2): string {
  const n = matrix.length;
  const parts: string[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (matrix[r][c]) parts.push(`M${c + quiet} ${r + quiet}h1v1h-1z`);
    }
  }
  return parts.join("");
}

/** 矩阵 → 包含静默区的 SVG 尺寸。 */
export function qrViewBox(matrix: boolean[][], quiet = 2): number {
  return matrix.length + quiet * 2;
}
