"use client";

import * as React from "react";
import { Camera, Loader2, X } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { canUseCamera, closeCamera, decodeVideoFrame, openCamera } from "@/lib/qr-scan";

/**
 * 扫码登录的相机取景框。
 *
 * 扫到内容就 `onResult(text)`，由调用方决定怎么用 ——
 * 这里只负责「把画面里的二维码读成字符串」，不掺业务逻辑。
 *
 * 几个必须处理的现实问题：
 * - iOS Safari 要 `playsinline`，否则一开相机就全屏
 * - 用户拒绝授权 / 没有摄像头 / 非 HTTPS，都要给出人话提示，不能只留黑屏
 * - 关闭时必须停掉所有轨道，不然摄像头指示灯一直亮着
 */
export function QrScanner({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const stoppedRef = React.useRef(false);
  const [error, setError] = React.useState("");
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    stoppedRef.current = false;
    setError("");
    setReady(false);

    if (!canUseCamera()) {
      setError(t("auth.scanUnsupported"));
      return;
    }

    let cancelled = false;

    async function run() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      try {
        streamRef.current = await openCamera(video);
        if (cancelled) return;
        setReady(true);
      } catch {
        // NotAllowedError = 用户拒绝；NotFoundError = 没摄像头；其余一律归到失败
        setError(t("auth.scanDenied"));
        return;
      }

      /*
       * 逐帧尝试解码。
       *
       * 不做连续 requestAnimationFrame：那样一秒跑 60 次解码，手机上直接发烫。
       * 每 120ms 解一次足够跟手（人举着手机对准本来就要一两秒）。
       */
      while (!stoppedRef.current && !cancelled) {
        const text = await decodeVideoFrame(video, canvas).catch(() => null);
        if (text) {
          stoppedRef.current = true;
          onResult(text);
          return;
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    void run();

    return () => {
      cancelled = true;
      stoppedRef.current = true;
      closeCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [open, onResult, t]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Camera className="h-4 w-4" />
            {t("auth.scanTitle")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative aspect-square w-full bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* 取景框：四角描边，中间留空，让人知道该把码放在哪 */}
          {ready && !error ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-48 w-48">
                <span className="absolute left-0 top-0 h-6 w-6 rounded-tl-lg border-l-2 border-t-2 border-white/90" />
                <span className="absolute right-0 top-0 h-6 w-6 rounded-tr-lg border-r-2 border-t-2 border-white/90" />
                <span className="absolute bottom-0 left-0 h-6 w-6 rounded-bl-lg border-b-2 border-l-2 border-white/90" />
                <span className="absolute bottom-0 right-0 h-6 w-6 rounded-br-lg border-b-2 border-r-2 border-white/90" />
              </div>
            </div>
          ) : null}

          {!ready && !error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-white/70">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("auth.scanStarting")}
            </div>
          ) : null}

          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-white/90">{error}</p>
              <p className="text-[11px] text-white/60">{t("auth.scanFallback")}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 px-4 py-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{t("auth.scanHint")}</p>
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
