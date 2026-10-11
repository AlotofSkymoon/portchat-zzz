/**
 * 相机扫码（客户端）。
 *
 * 二维码内容**只有登录令牌本身**（形如 `id.secret`），不是网址 ——
 * 这样扫出来的东西不含域名，换域名部署也不会扫出一个打不开的链接；
 * 令牌怎么用它由登录页决定（拿到后直接去换会话）。
 *
 * 解码走两级：
 *   1. 系统自带的 BarcodeDetector（Chrome / Edge / 安卓上有，最省电）
 *   2. 兜底用 jsQR（纯 JS，动态 import，不点扫码就不会加载）
 *
 * iOS Safari 没有 BarcodeDetector，所以 jsQR 这条兜底路径是必需的，
 * 不能只做第一种。
 */

/** 原生检测器（并非所有浏览器都有，类型是浏览器提供的） */
interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type NativeDetectorCtor = new (opts: { formats: string[] }) => NativeDetector;

function nativeCtor(): NativeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: NativeDetectorCtor };
  return typeof w.BarcodeDetector === "function" ? w.BarcodeDetector : null;
}

export function hasNativeDetector(): boolean {
  return nativeCtor() !== null;
}

/** 相机能不能用：必须是安全上下文（HTTPS 或 localhost），否则浏览器不给开 */
export function canUseCamera(): boolean {
  if (typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

export async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!canUseCamera()) throw new Error("camera_unsupported");
  const stream = await navigator.mediaDevices.getUserMedia({
    // 优先后置摄像头：扫码是对着别人的屏幕拍，前置自拍镜头几乎没用
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute("playsinline", "true"); // iOS 不写这行会强制全屏播放
  await video.play();
  return stream;
}

export function closeCamera(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/**
 * 从当前视频帧里解一个二维码。
 *
 * @returns 解出来的文本；没解到返回 null
 */
export async function decodeVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): Promise<string | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  // 解码只需要亮度，拿太大没意义：长边压到 640，二维码模块数远小于此
  const scale = Math.min(1, 640 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  canvas.width = cw;
  canvas.height = ch;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, cw, ch);

  const Ctor = nativeCtor();
  if (Ctor) {
    try {
      const found = await new Ctor({ formats: ["qr_code"] }).detect(canvas);
      const text = found?.[0]?.rawValue;
      if (text) return text;
    } catch {
      /* 原生失败就继续走 jsQR，不要因为一次异常卡死整个扫描 */
    }
  }

  try {
    const { default: jsQR } = await import("jsqr");
    const img = ctx.getImageData(0, 0, cw, ch);
    const res = jsQR(img.data, cw, ch, { inversionAttempts: "dontInvert" });
    return res?.data ?? null;
  } catch {
    return null;
  }
}
