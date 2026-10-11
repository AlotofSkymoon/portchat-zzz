#!/usr/bin/env python3
"""
生成月度奖励 PDF 需要的中文位图资源（lib/reward-assets.ts）。

为什么要把中文烧成图片：
    lib/pdf.ts 用的是 base14 字体（Helvetica / Courier），
    这组字体**不含中文字形**，非 ASCII 会被转义成 "?"。
    服务端没有 canvas、也不适合嵌入 10MB 的 CJK 字体，
    而贺词与说明是**固定文案**（只有转移码和域名是动态的 ASCII），
    所以把固定中文预渲染成位图，动态 ASCII 仍用 Courier 绘制 ——
    既不乱码，也不增加运行时依赖。

产物是 deflate 压缩后的 RGB 位图（base64），
PDF 里以 /Filter /FlateDecode /Predictor 1 直接嵌入。

重新生成：
    python3 scripts/gen-reward-assets.py
"""
import base64
import os
import zlib
from PIL import Image, ImageDraw, ImageFont

FONT_TTC = (
    "/nix/store/smgbvz9sqcikc18vf3i9ry2p5zlnb7h5-noto-fonts-cjk-sans-2.004"
    "/share/fonts/opentype/noto-cjk/NotoSansCJK-VF.otf.ttc"
)

# 显示宽度（pt）→ 渲染宽度 = 显示宽度 * SCALE
SCALE = 2

# ⚠️ TTC 里的字体顺序是 JP, KR, SC, TC, HK —— **不是** SC 打头。
# 用错 index 会把简体中文渲染成日文字形（"欢" → 日式的 "歓"），
# 看着像错别字，所以这里按名字取，不写死数字。
FACE = {
    "zh-CN": 2,  # Noto Sans CJK SC
    "zh-TW": 3,  # Noto Sans CJK TC
    "en": 2,
    "fr": 2,
}

TEXT = {
    "zh-CN": {
        "head": ["恭喜你获得每月调用次数第一名，", "我将会赠送一个域名来感谢你的喜欢。"],
        "foot": ["此域名来自DNSHE平台，需尽快于该平台内转移此域名"],
    },
    "zh-TW": {
        "head": ["恭喜你獲得每月調用次數第一名，", "我將會贈送一個網域來感謝你的喜歡。"],
        "foot": ["此網域來自DNSHE平台，需盡快於該平台內轉移此網域"],
    },
    "en": {
        "head": [
            "Congratulations! You sent the most messages this month.",
            "We would like to gift you a domain to say thank you.",
        ],
        "foot": ["This domain comes from DNSHE, please transfer it there soon."],
    },
    "fr": {
        "head": [
            "Félicitations ! Vous avez envoyé le plus de messages ce mois-ci.",
            "Nous vous offrons un nom de domaine pour vous remercier.",
        ],
        "foot": ["Ce domaine provient de DNSHE, transférez-le dès que possible."],
    },
}

# 拉丁文用同样字号会显得比中文小，缩放一下视觉重量
SIZE = {"zh-CN": (19, 11), "zh-TW": (19, 11), "en": (14, 9.5), "fr": (14, 9.5)}

INK = (17, 24, 39)       # 文字色
PAPER = (255, 255, 255)  # 与 A4 白纸一致，避免图片出现白框边


def render(lines, size_pt, line_height, width_pt, face=2):
    """把若干行文字渲染成一张白底 RGB 图。"""
    px_w = int(round(width_pt * SCALE))
    px_size = int(round(size_pt * SCALE))
    px_lh = int(round(size_pt * line_height * SCALE))
    px_h = px_lh * len(lines)

    font = ImageFont.truetype(FONT_TTC, px_size, index=face)
    img = Image.new("RGB", (px_w, px_h), PAPER)
    draw = ImageDraw.Draw(img)

    for i, line in enumerate(lines):
        # anchor="mm" 需要 Pillow >= 8；水平居中按整行算，最稳
        bbox = draw.textbbox((0, 0), line, font=font)
        w = bbox[2] - bbox[0]
        x = (px_w - w) / 2 - bbox[0]
        y = i * px_lh + (px_lh - px_size) / 2 - bbox[1]
        draw.text((x, y), line, font=font, fill=INK)

    return img, width_pt, px_h / SCALE


def pack(img):
    """deflate 压缩原始 RGB —— 结果可直接作为 PDF 的 FlateDecode 流。"""
    return zlib.compress(img.tobytes(), 9)


def main():
    blocks = {}
    for lang, spec in TEXT.items():
        face = FACE[lang]
        hs, fs = SIZE[lang]
        head_img, head_w, head_h = render(spec["head"], hs, 1.6, 460, face)
        foot_img, foot_w, foot_h = render(spec["foot"], fs, 1.5, 460, face)
        blocks[lang] = {
            "head": (head_img, head_w, head_h),
            "foot": (foot_img, foot_w, foot_h),
        }

    out = [
        "/**",
        " * 月度奖励贺信 PDF 的中文字形资源（**自动生成，请勿手改**）。",
        " *",
        " * 重新生成：python3 scripts/gen-reward-assets.py",
        " *",
        " * 内容说明：",
        " *   head = 贺词两行；foot = 底部说明一行。",
        " *   两者都是**固定文案**，所以预先烧成位图；",
        " *   转移码与域名是动态的 ASCII，运行时用 Courier 绘制，不在这里。",
        " *",
        " * 数据格式：deflate 压缩的原始 RGB 像素（无 PNG 头），",
        " * 可直接作为 PDF Image XObject 的 /Filter /FlateDecode 流。",
        " */",
        "",
        "export type RewardBitmap = {",
        "  /** deflated RGB */",
        "  data: string;",
        "  /** 显示宽度（pt） */",
        "  width: number;",
        "  /** 显示高度（pt） */",
        "  height: number;",
        "};",
        "",
        "const b64 = (s: string) => s;",
        "",
        "export const REWARD_BITMAPS: Record<string, { head: RewardBitmap; foot: RewardBitmap }> = {",
    ]

    for lang, blk in blocks.items():
        out.append(f'  "{lang}": {{')
        for name in ("head", "foot"):
            img, w, h = blk[name]
            raw = base64.b64encode(pack(img)).decode("ascii")
            # 每行 96 字符，避免单行过长
            chunks = [raw[i : i + 96] for i in range(0, len(raw), 96)]
            out.append(f"    {name}: {{")
            out.append(f"      width: {w},")
            out.append(f"      height: {round(h, 2)},")
            out.append('      data: ""')
            for c in chunks:
                out.append(f'        + b64("{c}")')
            out.append("      ,")
            out.append("    },")
        out.append("  },")
    out.append("};")
    out.append("")

    dest = os.path.join(os.path.dirname(__file__), "..", "lib", "reward-assets.ts")
    with open(dest, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("written", os.path.abspath(dest), os.path.getsize(dest), "bytes")


if __name__ == "__main__":
    main()
