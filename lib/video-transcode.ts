/**
 * 视频转码（仅浏览器端）。
 *
 * 为什么需要：浏览器原生只认 mp4 / webm / ogg 三种容器。
 * mkv、avi、wmv、flv、rmvb 这些存上去之后**任何设备都放不了** ——
 * 不是 bug，是浏览器根本没内置对应解码器。
 *
 * 与播放端转码的区别：
 *   播放端（`UniversalVideoPlayer`）是"要用的时候才转"，
 *   每次打开都要等一遍，且转完只存在内存里，换台设备又得重转。
 *   这里做的是**上传前转**，落库的就是 mp4：
 *   转一次永久可播，分享给别人的链接也能直接放。
 *
 * 代价：首次转码要从 CDN 拉约 25~32MB 的 ffmpeg.wasm。
 * 所以只对"确实播不了"的格式转，mp4/webm 一律原样上传。
 */

/** 浏览器原生一定能播的容器 —— 不用转 */
const NATIVE_OK = ["mp4", "m4v", "webm", "ogv", "ogg"];

/** 浏览器一定放不了的容器 —— 必须转 */
const MUST_CONVERT = [
  "mkv", "avi", "wmv", "flv", "rmvb", "rm", "mpg", "mpeg",
  "m2ts", "ts", "asf", "3gp", "vob", "divx",
];

/** 超过这个体积就不转了：ffmpeg.wasm 是单线程 core，大文件必然 OOM/超时 */
export const VIDEO_TRANSCODE_LIMIT = 80 * 1024 * 1024;

type TFn = (key: string, vars?: Record<string, string | number>) => string;

type ProgressFn = (msg: string) => void;

/* ---------------------------------------------------------------------------
   CDN 源（与播放端共用同一份配置）

   unpkg 偶尔会挂，挂掉之后整个转码就废了，所以配了备用源。
   --------------------------------------------------------------------------- */
const CDN_SOURCES = [
  {
    core: "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd",
    js: "https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js",
  },
  {
    core: "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd",
    js: "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js",
  },
];

/** ffmpeg 原始输出，失败时给用户看，否则无法定位 */
let recentLogs: string[] = [];

function pushLog(msg: string): void {
  if (!msg) return;
  recentLogs.push(msg);
  if (recentLogs.length > 500) recentLogs.shift();
}

/** 取最后几行有诊断价值的日志 */
export function tailLogs(n = 6): string[] {
  const useful = recentLogs.filter(
    (l) =>
      l.trim() &&
      !/^\s*(configuration|libavutil|libavcodec|libavformat|built with|Input #|Metadata)/.test(l),
  );
  return (useful.length ? useful : recentLogs).slice(-n);
}

/**
 * ffmpeg 实例的全局缓存。
 *
 * ⚠️ 必须挂在全局：上传转码和播放端转码是两个独立模块，
 * 各自持有模块级 promise 的话会 new 出两个实例、
 * 把 32MB 的 core 下载两遍。
 */
const GLOBAL_KEY = "__portchatFFmpegPromise";

type FFmpegHolder = { promise: Promise<any> } | undefined;

function globalHolder(): FFmpegHolder {
  return (globalThis as unknown as Record<string, FFmpegHolder>)[GLOBAL_KEY];
}

function setGlobalHolder(p: Promise<any> | null): void {
  (globalThis as unknown as Record<string, FFmpegHolder>)[GLOBAL_KEY] = p
    ? { promise: p }
    : undefined;
}

/** 惰性加载 ffmpeg.wasm（全站只加载一次） */
export async function loadFFmpeg(onProgress: ProgressFn, t: TFn): Promise<any> {
  const cached = globalHolder();
  if (cached) return cached.promise;

  const p = (async () => {
    let lastErr: unknown = null;

    for (let i = 0; i < CDN_SOURCES.length; i++) {
      const cdn = CDN_SOURCES[i];
      try {
        onProgress(
          i === 0
            ? t("video.loadingDecoder")
            : t("video.retrySource", { i: i + 1, n: CDN_SOURCES.length }),
        );

        // @ts-expect-error - UMD 包没有类型声明
        if (!window.FFmpegWASM) {
          await new Promise<void>((resolve, reject) => {
            const s = document.createElement("script");
            s.src = cdn.js;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error(t("video.scriptFailed", { url: cdn.js })));
            document.head.appendChild(s);
          });
        }

        // @ts-expect-error - UMD 全局
        const { FFmpeg } = window.FFmpegWASM;
        const ffmpeg = new FFmpeg();
        ffmpeg.on("log", ({ message }: { message: string }) => pushLog(message ?? ""));

        await ffmpeg.load({
          coreURL: `${cdn.core}/ffmpeg-core.js`,
          wasmURL: `${cdn.core}/ffmpeg-core.wasm`,
        });
        return ffmpeg;
      } catch (err) {
        lastErr = err;
        // 换源前清掉上一支遗留的 script，避免命中同一个 UMD 全局
        // @ts-expect-error - UMD 全局
        try { delete window.FFmpegWASM; } catch { /* 忽略 */ }
      }
    }

    throw new Error(
      t("video.loadFailed", {
        n: CDN_SOURCES.length,
        msg: lastErr instanceof Error ? lastErr.message : t("video.unknownError"),
      }),
    );
  })();

  // 加载失败要清掉缓存，否则后续重试永远返回同一个 rejected promise
  p.catch(() => setGlobalHolder(null));
  setGlobalHolder(p);
  return p;
}

