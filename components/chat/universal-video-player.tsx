"use client";

import * as React from "react";
import { Loader2, Play, TriangleAlert } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";

/**
 * ffmpeg 加载器改为复用共享模块 —— 上传转码和播放端转码
 * 共用同一个实例，否则 32MB 的 core 会被下载两遍。
 */
import { loadFFmpeg } from "@/lib/video-transcode";

/** 取文案的函数签名：模块级函数也用它，避免把 hook 拆得到处都是 */
type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * 通用视频播放器。
 *
 * 浏览器原生只支持 mp4 / webm / ogg 三种容器。
 * wmv、mpg、mpg2、avi、flv、rmvb 这些**一律放不了** ——
 * 不是 bug，是浏览器根本没内置对应的解码器。
 *
 * 解决办法：把 ffmpeg 编译成 wasm，在浏览器里**现场转码成 mp4 再播放**。
 * 解码在客户端完成，服务端只存原文件，不烧服务器 CPU。
 *
 * 为什么不打包进项目：ffmpeg.wasm 核心约 25~32MB，
 * 塞进仓库会让 Cloudflare Workers（免费版脚本上限 1 MiB）直接部署失败。
 * 所以改成**首次播放时才从 CDN 按需加载**，用到才下载。
 */

/** ffmpeg.wasm 是单线程 core，转大文件必然超时/OOM。超过这个体积先劝退。 */
const SIZE_WARN_BYTES = 80 * 1024 * 1024;

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; progress: string }
  | { kind: "transcoding"; progress: string }
  | { kind: "ready"; url: string; via: string }
  | { kind: "error"; message: string; logs: string[] };

/** ffmpeg 原始输出（保留最近若干行）—— 失败时给用户看，否则无法定位 */
let recentLogs: string[] = [];

function pushLog(msg: string): void {
  if (!msg) return;
  recentLogs.push(msg);
  if (recentLogs.length > 500) recentLogs.shift();
}

