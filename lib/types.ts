export type AttachmentKind = "text" | "image" | "video" | "file";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: AttachmentKind;
  /** 文本文件：抽取出的正文；图片：data URL */
  content?: string;
  /** 读取失败或被跳过的提示 */
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  /** 出错时的标记，用于渲染重试按钮 */
  error?: string;
  /** 用户随消息一起发送的附件 */
  attachments?: Attachment[];
  /**
   * 思考过程（思考模式下的链式推理内容）。
   * 与 content 分开存：渲染时折叠展示，且不会污染正文。
   */
  reasoning?: string;
  /** 流式过程中是否仍在输出思考内容（用于显示"思考中…"） */
  reasoningDone?: boolean;
  /** 联网搜索命中的来源，用于在回答下方列出引用 */
  sources?: { title: string; url: string }[];
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ----------------------------- 附件工具 ----------------------------- */

/**
 * 浏览器「本地读取」的大小上限。
 *
 * ⚠️ 这只限制「是否把文件内容读进浏览器内存」，
 *    不限制上传到对象存储的文件大小 —— 图片/视频走 R2 预签名直传时，
 *    文件根本不经过浏览器转 base64，多大的文件都能传（R2 单次 PUT 上限 5 GB）。
 *
 * 未配置对象存储时才会走本地读取，此时才受这里的限制。
 * 按类型区分：文本文件本来就该进上下文，给足额度；
 * 图片走 base64 会膨胀约 33%，保守一些。
 */
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB（普通文件）
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB（图片本地读取）
export const MAX_TEXT_SIZE = 5 * 1024 * 1024; // 5 MB（文本抽正文，再大就截断）
export const MAX_FILES = 5;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "json", "jsonl", "csv", "tsv", "log", "xml", "yaml", "yml",
  "toml", "ini", "conf", "env", "sh", "bash", "zsh", "sql", "html", "htm", "css", "scss",
  "less", "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "swift", "c", "h", "cpp", "hpp", "cs", "php", "pl", "lua", "r", "scala", "vue", "svelte",
  "dart", "gradle", "dockerfile", "makefile", "gitignore", "lock", "properties", "bat", "ps1",
]);

