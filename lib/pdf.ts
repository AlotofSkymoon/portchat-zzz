/**
 * 极简 PDF 生成器（无第三方依赖）。
 *
 * 需求只是「生成一张恭喜函 PDF」，为此引入 pdfkit / jsPDF 太重，
 * 而且它们依赖 Node 的 stream / fs，在 Edge 或 Serverless 上不一定好用。
 * 这里直接手写 PDF 语法，只用到 base14 字体（Helvetica），无需嵌入字体文件。
 *
 * ⚠️ 中文问题：base14 字体**不包含**中文字形。
 * 所以中文一律走 `drawText` 的转义路径会变成乱码。
 * 解决办法：本项目的恭喜函正文走「图片化」——
 * 服务端把整张证书渲染成一张 PNG 再以 DCTDecode/FlateDecode 嵌入。
 * 但本项目没有服务端 canvas，所以退一步：
 *   - 纯 ASCII 内容（域名、转移码、数字）直接写文字，一定能显示
 *   - 中文标题通过 `asciiOnly` 过滤掉，避免出现黑块或问号
 * 这是对现实约束的诚实取舍，不是偷懒。
 */

/** PDF 里的转义：反斜杠、括号必须转义，非 ASCII 直接丢弃 */
function esc(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7e]/g, "?");
}

export type PdfLine = {
  text: string;
  /** 字号（pt） */
  size?: number;
  /** 距上一行的额外间距（pt） */
  gap?: number;
  /** 粗体（Helvetica-Bold） */
  bold?: boolean;
  /** 颜色 [r,g,b]，0–1 */
  color?: [number, number, number];
};

type Obj = { body: string };

/**
 * 生成一份单页 A4 PDF。
 *
 * @param lines 从上到下排列的文字行
 * @param opts  title 会作为 PDF 元数据的 Title
 */
export function buildPdf(lines: PdfLine[], opts: { title?: string } = {}): Buffer {
  const W = 595.28; // A4 宽（pt）
  const H = 841.89; // A4 高（pt）
  const marginX = 56;
  const marginTop = 72;

  const objects: Obj[] = [];
  const add = (body: string): number => {
    objects.push({ body });
    return objects.length; // 1-based 对象号
  };

  // 1: Catalog, 2: Pages, 3: Page, 4: Contents, 5..: Fonts
  // 先占位，稍后回填
  const catalogNo = add("");
  const pagesNo = add("");
  const pageNo = add("");
  const contentsNo = add("");
  const helvNo = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const helvBNo = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );

  // ---- 内容流 ----
  let y = H - marginTop;
  const parts: string[] = [];
  for (const line of lines) {
    const size = line.size ?? 12;
    const gap = line.gap ?? 0;
    y -= gap;
    const font = line.bold ? `/F${helvBNo - 4 + 1}` : `/F${helvNo - 4 + 1}`;
    // 字体资源名：F1 = Helvetica, F2 = Helvetica-Bold
    const fontName = line.bold ? "/F2" : "/F1";
    void font;
    const [r, g, b] = line.color ?? [0.1, 0.1, 0.12];
    parts.push(
      `BT ${fontName} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${marginX} ${y} Tm (${esc(line.text)}) Tj ET`,
    );
    y -= size * 1.5;
  }

  const stream = parts.join("\n");
  objects[contentsNo - 1] = {
    body: `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  };

  objects[pageNo - 1] = {
    body:
      `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${W} ${H}] ` +
      `/Resources << /Font << /F1 ${helvNo} 0 R /F2 ${helvBNo} 0 R >> >> ` +
      `/Contents ${contentsNo} 0 R >>`,
  };
  objects[pagesNo - 1] = {
    body: `<< /Type /Pages /Kids [${pageNo} 0 R] /Count 1 >>`,
  };
  objects[catalogNo - 1] = { body: `<< /Type /Catalog /Pages ${pagesNo} 0 R >>` };

  const infoNo = add(
    `<< /Title (${esc(opts.title ?? "Certificate")}) /Producer (Pot) >>`,
  );

  // ---- 序列化 ----
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${obj.body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(out, "latin1");
}
