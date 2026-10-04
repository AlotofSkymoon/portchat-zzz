/**
 * 七牛云 Kodo 的 S3 兼容地域。
 *
 * 单独成文件的原因：地域列表较长且会随七牛扩容变动，
 * 塞进 s3-presets.ts 会让主文件变得难读。
 *
 * 官方文档（developer.qiniu.com/kodo/manual/4088）：
 *   endpoint 统一为 https://s3.<region>.qiniucs.com
 *   同时支持 path-style 与 bucket virtual hosting 两种寻址
 */

export interface QiniuRegion {
  id: string;
  label: string;
}

export const QINIU_REGIONS: QiniuRegion[] = [
  { id: "cn-east-1", label: "华东-浙江" },
  { id: "cn-east-2", label: "华东-浙江2" },
  { id: "cn-north-1", label: "华北-河北" },
  { id: "cn-south-1", label: "华南-广东" },
  { id: "us-north-1", label: "北美-洛杉矶" },
  { id: "ap-southeast-1", label: "亚太-新加坡" },
  { id: "ap-southeast-2", label: "亚太-河内" },
  { id: "ap-southeast-3", label: "亚太-胡志明" },
];

export function qiniuEndpoint(region: string): string {
  return `https://s3.${region}.qiniucs.com`;
}

/**
 * 七牛云的已知限制（UI 会提示，避免用户配完才发现不能用）：
 *   - 不支持匿名访问，所有请求必须带 AWS SigV4 签名
 *   - 部分 S3 操作（如分片上传的某些接口）未实现
 *   - 空间必须设为「公开」，否则生成的图片链接打不开
 */
export const QINIU_NOTE =
  "endpoint 为 https://s3.<地域>.qiniucs.com；不支持匿名访问；空间需设为公开，否则图片链接打不开";