/** 从 `-i` 的输出里解析流信息（ffmpeg.wasm 没有 ffprobe，只能读日志） */
function parseStreams(logs: string[]): { hasVideo: boolean; hasAudio: boolean } {
  const joined = logs.join("\n");
  return {
    hasVideo: /Stream #\d+:\d+.*:\s*Video:/.test(joined),
    hasAudio: /Stream #\d+:\d+.*:\s*Audio:/.test(joined),
  };
}

/** exec 失败时有时抛异常、有时返回非 0，统一包一层 */
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

/**
 * 转码方案，按优先级依次尝试。
 *
 * wmv / mpg 这类老容器的音频编码（WMA、MP2…）千奇百怪，
 * 直接写死 `-c:a aac` 很容易在写头阶段就失败，
 * 于是整条命令挂掉、连视频轨都拿不到。
 * 先试完整版，再逐步降级，至少保证画面能出来。
 */
function buildPlans(hasAudio: boolean, t: TFn): { name: string; args: (i: string, o: string) => string[] }[] {
  const plans: { name: string; args: (i: string, o: string) => string[] }[] = [];

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
   * -fflags +genpts 重建时间戳 —— wmv / asf 常见时间戳错乱，
   * 不加这个 ffmpeg 可能直接报 "non monotonic dts"。
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

export function extOf(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

/**
 * 这个文件需不需要转码？
 *
 * 判据按优先级：
 *   1. 扩展名在"一定放不了"名单里 → 转
 *   2. 扩展名在"一定能放"名单里 → 不转（省掉 32MB 下载）
 *   3. 其余（mov 之类、或浏览器给不出 MIME 的）→ 用 canPlayType 实测
 */
export function videoNeedsTranscode(file: File): boolean {
  const ext = extOf(file.name);

  if (MUST_CONVERT.includes(ext)) return true;
  if (NATIVE_OK.includes(ext)) return false;

  // 交给浏览器判断。type 为空时按扩展名猜一个 MIME 再问。
  let probe = file.type;
  if (!probe) {
    const guess: Record<string, string> = {
      mov: "video/quicktime",
      m4v: "video/mp4",
      webm: "video/webm",
      ogv: "video/ogg",
      mkv: "video/x-matroska",
      avi: "video/x-msvideo",
    };
    probe = guess[ext] ?? `video/${ext}`;
  }

  try {
    const v = document.createElement("video");
    const answer = v.canPlayType(probe);
    return !answer || answer === "no";
  } catch {
    // 拿不到结论就按"能播"处理，别为了转码拖慢正常上传
    return false;
  }
}

/**
 * 把视频转成 mp4。
 *
 * 失败一律抛错，由调用方决定是改用原文件还是提示用户 ——
 * 这里不吞异常，否则"转码失败"会伪装成"上传成功"。
 */
export async function transcodeToMp4(
  file: File,
  opts: { onProgress: ProgressFn; t: TFn },
): Promise<File> {
  const { onProgress, t } = opts;
  const ext = extOf(file.name) || "dat";
  const inName = `in.${ext}`;
  const outName = "out.mp4";

  if (file.size > VIDEO_TRANSCODE_LIMIT) {
    throw new Error(t("video.tooLarge", { mb: (file.size / 1024 / 1024).toFixed(0) }));
  }
  if (file.size === 0) throw new Error(t("video.emptyFile"));

  const ffmpeg = await loadFFmpeg(onProgress, t);

  onProgress(t("video.readingFile"));
  const buf = await file.arrayBuffer();

  recentLogs = [];
  await ffmpeg.writeFile(inName, new Uint8Array(buf));

  // 先探测有没有视频轨 / 音频轨（决定用哪套参数）
  onProgress(t("video.analyzing"));
  await execSafe(ffmpeg, ["-i", inName]);
  const info = parseStreams(recentLogs);

  if (!info.hasVideo) {
    throw new Error(t("video.noVideoTrack"));
  }

  const plans = buildPlans(info.hasAudio, t);
  let lastErr = "";

  for (let n = 0; n < plans.length; n++) {
    const plan = plans[n];
    onProgress(
      plans.length > 1
        ? t("video.transcodingPlan", { i: n + 1, n: plans.length, name: plan.name })
        : t("video.transcoding"),
    );

    const r = await execSafe(ffmpeg, plan.args(inName, outName));
    if (!r.ok) {
      lastErr = r.err || t("video.exitCode", { code: r.code });
      // 换方案前清掉残留输出，避免读到上一次的半成品
      try { await ffmpeg.deleteFile(outName); } catch { /* 不存在 */ }
      continue;
    }

    const data = (await ffmpeg.readFile(outName)) as Uint8Array | string;
    if (!data || data.byteLength === 0) {
      lastErr = t("video.emptyOutput");
      continue;
    }

    const blob = new Blob([data as BlobPart], { type: "video/mp4" });
    const base = file.name.replace(/\.[^.]+$/, "") || "video";

    try { await ffmpeg.deleteFile(inName); } catch { /* 忽略 */ }
    try { await ffmpeg.deleteFile(outName); } catch { /* 忽略 */ }

    return new File([blob], `${base}.mp4`, { type: "video/mp4" });
  }

  throw new Error(lastErr || t("video.allPlansFailed"));
}
