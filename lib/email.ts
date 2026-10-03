import { SITE_NAME } from "@/lib/site";

/**
 * Resend 发信。
 *
 * ⚠️ 为什么直接调 HTTP API 而不装 `resend` 包：
 * 只需要发一种邮件，SDK 会连带引入依赖树，而项目刚因为 peer 依赖冲突
 * 折腾过一轮（wrangler / workers-types）。一个 fetch 就够的事不值得增加依赖。
 *
 * ⚠️ fail-open 的设计取舍：
 * 没配 RESEND_API_KEY 时 `isEmailConfigured()` 返回 false，
 * 注册流程会**跳过验证**而不是报错 ——
 * 否则站长没配邮件服务时，所有新用户都注册不了，站点等于废掉一半。
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(
    (process.env.RESEND_API_KEY ?? "").trim() &&
      (process.env.RESEND_FROM ?? "").trim(),
  );
}

/** 缺哪个变量 —— 管理面板要能直接说出原因，而不是只给一句「未启用」 */
export function missingMailEnv(): string[] {
  const missing: string[] = [];
  if (!(process.env.RESEND_API_KEY ?? "").trim()) missing.push("RESEND_API_KEY");
  if (!(process.env.RESEND_FROM ?? "").trim()) missing.push("RESEND_FROM");
  return missing;
}

/** 管理面板用的配置快照（不暴露密钥全文） */
export function mailConfigStatus() {
  const key = (process.env.RESEND_API_KEY ?? "").trim();
  const from = (process.env.RESEND_FROM ?? "").trim();
  return {
    enabled: Boolean(key && from),
    from,
    missing: missingMailEnv(),
    /** 只给前后缀，够确认「是不是那把 key」，又不会整把泄露出去 */
    keyPreview: key ? `${key.slice(0, 3)}…${key.slice(-4)}` : "",
  };
}

/**
 * 把 Resend 的 HTTP 状态码翻译成人能看懂的原因。
 *
 * ⚠️ 为什么值得单独写：最常见的失败是 403「发件域名未验证」，
 * 而它表现出来的样子是「注册直接成功、根本没收到邮件」——
 * 不给出这条提示，站长只会以为功能没做。
 */
export function resendHint(status: number, detail: string): string {
  if (status === 401) return "API Key 无效或被撤销，去 Resend 后台重新生成一把";
  if (status === 403 || status === 422) {
    return /domain|from|verify/i.test(detail)
      ? "发件域名未验证：未验证时只能发给你自己的注册邮箱，其他人一律收不到"
      : "被 Resend 拒绝，多半是发件域名未验证或没权限";
  }
  if (status === 429) return "超出 Resend 免费额度或触发频率限制";
  if (status >= 500) return "Resend 服务端故障，稍后重试";
  return "请求被拒绝，去 Resend 后台看 Logs 里的投递状态";
}

export function mailFrom(): string {
  const from = (process.env.RESEND_FROM ?? "").trim();
  if (!from) return "";
  // Resend 接受 "Name <a@b.com>" 或纯地址，两种都原样用
  return from;
}

/**
 * 发送验证码邮件。
 *
 * @returns true 发送成功；false 失败（调用方应据此决定是否报错）
 */
export async function sendVerificationCode(
  to: string,
  code: string,
): Promise<{ ok: boolean; error?: string; status?: number; detail?: string; hint?: string }> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const from = mailFrom();
  if (!apiKey || !from) {
    return { ok: false, error: "未配置 Resend" };
  }

  const subject = `${SITE_NAME} · 邮箱验证码`;
  const text = [
    `你的 ${SITE_NAME} 验证码是：${code}`,
    "",
    "30 分钟内有效。如果不是你本人操作，忽略这封邮件即可。",
  ].join("\n");

  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1a1a1a;">
    <h2 style="margin:0 0 20px;font-size:18px;font-weight:600;">验证你的邮箱</h2>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#444;">
      你正在注册 ${escapeHtml(SITE_NAME)}，请输入下面的验证码完成验证：
    </p>
    <div style="margin:0 0 20px;padding:16px;text-align:center;background:#f5f6fb;border-radius:12px;">
      <span style="font-size:32px;font-weight:700;letter-spacing:8px;font-family:'SF Mono',Menlo,Consolas,monospace;color:#2b2b2b;">${escapeHtml(code)}</span>
    </div>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#666;">
      验证码 30 分钟内有效。如果不是你本人操作，忽略这封邮件即可，账号不会创建成功。
    </p>
  </div>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });

    if (!res.ok) {
      /*
       * 只取 Resend 给的 message 字段，不要把整段响应体回给前端（可能含内部信息）。
       * 这个 detail 只会出现在管理员的「测试发送」结果里，普通注册流程拿不到。
       */
      const bodyText = await res.text().catch(() => "");
      let detail = "";
      try {
        const parsed = JSON.parse(bodyText) as { message?: string; name?: string };
        detail = parsed.message ?? parsed.name ?? "";
      } catch {
        detail = bodyText.slice(0, 200);
      }
      console.error("[email] Resend 返回错误状态", res.status, detail.slice(0, 200));
      return {
        ok: false,
        error: "邮件发送失败",
        status: res.status,
        detail: detail.slice(0, 300),
        hint: resendHint(res.status, detail),
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("[email] 请求 Resend 异常", error instanceof Error ? error.message : error);
    return { ok: false, error: "邮件发送失败" };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
