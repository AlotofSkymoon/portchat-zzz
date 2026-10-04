/**
 * 对象存储：按部署平台锁定唯一方案，避免选错导致上传失败。
 *
 * - Cloudflare Workers → 只能用 Cloudflare R2
 *     零出站流量费、10GB 免费存储、S3 完全兼容、自带 r2.dev 公开域名
 * - Vercel             → 只能用 Backblaze B2
 *     Vercel Serverless 不在 Cloudflare 网络内，R2 的出站优势无从发挥，
 *     且 B2 提供 10GB 免费存储；注意其 S3 兼容层只覆盖部分操作
 *
 * 两个方案都走标准 AWS SigV4 预签名，签名逻辑共用 lib/s3-sign.ts。
 */

export interface S3Preset {
  id: string;
  label: string;
  /** 端点示例（用户需替换尖括号部分） */
  endpointHint: string;
  regionHint: string;
  note: string;
  docs: string;
  recommended?: boolean;
  /** 该预设只在哪个平台出现 */
  platform?: "cloudflare" | "vercel";
  /** S3 兼容性有限，UI 会提示 */
  limited?: boolean;
}

export const S3_PRESETS: S3Preset[] = [
  {
    id: "r2",
    label: "Cloudflare R2",
    endpointHint: "https://<accountid>.r2.cloudflarestorage.com",
    regionHint: "auto",
    note: "零出站流量费，10GB 免费存储，S3 完全兼容",
    docs: "https://dash.cloudflare.com/",
    recommended: true,
    platform: "cloudflare",
  },
  {
    id: "b2",
    label: "Backblaze B2",
    endpointHint: "https://s3.<region>.backblazeb2.com",
    regionHint: "us-west-004",
    note: "10GB 免费存储，出站前 1GB/天免费；S3 兼容层仅覆盖部分操作",
    docs: "https://www.backblaze.com/b2/",
    recommended: true,
    platform: "vercel",
    limited: true,
  },
  {
    id: "supabase",
    label: "Supabase Storage",
    endpointHint: "https://<project-ref>.storage.supabase.co/storage/v1/s3",
    regionHint: "us-east-1",
    note: "1GB 免费存储、自带 CDN；S3 兼容层只接受 path-style（已自动处理）。⚠️ 必须自己在后台给 storage.objects 建 INSERT + SELECT 两条 Policy，否则上传 403",
    docs: "https://supabase.com/docs/guides/storage/s3/authentication",
    recommended: true,
    platform: "cloudflare",
    limited: true,
  },
  {
    id: "minio",
    label: "MinIO 自建",
    endpointHint: "https://minio.example.com:9000",
    regionHint: "us-east-1",
    note: "自建对象存储，完全免费；内网 IP / 本机会自动用 path-style",
    docs: "https://min.io/",
    platform: "vercel",
  },
  {
    id: "aws",
    label: "AWS S3",
    endpointHint: "https://s3.<region>.amazonaws.com",
    regionHint: "us-east-1",
    note: "标准 S3，兼容性最好；用 virtual-host 寻址（自动识别）",
    docs: "https://aws.amazon.com/s3/",
    platform: "vercel",
  },
  {
    id: "qiniu",
    label: "七牛云 Kodo",
    endpointHint: "https://s3.cn-east-1.qiniucs.com",
    regionHint: "cn-east-1",
    note: "每月 10GB 免费存储 + 10GB 出站流量；⚠️ 空间必须设为「公开」，否则上传成功但链接打不开；公开域名留空会自动用空间域名 https://<空间名称>.s3.<地域>.qiniucs.com",
    docs: "https://developer.qiniu.com/kodo/manual/4088/s3-access-domainname",
    recommended: true,
    platform: "vercel",
    limited: true,
  },
  {
    id: "generic",
    label: "通用 S3 兼容",
    endpointHint: "https://s3.example.com",
    regionHint: "auto",
    note: "任何 S3 兼容服务（阿里云 OSS、腾讯 COS 等填对应 endpoint）",
    docs: "",
    platform: "vercel",
  },
];

/**
 * 平台筛选放宽：cloudflare 平台也能用外部 S3。
 *
 * 原来只按平台硬筛，导致 Workers 上想改用别的存储时一个选项都不显示。
 * 现在 Cloudflare 上额外给出「通用 S3 兼容」，其余保持推荐顺序。
 */
export function presetsForPlatform(platform: "cloudflare" | "vercel" | "local"): S3Preset[] {
  if (platform === "local") return S3_PRESETS;
  if (platform === "cloudflare") {
    // R2 排第一（Workers 上零出站费），其余全部可用 —— 不再按平台砍选项
    return [
      ...S3_PRESETS.filter((p) => p.platform === "cloudflare"),
      ...S3_PRESETS.filter((p) => p.platform !== "cloudflare"),
    ];
  }
  return S3_PRESETS.filter((p) => p.platform === "vercel");
}

/** S3 配置（保存在浏览器本地，随上传请求一起发到服务端代理） */
export interface S3Config {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** 自定义公开访问域名，留空则用 r2.dev 或 endpoint 拼 */
  publicBaseUrl?: string;
  /** 存储中的目录前缀 */
  prefix?: string;
  /**
   * 使用站点托管的 R2（管理员已在服务端配好凭证）。
   * 为 true 时 accessKeyId / secretAccessKey 留空，由服务端补全，密钥不下发浏览器。
   */
  useSiteConfig?: boolean;
}

export const DEFAULT_S3_CONFIG: S3Config = {
  enabled: false,
  endpoint: "",
  region: "auto",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  publicBaseUrl: "",
  prefix: "agnes-chat",
};

/** 上传体积上限 */
export const UPLOAD_LIMITS = {
  image: 10 * 1024 * 1024, // 10 MB
  video: 100 * 1024 * 1024, // 100 MB
  other: 20 * 1024 * 1024, // 20 MB
} as const;

/** 允许的文件扩展名（白名单，防止把存储桶当网盘） */
export const ALLOWED_UPLOAD_EXT = [
  // 图片
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico", "heic",
  // 视频
  "mp4", "webm", "mov", "m4v", "avi", "mkv", "ogv",
] as const;