const TEXT_MIME = new Set([
  "text/plain", "text/markdown", "application/json", "text/csv", "application/xml",
  "text/xml", "application/x-yaml", "text/yaml", "application/javascript",
  "application/typescript", "text/x-python", "text/x-go", "text/x-c", "text/x-java",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function isTextFile(file: File): boolean {
  if (file.type && TEXT_MIME.has(file.type)) return true;
  if (file.type === "") return TEXT_EXT.has(extOf(file.name));
  return TEXT_EXT.has(extOf(file.name));
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * 视频判断。
 *
 * ⚠️ 这里刻意列得很全，因为只要漏判一个扩展名，
 * 文件就会被当成"未知二进制"处理 —— 不上对象存储、AI 也看不到。
 * 用户明确要求支持 mp4 / wmv / mpg1 / mpg2，所以老格式一并收进来。
 */
const VIDEO_EXT = new Set([
  // 现代容器
  "mp4", "webm", "mov", "m4v", "mkv", "ogv", "ogg", "3gp", "3g2",
  // 微软系
  "wmv", "asf", "avi",
  // MPEG 系（含用户要求的 mpg1 / mpg2）
  "mpg", "mpeg", "mpg1", "mpg2", "mpeg1", "mpeg2", "mpe", "m1v", "m2v",
  "ts", "mts", "m2ts", "vob", "dat",
  // 其他
  "flv", "f4v", "rm", "rmvb", "divx", "xvid",
]);

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return VIDEO_EXT.has(extOf(file.name));
}

/**
 * 浏览器**能直接播放**的格式（无需解码器）。
 * 除此之外的一律要先转码 —— 见 UniversalVideoPlayer。
 */
export function isNativelyPlayable(file: File | string): boolean {
  const ext = typeof file === "string" ? extOf(file) : extOf(file.name);
  return ["mp4", "m4v", "webm", "ogv", "ogg"].includes(ext);
}

/** 人类可读的体积 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 读取文件 → Attachment（文本抽正文，图片转 data URL，其余只留元信息） */
export async function readFileToAttachment(file: File): Promise<Attachment> {
  const base: Attachment = {
    id: createId(),
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    kind: "file",
  };

  // 超过本地读取上限：不读内容，但文件仍在附件列表里。
  // 真正能传大文件的路径是「配置对象存储 → 预签名直传」，
  // 所以这里把用户往那个方向引导，而不是简单说"太大了"。
  if (file.size > MAX_FILE_SIZE) {
    return {
      ...base,
      note: `${file.name} 超过 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB，未读取内容。如需上传大文件，请在设置里配置对象存储（Cloudflare R2）`,
    };
  }

  try {
    if (isImageFile(file)) {
      // 图片 base64 会膨胀 33%，直接塞进请求很容易触发「单条消息过大」。
      // 这里先自动压缩（降采样 + JPEG），模型识图不需要原图分辨率。
      // 动态 import：压缩依赖 canvas / Image，只应在浏览器加载
      const { compressImageToDataUrl } = await import("@/lib/image-compress");
      const { dataUrl, compressed } = await compressImageToDataUrl(file);
      return {
        ...base,
        kind: "image",
        content: dataUrl,
        note: compressed ? `已压缩至 ${formatBytes(dataUrl.length)} 以便发送` : undefined,
      };
    }

    // 全类型支持：文本直接读取；未知扩展名也尝试按文本读，
    // 读出来若是乱码（含大量不可见控制字符）才退回"仅元信息"。
    // 这样 .env、.gitignore、无扩展名脚本、各类配置都能正常送进上下文。
    if (file.size <= MAX_TEXT_SIZE) {
      const shouldTryText = isTextFile(file) || !isImageFile(file);
      if (shouldTryText) {
        const text = await file.text();
        const clipped = text.length > 100_000 ? text.slice(0, 100_000) : text;
        // 二进制检测：控制字符（除常见空白）占比过高就当二进制
        const ctrl = (clipped.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) ?? []).length;
        if (ctrl / Math.max(1, clipped.length) < 0.05) {
          return {
            ...base,
            kind: "text",
            content: clipped,
            note: text.length > 100_000 ? "内容过长，只取前 100000 字符" : undefined,
          };
        }
      }
    }

    if (isVideoFile(file)) {
      return { ...base, kind: "video", note: "未配置对象存储，视频未上传" };
    }

    return { ...base, kind: "file", note: "暂不支持解析该类型，仅记录文件名" };
  } catch {
    return { ...base, note: "读取失败" };
  }
}

/** 站点级配置（仅管理员可改，全站生效） */
export interface SiteSettings {
  /** 全站默认 Base URL，留空则用内置地址 */
  defaultBaseUrl: string;
  /** 全站默认模型，留空则用内置默认 */
  defaultModel: string;
  /** 是否默认开启「保存聊天记录到云端」 */
  cloudSaveDefault: boolean;

  /* ---- 页脚 / 备案（管理员面板里填，不用改环境变量）---- */

  /** 备案号文字，如「京ICP备12345678号-1」或第三方备案号。留空不显示 */
  icpText: string;
  /** 备案链接。留空时自动指向工信部备案查询系统 */
  icpUrl: string;
  /**
   * 备案徽章图片地址（第三方备案如 icp.gov.moe / icp.sakura.ink 会给）。
   * 图片加载失败时会自动隐藏，不留破图。
   */
  icpIconUrl: string;
  /** 页脚额外自定义文字（版权、联系方式、免责说明等） */
  footerExtra: string;
  /** 联系方式类型：留空则不显示。telegram = 频道/群链接，qq = QQ 号或群链接 */
  contactType: "" | "telegram" | "qq";
  /** 联系方式值：Telegram 填频道或群链接，QQ 填号码或群链接 */
  contactValue: string;

  /* ---- GitHub OAuth（管理员面板里填，免去改环境变量）---- */

  /**
   * GitHub OAuth App 的 Client ID。
   * 环境变量 GITHUB_CLIENT_ID 优先于此处；两者都为空则不显示 GitHub 登录按钮。
   */
  githubClientId: string;
  /** GitHub OAuth App 的 Client Secret。仅管理员可读写 */
  githubClientSecret: string;

  /* ---- 站点预设 API Key（管理员面板里填，免去改环境变量）---- */

  /**
   * 全站共用的 API Key，键是服务商 id（agnes / deepseek / inkstone / atriasi）。
   *
   * 配了之后，所有访客都能看到并使用该服务商的模型 ——
   * 不需要每个人自己去填 Key。仅管理员可读写，公开接口不下发值。
   */
  presetKeys: Record<string, string>;

  /* ---- 站点级模型清单（管理员追加，全站可见）---- */

  /**
   * 管理员给内置服务商追加的模型 id，键是服务商 id。
   *
   * 为什么需要：以前管理员在自己设置里追加的模型只写进 localStorage，
   * 只有他自己这台浏览器看得到，其他用户一个都看不到。
   * 存到这里之后，所有访客的模型菜单里都会出现这些模型。
   *
   * ⚠️ 要真正能用，该服务商还得有「站点预设 Key」，否则用户没 Key 调不通。
   */
  providerModels: Record<string, string[]>;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  defaultBaseUrl: "",
  defaultModel: "",
  cloudSaveDefault: false,
  icpText: "",
  icpUrl: "",
  icpIconUrl: "",
  footerExtra: "",
  contactType: "",
  contactValue: "",
  githubClientId: "",
  githubClientSecret: "",
  presetKeys: {},
  providerModels: {},
};
