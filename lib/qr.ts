/**
 * 二维码生成（给「扫码登录」用）。
 *
 * ⚠️ 这里原先是自己手写的编码器（byte 模式 / 纠错等级 M / 版本 1–10）。
 * 实测下来它生成的矩阵是错的：同样内容下，37×37 共 1369 个模块里
 * 有 579 个和标准库不一致（约 42%）。表现就是二维码画出来了、但扫不出来 ——
 * 纠错码只能容忍少量脏污，救不了编码阶段就错的码。
 *
 * 所以改成用成熟的 `qrcode` 包做编码，本文件只负责把它的输出转成页面要的
 * 布尔矩阵和 SVG 路径。这块没有省依赖的余地：
 * 自造的风险（扫不出来 = 整个功能作废）远大于多几十 KB 的打包体积。
 * 而且是按需 `await import("@/lib/qr")`，不点生成就不会加载。
 */
import QR from "qrcode";

/** 生成布尔矩阵（true = 深色模块）。 */
export function qrMatrix(text: string): boolean[][] {
  const qr = QR.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const bits = qr.modules.data;
  const matrix: boolean[][] = new Array(size);
  for (let r = 0; r < size; r += 1) {
    const row: boolean[] = new Array(size);
    for (let c = 0; c < size; c += 1) row[c] = bits[r * size + c] === 1;
    matrix[r] = row;
  }
  return matrix;
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
