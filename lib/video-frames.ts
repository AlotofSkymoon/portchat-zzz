/* ---------------------------------------------------------------------------
   视频抽帧：让"看不见视频"的模型也能看到画面

   聊天接口只认 image_url 这一种媒体内容，视频一律被降级成一段纯文本
   （形如「【视频：xxx.mp4】https://…」）。而那段 URL 上游基本拉不到
   —— 对象存储要么私有、要么跨域不通，模型拿到的等于一个死链。

   所以这里在浏览器本地把视频截成几张图，作为图片附件一起发出去。
   用的是浏览器自带的解码器（video 元素 + canvas），不需要下载
   32MB 的 ffmpeg.wasm，代价极小。

   局限：浏览器解不了的格式（mkv / avi 等）抽不出帧 —— 那种情况下
   只有先经 ffmpeg 转码才拿得到画面，这里会静默返回空数组。
   --------------------------------------------------------------------------- */

/** 抽帧数量的上限，超过这个请求体就太大了 */
const MAX_FRAMES = 4;

/** 帧长边压到这个尺寸：够模型看清，又不至于让请求体爆掉 */
const MAX_EDGE = 640;

/** 等 video 元素进入某个状态，超时返回 false，绝不让界面卡住 */
function waitEvent(
  el: HTMLVideoElement,
  event: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

/**
 * 从视频文件里均匀截几帧，返回 data URL 数组。
 * 任何一步失败都返回空数组——抽帧只是增强，不能因为抽帧失败把发送卡住。
 */
export async function extractVideoFrames(
  file: File,
  count = MAX_FRAMES,
): Promise<string[]> {
  if (typeof document === "undefined") return [];

  const n = Math.max(1, Math.min(count, MAX_FRAMES));
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");

  // 不设这两个，某些浏览器解码器会以"缺音频轨道"为由拒绝出帧
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  const frames: string[] = [];
  try {
    video.src = url;

    const metaOk = await waitEvent(video, "loadedmetadata", 10_000);
    if (!metaOk) return [];

    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0;
    // 拿不到时长就只在开头附近取一帧，总比完全没有强
    if (duration === 0) {
      const one = await grab(video, 0);
      if (one) frames.push(one);
      return frames;
    }

    for (let i = 0; i < n; i++) {
      // 取每段的中间点，避开片头的黑帧
      const at = (duration * (i + 0.5)) / n;
      const shot = await grab(video, at);
      if (shot) frames.push(shot);
    }
    return frames;
  } catch {
    return frames;
  } finally {
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* 忽略 */
    }
    URL.revokeObjectURL(url);
  }
}

/** 跳到指定时间点并抓一帧 */
async function grab(video: HTMLVideoElement, at: number): Promise<string> {
  video.currentTime = at;
  const ok = await waitEvent(video, "seeked", 5_000);
  if (!ok) return "";

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return "";

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  try {
    // jpeg 而非 png：同样画面体积小一半以上
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return "";
  }
}

/** 这个浏览器大概能不能解码该视频（能不能抽帧，只有试了才知道，这里只做粗判） */
export function canDecodeVideo(file: File): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  return !!v.canPlayType && v.canPlayType(file.type || "") !== "";
}