/** 取最后几行有诊断价值的日志 */
function tailLogs(n = 8): string[] {
  const useful = recentLogs.filter(
    (l) =>
      l.trim() &&
      !/^\s*$/.test(l) &&
      // 滤掉纯粹的配置回显噪音
      !/^\s*(configuration|libavutil|libavcodec|libavformat|built with|Input #|Metadata)/.test(l),
  );
  return (useful.length ? useful : recentLogs).slice(-n);
}

/** 从 `-i` 的输出里解析流信息（ffmpeg.wasm 没有 ffprobe，只能读日志） */
function parseStreams(logs: string[]): { hasVideo: boolean; hasAudio: boolean; duration: string | null } {
  const joined = logs.join("\n");
  return {
    hasVideo: /Stream #\d+:\d+.*:\s*Video:/.test(joined),
    hasAudio: /Stream #\d+:\d+.*:\s*Audio:/.test(joined),
    duration: /Duration:\s*(\d+:\d+:\d+\.\d+)/.exec(joined)?.[1] ?? null,
  };
}

/** 安全地执行一条 ffmpeg 命令：exec 失败时有时是抛异常，有时是返回非 0 */
async function execSafe(
  ffmpeg: any,
  args: string[],
): Promise<{ ok: boolean; code: number; err?: string }> {
  try {
    const code = await ffmpeg.exec(args);
    return { ok: code === 0, code: typeof code === "number" ? code : -1 };
  } catch (err) {
    return { ok: false, code: -1, err: err instanceof Error ? err.message : String(err) };
  }
}

type Plan = { name: string; args: (i: string, o: string) => string[] };

/**
 * 转码方案，按优先级依次尝试。
 *
 * 为什么要多级兜底：wmv / mpg 这类老容器的音频编码（WMA、MP2…）
 * 千奇百怪，直接写死 `-c:a aac` 很容易在写头阶段就失败，
 * 于是整条命令挂掉、连视频轨都拿不到。
 * 先试完整版，再逐步降级，至少保证画面能出来。
 */
function buildPlans(hasAudio: boolean, t: TFn): Plan[] {
  const plans: Plan[] = [];

  if (hasAudio) {
    plans.push({
      name: t("video.planH264"),
      args: (i, o) => [
        "-i", i,
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-y", o,
      ],
    });
  }

  // 音频转不了就丢掉音轨，画面优先
  plans.push({
    name: t("video.planH264Silent"),
    args: (i, o) => [
      "-i", i,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      "-y", o,
    ],
  });

  /**
   * 最后兜底：mpeg4 是 ffmpeg 原生编码器，一定存在。
   * 同时加 -fflags +genpts 重建时间戳 ——
   * wmv / asf 常见时间戳缺失或错乱，不加这个 ffmpeg 可能直接报
   * "Application provided invalid, non monotonic dts"。
   */
  plans.push({
    name: t("video.planMpeg4"),
    args: (i, o) => [
      "-fflags", "+genpts",
      "-i", i,
      "-c:v", "mpeg4", "-q:v", "6", "-pix_fmt", "yuv420p",
      "-an",
      "-y", o,
    ],
  });

  return plans;
}

export function UniversalVideoPlayer({
  src,
  name,
  className,
}: {
  src: string;
  name: string;
  className?: string;
}) {
  const { t } = useI18n();
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const native = ["mp4", "m4v", "webm", "ogv", "ogg"].includes(ext);

  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const objectUrlRef = React.useRef<string | null>(null);

  // 卸载时回收 Blob，避免内存泄漏
  React.useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  async function transcode() {
    setPhase({ kind: "loading", progress: t("video.preparing") });
    const inName = `in.${ext || "dat"}`;
    const outName = "out.mp4";
    let ffmpeg: any = null;

    try {
      ffmpeg = await loadFFmpeg(
        (progress) => setPhase((p) => (p.kind === "idle" ? p : { ...p, progress })),
        t,
      );

      setPhase({ kind: "transcoding", progress: t("video.readingFile") });
      const buf = await fetch(src).then((r) => {
        if (!r.ok) throw new Error(t("video.readFailed", { code: r.status }));
        return r.arrayBuffer();
      });

      if (buf.byteLength > SIZE_WARN_BYTES) {
        throw new Error(
          t("video.tooLarge", { mb: (buf.byteLength / 1024 / 1024).toFixed(0) }),
        );
      }
      if (buf.byteLength === 0) throw new Error(t("video.emptyFile"));

      recentLogs = [];
      await ffmpeg.writeFile(inName, new Uint8Array(buf));

      // 先探测：有没有视频轨/音频轨（决定用哪套参数）
      setPhase({ kind: "transcoding", progress: t("video.analyzing") });
      const probe = await execSafe(ffmpeg, ["-i", inName]);
      const info = parseStreams(recentLogs);

      if (!info.hasVideo) {
        throw new Error(t("video.noVideoTrack"));
      }

      const plans = buildPlans(info.hasAudio, t);
      let lastErr = "";

      for (let n = 0; n < plans.length; n++) {
        const plan = plans[n];
        setPhase({
          kind: "transcoding",
          progress:
            plans.length > 1
              ? t("video.transcodingPlan", { i: n + 1, n: plans.length, name: plan.name })
              : t("video.transcoding"),
        });

        const r = await execSafe(ffmpeg, plan.args(inName, outName));
        if (!r.ok) {
          lastErr = r.err || t("video.exitCode", { code: r.code });
          // 换方案前清掉残留输出，避免读到上一次的半成品
          try { await ffmpeg.deleteFile(outName); } catch { /* 不存在 */ }
          continue;
        }

        const data = await ffmpeg.readFile(outName);
        if (!data || (data as Uint8Array).byteLength === 0) {
          lastErr = t("video.emptyOutput");
          continue;
        }

        /**
         * ⚠️ 必须拷贝一份：readFile 返回的 Uint8Array 是 wasm 内存的视图，
         * 后续任何 ffmpeg 操作都可能改写这块内存，导致 Blob 内容损坏
         * （表现是"转码成功但播放花屏/报错"）。
         */
        const bytes =
          typeof data === "string"
            ? new TextEncoder().encode(data)
            : new Uint8Array(data as Uint8Array);

        const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
        objectUrlRef.current = url;
        setPhase({ kind: "ready", url, via: plan.name });
        return;
      }

      throw new Error(t("video.allPlansFailed", { n: plans.length, err: lastErr }));
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : t("video.transcodeFailed"),
        logs: tailLogs(),
      });
    } finally {
      if (ffmpeg) {
        try { await ffmpeg.deleteFile(inName); } catch { /* 忽略 */ }
        try { await ffmpeg.deleteFile(outName); } catch { /* 忽略 */ }
      }
    }
  }

  /* ---------- 能直接播的格式 ---------- */
  if (native) {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className={className ?? "max-h-[420px] w-full rounded-[var(--radius-card)] bg-black"}
      >
        {t("video.unsupported")}
      </video>
    );
  }

  /* ---------- 需要转码的格式 ---------- */

  if (phase.kind === "ready") {
    return (
      <div className="space-y-2">
        <video
          src={phase.url}
          controls
          autoPlay
          className={className ?? "max-h-[420px] w-full rounded-[var(--radius-card)] bg-black"}
        />
        <p className="text-xs text-fg-tertiary">
          {t("video.transcodedNote")} · {phase.via}
        </p>
      </div>
    );
  }

  if (phase.kind === "loading" || phase.kind === "transcoding") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-muted/40 px-5 py-7">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-sm font-medium">{phase.progress}</p>
        <p className="max-w-[280px] text-center text-xs text-fg-tertiary">
          {t("video.cannotPlayNote", { ext })}
        </p>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="space-y-2 rounded-[var(--radius-card)] border border-destructive/30 bg-destructive/5 px-4 py-3">
        <p className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {phase.message}
        </p>

        {phase.logs.length > 0 && (
          <details className="text-xs text-fg-tertiary">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-fg-secondary">
              {t("video.showLog")}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-relaxed">
              {phase.logs.join("\n")}
            </pre>
          </details>
        )}

        <p className="text-xs text-fg-tertiary">
          {t("video.downloadHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-card)] border border-border bg-muted/40 px-5 py-6">
      <p className="text-sm">
        <span className="font-medium">{name}</span>
      </p>
      <p className="max-w-[300px] text-center text-xs text-fg-tertiary">
        {t("video.needTranscode", { ext })}
      </p>
      <button
        type="button"
        onClick={() => void transcode()}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.98]"
      >
        <Play className="h-3.5 w-3.5" />
        {t("video.decodeAndPlay")}
      </button>
    </div>
  );
}
