"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  Film,
  ImagePlus,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  IMAGE_MAX_COUNT,
  IMAGE_RATIOS,
  IMAGE_SIZES,
  VIDEO_MAX_POLLS,
  VIDEO_RATIOS,
  VIDEO_SECONDS,
  VIDEO_SIZES,
} from "@/lib/config";

type GenResult = {
  images: string[];
  sent: { prompt: string; model: string; size: string; ratio: string; n: number };
};

type Mode = "image" | "video";

/** 轮询间隔。视频生成动辄几十秒，太快只是白刷请求。 */
const POLL_MS = 5000;

/**
 * 独立创作页（图片 / 视频）。
 *
 * 为什么要跟聊天输入框分开：混在一起时，提示词容易被输入框里的
 * 残留内容、上一条追问污染，出了怪图根本没法判断到底是提示词的锅
 * 还是上游的锅。这里给一个干净的单输入框，并且把「实际发给上游的
 * 内容」原样显示出来，一眼就能对上。
 */
export function CreateView() {
  const { t } = useI18n();

  const [mode, setMode] = React.useState<Mode>("image");

  const [prompt, setPrompt] = React.useState("");
  const [ratio, setRatio] = React.useState<string>("1:1");
  const [size, setSize] = React.useState<string>("1K");
  const [count, setCount] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<GenResult | null>(null);
  const [error, setError] = React.useState("");
  const [refImage, setRefImage] = React.useState<string>("");
  const [refName, setRefName] = React.useState("");

  // 视频
  const [vSeconds, setVSeconds] = React.useState<string>("5");
  const [vRatio, setVRatio] = React.useState<string>("16:9");
  // Flash 强制 720P，不给用户选（见 VIDEO_SIZES 注释）
  const vSize: string = VIDEO_SIZES[0];
  const [vBusy, setVBusy] = React.useState(false);
  const [vProgress, setVProgress] = React.useState(0);
  const [vUrl, setVUrl] = React.useState("");
  const [vSent, setVSent] = React.useState<Record<string, string> | null>(null);

  const fileRef = React.useRef<HTMLInputElement>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollsRef = React.useRef(0);

  /** 卸载或切换页时停掉轮询，避免后台一直打接口 */
  const stopPoll = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  React.useEffect(() => stopPoll, [stopPoll]);

  const pickRef = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) {
        setError(t("create.refTooBig"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setRefImage(String(reader.result ?? ""));
        setRefName(f.name);
        setError("");
      };
      reader.readAsDataURL(f);
    },
    [t],
  );

  const download = React.useCallback(async (url: string, ext: string) => {
    try {
      const blob = url.startsWith("data:") ? await (await fetch(url)).blob() : null;
      const href = blob ? URL.createObjectURL(blob) : url;
      const a = document.createElement("a");
      a.href = href;
      a.download = `portchat-${Date.now()}.${ext}`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (blob) URL.revokeObjectURL(href);
    } catch {
      /* 跨域无法直接下载时，退化为新标签打开 */
      window.open(url, "_blank", "noopener");
    }
  }, []);

  /* ------------------------------ 图片 ------------------------------ */

  const generate = React.useCallback(async () => {
    const p = prompt.trim();
    if (!p) {
      setError(t("create.needPrompt"));
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: p,
          n: count,
          ratio,
          size,
          image: refImage || undefined,
        }),
      });
      const data = (await res.json()) as GenResult & { error?: string };
      if (!res.ok || !data.images?.length) {
        setError(data.error ?? t("create.failed"));
        return;
      }
      setResult({ images: data.images, sent: data.sent });
    } catch {
      setError(t("create.networkErr"));
    } finally {
      setBusy(false);
    }
  }, [count, prompt, ratio, refImage, size, t]);

  /* ------------------------------ 视频 ------------------------------ */

  /** 查一次进度。返回 true 表示已结束（成功或失败），不用再排下一次。 */
  const pollOnce = React.useCallback(
    async (videoId: string): Promise<boolean> => {
      const res = await fetch(
        `/api/videos?video_id=${encodeURIComponent(videoId)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        status?: string;
        progress?: number;
        url?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? t("create.videoFailed"));
        return true;
      }
      setVProgress(Number(data.progress ?? 0) || 0);

      if (data.status === "completed" && data.url) {
        setVUrl(data.url);
        return true;
      }
      if (data.status === "failed") {
        setError(data.error || t("create.videoFailed"));
        return true;
      }
      return false;
    },
    [t],
  );

  const schedulePoll = React.useCallback(
    (videoId: string) => {
      stopPoll();
      timerRef.current = setTimeout(async () => {
        pollsRef.current += 1;
        let done = false;
        try {
          done = await pollOnce(videoId);
        } catch {
          // 单次网络抖动不算失败，继续下一轮，直到轮询上限
        }
        if (done) {
          setVBusy(false);
          return;
        }
        if (pollsRef.current >= VIDEO_MAX_POLLS) {
          setVBusy(false);
          setError(t("create.videoTimeout"));
          return;
        }
        schedulePoll(videoId);
      }, POLL_MS);
    },
    [pollOnce, stopPoll, t],
  );

  const generateVideo = React.useCallback(async () => {
    const p = prompt.trim();
    if (!p) {
      setError(t("create.needPrompt"));
      return;
    }
    stopPoll();
    setVBusy(true);
    setError("");
    setVUrl("");
    setVProgress(0);
    setVSent(null);
    pollsRef.current = 0;
    try {
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: p,
          seconds: vSeconds,
          aspectRatio: vRatio,
          size: vSize,
        }),
      });
      const data = (await res.json()) as {
        videoId?: string;
        url?: string;
        status?: string;
        sent?: Record<string, string>;
        error?: string;
      };
      if (!res.ok || !data.videoId) {
        setVBusy(false);
        setError(data.error ?? t("create.videoFailed"));
        return;
      }
      setVSent(data.sent ?? null);

      // 少数情况下上游同步就给了 url，省掉轮询
      if (data.url) {
        setVUrl(data.url);
        setVProgress(100);
        setVBusy(false);
        return;
      }
      schedulePoll(data.videoId);
    } catch {
      setVBusy(false);
      setError(t("create.networkErr"));
    }
  }, [prompt, schedulePoll, stopPoll, t, vRatio, vSeconds, vSize]);

  /* ------------------------------ 渲染 ------------------------------ */

  const chip = (active: boolean) =>
    `rounded-md border px-2 py-1 text-xs transition ${
      active ? "border-fg bg-fg/10" : "border-border hover:bg-muted"
    }`;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-24">
      {/* 返回聊天 */}
      <Link
        href="/chat"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("auth.backToChat")}
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("route.create")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "image" ? t("create.subtitle") : t("create.videoSubtitle")}
        </p>
      </div>

      {/* 图片 / 视频 切换 */}
      <div className="mb-5 inline-flex rounded-lg border border-border p-1">
        <button
          type="button"
          onClick={() => setMode("image")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${
            mode === "image" ? "bg-fg/10 text-fg" : "text-muted-foreground hover:text-fg"
          }`}
        >
          <ImagePlus className="h-4 w-4" />
          {t("create.tabImage")}
        </button>
        <button
          type="button"
          onClick={() => setMode("video")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${
            mode === "video" ? "bg-fg/10 text-fg" : "text-muted-foreground hover:text-fg"
          }`}
        >
          <Film className="h-4 w-4" />
          {t("create.tabVideo")}
        </button>
      </div>

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("create.promptPlaceholder")}
        rows={4}
        className="resize-y"
      />

      {mode === "image" ? (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {t("create.ratio")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_RATIOS.map((r) => (
                  <button key={r} type="button" onClick={() => setRatio(r)} className={chip(ratio === r)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {t("create.size")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {IMAGE_SIZES.map((s) => (
                  <button key={s} type="button" onClick={() => setSize(s)} className={chip(size === s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {t("create.count")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: IMAGE_MAX_COUNT }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`h-7 w-7 rounded-md border text-xs transition ${
                      count === n ? "border-fg bg-fg/10" : "border-border hover:bg-muted"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={pickRef}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" />
              {t("create.refImage")}
            </Button>
            {refImage ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <img src={refImage} alt="" className="h-6 w-6 rounded object-cover" />
                {refName || t("create.refReady")}
                <button
                  type="button"
                  onClick={() => {
                    setRefImage("");
                    setRefName("");
                  }}
                  className="rounded p-0.5 hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t("create.refHint")}</span>
            )}
          </div>

          <Button className="mt-5 w-full sm:w-auto" onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? t("create.generating") : t("create.generate")}
          </Button>
        </>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {t("create.duration")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VIDEO_SECONDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setVSeconds(s)}
                    className={chip(vSeconds === s)}
                  >
                    {s}s
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                {t("create.ratio")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {VIDEO_RATIOS.map((r) => (
                  <button key={r} type="button" onClick={() => setVRatio(r)} className={chip(vRatio === r)}>
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/*
             * Flash 强制 720P：传 1080P / 1K / 2K 上游直接 400。
             * 所以这里不给选项，改成一句说明——选了必然失败，不如不让人选。
             */}
            <div className="text-xs text-muted-foreground">
              {t("create.size")}：{VIDEO_SIZES[0]}
              <span className="ml-2 opacity-70">{t("create.videoSizeFixed")}</span>
            </div>
          </div>

          <Button
            className="mt-5 w-full sm:w-auto"
            onClick={generateVideo}
            disabled={vBusy}
          >
            {vBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
            {vBusy ? t("create.videoRunning") : t("create.generate")}
          </Button>

          {/* 进度条：轮询期间给个可见反馈，否则用户以为卡死了 */}
          {vBusy ? (
            <div className="mt-4">
              <div className="mb-1 text-xs text-muted-foreground">
                {t("create.videoPolling")} {vProgress}%
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-fg transition-all"
                  style={{ width: `${Math.max(vProgress, 5)}%` }}
                />
              </div>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* 图片结果 */}
      {mode === "image" && result ? (
        <div className="mt-8">
          <div className="mb-3 text-sm font-medium">{t("create.result")}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {result.images.map((u, i) => (
              <div
                key={`${u}-${i}`}
                className="group relative overflow-hidden rounded-lg border border-border"
              >
                <img src={u} alt={`${prompt} ${i + 1}`} className="w-full object-cover" />
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-2 top-2 h-8 w-8 opacity-0 transition group-hover:opacity-100"
                  onClick={() => download(u, "png")}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* 排查区：把真正发给上游的内容摊开，便于判断怪图是提示词的锅还是上游的锅 */}
          <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-fg">{t("create.actualSent")}</div>
            <div>prompt：{result.sent.prompt}</div>
            <div>
              model：{result.sent.model} · size：{result.sent.size} · ratio：{result.sent.ratio} ·
              n：{result.sent.n}
            </div>
          </div>
        </div>
      ) : null}

      {/* 视频结果 */}
      {mode === "video" && vUrl ? (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">{t("create.result")}</span>
            <Button variant="outline" size="sm" onClick={() => download(vUrl, "mp4")}>
              <Download className="h-4 w-4" />
              {t("create.download")}
            </Button>
          </div>
          <video
            src={vUrl}
            controls
            playsInline
            className="w-full overflow-hidden rounded-lg border border-border bg-black"
          />

          {vSent ? (
            <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-fg">{t("create.actualSent")}</div>
              <div>prompt：{vSent.prompt}</div>
              <div>
                model：{vSent.model} · seconds：{vSent.seconds} · size：{vSent.size} ·
                aspect_ratio：{vSent.aspect_ratio}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
