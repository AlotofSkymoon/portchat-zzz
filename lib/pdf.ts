/**
 * 极简 PDF 生成器（无第三方依赖）。
 *
 * 需求只是「生成一张恭喜函 PDF」，为此引入 pdfkit / jsPDF 太重，
 * 而且它们依赖 Node 的 stream / fs，在 Edge 或 Serverless 上不一定好用。
 * 这里直接手写 PDF 语法，只用到 base14 字体，无需嵌入字体文件。
 *
 * ⚠️ 中文问题：base14 字体**不包含**中文字形。
 * 所以固定文案（贺词、底部说明）走「位图」—— 由 scripts/gen-reward-assets.py
 * 预先渲染成 deflate 后的 RGB，运行时直接嵌进 PDF，永不乱码。
 * 动态内容（转移码、域名）是 ASCII，用 Courier 等宽字体绘制，
 * 等宽还有一个好处：宽度 = 字符数 × 0.6em，能精确算出居中位置。
 */

/** PDF 字符串转义：反斜杠、括号必须转义，非 ASCII 直接丢弃（避免黑块） */
function esc(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7e]/g, "?");
}

export type PdfTextBlock = {
  kind?: "text";
  text: string;
  /** 字号（pt） */
  size?: number;
  /** 距上一块的额外间距（pt） */
  gap?: number;
  /** 粗体 */
  bold?: boolean;
  /** 等宽（Courier）——转移码、域名用，宽度可精确计算 */
  mono?: boolean;
  /** 颜色 [r,g,b]，0–1 */
  color?: [number, number, number];
  /** 水平居中 */
  center?: boolean;
};

export type PdfImageBlock = {
  kind: "image";
  /** deflate 压缩后的原始 RGB 像素 */
  data: Buffer;
  /** 显示宽度（pt） */
  width: number;
  /** 显示高度（pt） */
  height: number;
  gap?: number;
  center?: boolean;
};

export type PdfBlock = PdfTextBlock | PdfImageBlock;

/** 旧接口：纯文本行 */
export type PdfLine = Omit<PdfTextBlock, "kind">;

type Obj = { body: string };

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN_X = 56;
const MARGIN_TOP = 96;

/** Courier / Courier-Bold 是等宽字体，每个字符占 0.6em */
const MONO_ADVANCE = 0.6;

function monoWidth(text: string, size: number): number {
  return text.length * MONO_ADVANCE * size;
}

/**
 * 生成一份单页 A4 PDF。
 *
 * @param blocks 从上到下排列的块（文本 / 图片）
 * @param opts   title 作为 PDF 元数据的 Title
 */
export function buildPdf(blocks: PdfBlock[], opts: { title?: string } = {}): Buffer {
  const contentW = A4_W - MARGIN_X * 2;

  const objects: Obj[] = [];
  const add = (body: string): number => {
    objects.push({ body });
    return objects.length; // 1-based 对象号
  };

  // 1 Catalog, 2 Pages, 3 Page, 4 Contents, 5..8 Fonts, 9.. Images
  const catalogNo = add("");
  const pagesNo = add("");
  const pageNo = add("");
  const contentsNo = add("");
  const helvNo = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const helvBNo = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const courierNo = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
  );
  const courierBNo = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
  );

  const fontName = (b: PdfTextBlock): string => {
    if (b.mono) return b.bold ? "/F4" : "/F3";
    return b.bold ? "/F2" : "/F1";
  };

  // ---- 内容流 ----
  let y = A4_H - MARGIN_TOP;
  const parts: string[] = [];
  const imageNames: string[] = [];
  /** 图片对象的真实编号（不能硬编码，前面加字体就会错位） */
  const imageObjNos: number[] = [];

  for (const block of blocks) {
    if (block.kind === "image") {
      y -= block.gap ?? 0;
      y -= block.height; // 图片按**顶边**定位，先下移自身高度

      const no = add(
        `<< /Type /XObject /Subtype /Image /Width ${Math.round(block.width * 2)} ` +
          `/Height ${Math.round(block.height * 2)} /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
          `/Filter /FlateDecode /DecodeParms << /Predictor 1 /Columns ${Math.round(
            block.width * 2,
          )} /Colors 3 /BitsPerComponent 8 >> /Length ${block.data.length} >>\n` +
          `stream\n`,
      );
      // 二进制字节不能拼进 latin1 字符串，挂在对象上，序列化阶段再插入
      (objects[no - 1] as Obj & { binary?: Buffer }).binary = block.data;
      imageNames.push(`/Im${imageNames.length + 1}`);
      imageObjNos.push(no);

      const x = block.center ? MARGIN_X + (contentW - block.width) / 2 : MARGIN_X;
      parts.push(
        `q ${block.width.toFixed(2)} 0 0 ${block.height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(
          2,
        )} cm ${imageNames[imageNames.length - 1]} Do Q`,
      );
      y -= 12; // 图片后的基础间距
      continue;
    }

    const size = block.size ?? 12;
    y -= block.gap ?? 0;
    y -= size; // 文本基线：Tm 给的是基线位置，先让出字号高度

    let x = MARGIN_X;
    if (block.center) {
      const w = block.mono ? monoWidth(block.text, size) : 0;
      if (w > 0) x = MARGIN_X + (contentW - w) / 2;
    }

    const [r, g, b] = block.color ?? [0.07, 0.09, 0.15];
    parts.push(
      `BT ${fontName(block)} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(
        2,
      )} Tm (${esc(block.text)}) Tj ET`,
    );
    y -= size * 0.5; // 行距
  }

  const stream = parts.join("\n");
  objects[contentsNo - 1] = {
    body: `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  };

  const fontRes =
    `/F1 ${helvNo} 0 R /F2 ${helvBNo} 0 R /F3 ${courierNo} 0 R /F4 ${courierBNo} 0 R`;
  const imgRes = imageNames.map((n, i) => `${n} ${imageObjNos[i]} 0 R`).join(" ");

  objects[pageNo - 1] = {
    body:
      `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
      `/Resources << /Font << ${fontRes} >>` +
      (imgRes ? ` /XObject << ${imgRes} >>` : "") +
      ` >> /Contents ${contentsNo} 0 R >>`,
  };
  objects[pagesNo - 1] = {
    body: `<< /Type /Pages /Kids [${pageNo} 0 R] /Count 1 >>`,
  };
  objects[catalogNo - 1] = { body: `<< /Type /Catalog /Pages ${pagesNo} 0 R >>` };

  const infoNo = add(
    `<< /Title (${esc(opts.title ?? "Certificate")}) /Producer (Pot) >>`,
  );

  // ---- 序列化（图片是二进制，必须按字节拼） ----
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  let cursor = Buffer.byteLength("%PDF-1.4\n", "latin1");
  const offsets: number[] = [];

  objects.forEach((obj, i) => {
    offsets.push(cursor);
    const header = Buffer.from(`${i + 1} 0 obj\n${obj.body}`, "latin1");
    chunks.push(header);
    cursor += header.length;

    const bin = (obj as Obj & { binary?: Buffer }).binary;
    if (bin) {
      chunks.push(bin);
      cursor += bin.length;
      const tail = Buffer.from("\nendstream\nendobj\n", "latin1");
      chunks.push(tail);
      cursor += tail.length;
    } else {
      const tail = Buffer.from("\nendobj\n", "latin1");
      chunks.push(tail);
      cursor += tail.length;
    }
  });

  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(chunks);
}
