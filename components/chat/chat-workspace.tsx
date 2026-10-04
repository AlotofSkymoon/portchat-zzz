"use client";

import * as React from "react";
import Link from "next/link";
import {
  Monitor,
  Eraser,
  Menu,
  PanelLeftOpen,
  Plus,
  Settings2,
  Swords,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/components/i18n-provider";
import { ChatFooter } from "@/components/chat/chat-footer";
import { ChatInput } from "@/components/chat/chat-input";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { SettingsDialog, type ChatSettings } from "@/components/chat/settings-dialog";
import { probeImageUrl } from "@/lib/image-probe";
import { transcodeToMp4, videoNeedsTranscode } from "@/lib/video-transcode";
import { ALLOW_WEB_SEARCH, REQUIRE_LOGIN } from "@/lib/site";
import { Sidebar } from "@/components/chat/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  CHAT_MODELS,
  DEFAULT_MODEL,
  LS_KEYS,
  supportsThinking,
  supportsVision,
  type CustomProviderConfig,
} from "@/lib/config";
import { IMAGE_TARGET_BASE64, compressImageToDataUrl } from "@/lib/image-compress";
import { DEFAULT_S3_CONFIG, type S3Config } from "@/lib/s3-presets";
import {
  createId,
  formatBytes,
  isImageFile,
  isTextFile,
  isVideoFile,
  MAX_FILES,
  MAX_TEXT_SIZE,
  readFileToAttachment,
  type Attachment,
  type AttachmentKind,
  type ChatMessage,
} from "@/lib/types";
import { useConversations } from "@/lib/use-conversations";

interface SafeUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
}

/** 该模型是否支持识图（内置 + 自定义供应商都要考虑） */
function visionEnabled(modelId: string, custom: CustomProviderConfig[]): boolean {
  if (CHAT_MODELS.some((m) => m.id === modelId)) return supportsVision(modelId);
  return custom.some((c) => c.models.includes(modelId) && c.vision === true);
}

const DEFAULT_SETTINGS: ChatSettings = {
  keys: { agnes: "" },
  baseUrls: {},
  customProviders: [],
  model: DEFAULT_MODEL,
};

export function ChatWorkspace({ user }: { user: SafeUser | null }) {
  const { t } = useI18n();
  const {
    conversations,
    currentId,
    messages,
    setMessages,
    loaded,
    newConversation,
    selectConversation,
    deleteConversation,
    renameConversation,
    autoTitleConversation,
    clearAllConversations,
    ensureConversation,
    mergeFromCloud,
  } = useConversations();

  const [mounted, setMounted] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "streaming">("idle");
  /** 图片生成进行中（与对话流式互不干扰） */
  const [imageBusy, setImageBusy] = React.useState(false);
  const [streamingId, setStreamingId] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<ChatSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [cloudSync, setCloudSync] = React.useState(false);
  /* ---- 附件 + 拖拽 ---- */
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [dragging, setDragging] = React.useState(false);
  /* 桌面端侧边栏收起状态（记忆到 localStorage） */
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const dragDepth = React.useRef(0);

  const abortRef = React.useRef<AbortController | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const messagesRef = React.useRef<ChatMessage[]>([]);

  React.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /* ------------------------------ 初始化设置 ------------------------------ */
  React.useEffect(() => {
    try {
      // 新版：各服务商分开存；兼容旧版单一 apiKey
      let keys: Record<string, string> = { agnes: "" };
      const rawKeys = localStorage.getItem(LS_KEYS.keys);
      if (rawKeys) {
        try {
          const parsed = JSON.parse(rawKeys) as Record<string, string>;
          /**
           * ⚠️ 这里必须保留所有 key，不能只挑 agnes / deepseek。
           * 之前写死挑这两个字段，导致自定义供应商（custom:xxx）的 Key
           * 存进去了却读不回来 —— 刷新页面就"凭空消失"。
           */
          keys = { agnes: "", ...parsed };
        } catch {
          /* 忽略 */
        }
      }
      // 迁移：旧版本存的单一 apiKey 当作 Agnes Key
      const legacy = localStorage.getItem(LS_KEYS.apiKey) ?? "";
      if (!keys.agnes && legacy) {
        keys.agnes = legacy;
        localStorage.setItem(LS_KEYS.keys, JSON.stringify(keys));
      }

      // 对象存储配置
      let s3: S3Config = { ...DEFAULT_S3_CONFIG };
      const rawS3 = localStorage.getItem(LS_KEYS.s3);
      if (rawS3) {
        try {
          s3 = { ...DEFAULT_S3_CONFIG, ...(JSON.parse(rawS3) as Partial<S3Config>) };
        } catch {
          /* 忽略 */
        }
      }

      // Base URL：新版按服务商分开存；老版本是单个字符串，迁移到 agnes 名下
      let baseUrls: Record<string, string> = {};
      const rawBaseUrls = localStorage.getItem(LS_KEYS.baseUrls);
      if (rawBaseUrls) {
        try {
          baseUrls = JSON.parse(rawBaseUrls) as Record<string, string>;
        } catch {
          baseUrls = {};
        }
      }
      const legacyBaseUrl = localStorage.getItem(LS_KEYS.baseUrl) ?? "";
      if (legacyBaseUrl && !baseUrls.agnes) baseUrls.agnes = legacyBaseUrl;

      let customProviders: CustomProviderConfig[] = [];
      const rawCustom = localStorage.getItem(LS_KEYS.customProviders);
      if (rawCustom) {
        try {
          customProviders = JSON.parse(rawCustom) as CustomProviderConfig[];
        } catch {
          customProviders = [];
        }
      }

      const saved: ChatSettings = {
        keys: keys as ChatSettings["keys"],
        baseUrls,
        customProviders,
        model: localStorage.getItem(LS_KEYS.model) ?? DEFAULT_MODEL,
        s3,
        thinking: localStorage.getItem(LS_KEYS.thinking) === "true",
      };
      setSettings(saved);
      setWebSearch(localStorage.getItem(LS_KEYS.webSearch) === "true");
    const rawEffort = localStorage.getItem(LS_KEYS.effort);
    setEffort(
      rawEffort === "low" || rawEffort === "high" ? rawEffort : "medium",
    );
      setCloudSync(localStorage.getItem(LS_KEYS.cloudSync) === "true");
      setSidebarCollapsed(localStorage.getItem(LS_KEYS.sidebarCollapsed) === "1");
    } catch {
      /* 忽略 */
    }
    setMounted(true);

    /**
     * 云端保存的初始值 = 用户自己的选择 > 管理员设的站点默认值。
     *
     * ⚠️ 这里之前只读 localStorage，压根没去取管理员的 cloudSaveDefault，
     * 所以管理员在面板里开了「默认开启」，用户刷新后还是关的。
     *
     * 判断依据用 localStorage 里**有没有这个键**，而不是值本身：
     * 用户手动关掉后存的是 "false"，若按值判断就会被默认值覆盖回去。
     */
    fetch("/api/site-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: { cloudSaveDefault?: boolean } } | null) => {
        const siteDefault = Boolean(d?.settings?.cloudSaveDefault);
        if (!siteDefault) return; // 默认关闭时无需处理
        try {
          if (localStorage.getItem(LS_KEYS.cloudSyncSetByUser) === "1") return;
          if (localStorage.getItem(LS_KEYS.cloudSync) !== null) return;
          setCloudSync(true);
        } catch {
          /* 忽略 */
        }
      })
      .catch(() => {
        /* 拿不到站点设置就维持本地值 */
      });
  }, []);

  // 探测对象存储：站点托管 或 用户自己配置了 都算就绪
  React.useEffect(() => {
    let alive = true;
    fetch("/api/upload/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { siteManaged?: boolean; r2Bound?: boolean } | null) => {
        if (!alive) return;
        storageBoundRef.current = Boolean(d?.r2Bound);
        setStorageReady(Boolean(d?.siteManaged) || Boolean(settings.s3?.enabled));
      })
      .catch(() => {
        /* 探测失败就按本地配置判断 */
        if (alive) setStorageReady(Boolean(settings.s3?.enabled));
      });
    return () => {
      alive = false;
    };
  }, [settings.s3?.enabled]);

  /**
   * 用户手动切换云端保存。
   * 除了存值，还要打上「用户已设置」标记 ——
   * 之后管理员的默认值就不能再覆盖这个选择了。
   */
  const handleCloudSyncChange = React.useCallback((next: boolean) => {
    setCloudSync(next);
    try {
      localStorage.setItem(LS_KEYS.cloudSyncSetByUser, "1");
    } catch {
      /* 忽略 */
    }
  }, []);

  React.useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(LS_KEYS.cloudSync, String(cloudSync));
    } catch {
      /* 忽略 */
    }
  }, [cloudSync, mounted]);

  /**
   * 登录后把云端会话拉回来。
   *
   * ⚠️ 这是「同一个站、换个浏览器历史记录就不见了」的根因修复：
   * 之前只有发送时写云端（saveToCloud），从没有人去读，
   * 于是换设备登录后本地 localStorage 是空的，看起来像数据丢了。
   *
   * 只在「已登录 + 云端保存开启」时拉，避免给免登录访客发无用请求。
   * 同一个用户+开关组合只拉一次（cloudSync 由关变开时会再拉一次）。
   */
  const pulledKeyRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!mounted || !user || !cloudSync) return;
    const key = `${user.id}:${cloudSync}`;
    if (pulledKeyRef.current === key) return;
    pulledKeyRef.current = key;

    let alive = true;
    fetch("/api/conversations?full=1")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: { conversations?: { conversationId: string; updatedAt: number; title?: string; messages?: unknown }[] } | null) => {
          if (!alive || !d?.conversations) return;
          const n = mergeFromCloud(d.conversations);
          if (n > 0) {
            toast.success(`${t("chat.restored")} ${n} ${t("chat.convsUnit")}`);
          }
        },
      )
      .catch(() => {
        /* 拉取失败不影响本地使用，静默 */
      });
    return () => {
      alive = false;
    };
  }, [mounted, user, cloudSync, mergeFromCloud]);

  /**
   * 登录后把云端设置拉回来（API Key / Base URL / 自定义供应商 / 模型 / 对象存储）。
   *
   * 解决的问题：在 A 站填的 Key，换到 B 站要重填一遍。
   * 这些配置以前只存在浏览器 localStorage，换设备就丢。
   *
   * 只在「已登录 + 云端保存开启」时拉，且同一组合只拉一次。
   * 拉取后直接采用云端值 —— 用户要的就是"配置跟着账号走"。
   */
  const settingsPulledRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!mounted || !user || !cloudSync) return;
    const key = `${user.id}:${cloudSync}`;
    if (settingsPulledRef.current === key) return;

    let alive = true;
    fetch("/api/user/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: Record<string, unknown> | null } | null) => {
        if (!alive) return;
        settingsPulledRef.current = key;
        if (!d?.settings) return;

        setSettings((prev) => {
          /**
           * 只合并云端确实带了的字段。
           * 云端没存 thinking / webSearch，保持本设备的值，
           * 否则多设备之间会互相打架。
           */
          const next: ChatSettings = { ...prev };
          if (d.settings!.keys && typeof d.settings!.keys === "object") {
            next.keys = { ...prev.keys, ...(d.settings!.keys as Record<string, string>) };
          }
          if (d.settings!.baseUrls && typeof d.settings!.baseUrls === "object") {
            next.baseUrls = {
              ...prev.baseUrls,
              ...(d.settings!.baseUrls as Record<string, string>),
            };
          }
          if (Array.isArray(d.settings!.customProviders)) {
            next.customProviders = d.settings!.customProviders as typeof prev.customProviders;
          }
          if (typeof d.settings!.model === "string" && d.settings!.model) {
            next.model = d.settings!.model;
          }
          if (d.settings!.s3 && typeof d.settings!.s3 === "object") {
            next.s3 = d.settings!.s3 as typeof prev.s3;
          }
          return next;
        });
      })
      .catch(() => {
        /* 拉取失败就用本地的，不影响使用 */
      });
    return () => {
      alive = false;
    };
  }, [mounted, user, cloudSync]);

  /**
   * 设置变更后写回云端（防抖 1.2 秒）。
   *
   * 为什么防抖：用户在设置框里每敲一个键都会触发 setSettings，
   * 不做防抖会把一串请求打到服务端。
   *
   * 拉取完成前不上传 —— 否则会用本地的旧值把云端刚拉下来的覆盖掉。
   */
  React.useEffect(() => {
    if (!mounted || !user || !cloudSync) return;
    if (settingsPulledRef.current === "") return;

    const timer = setTimeout(() => {
      fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: settings.keys,
          baseUrls: settings.baseUrls,
          customProviders: settings.customProviders,
          model: settings.model,
          s3: settings.s3 ?? null,
        }),
      }).catch(() => {
        /* 上传失败不影响本地使用 */
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [
    mounted,
    user,
    cloudSync,
    settings.keys,
    settings.baseUrls,
    settings.customProviders,
    settings.model,
    settings.s3,
  ]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  /* ------------------------------ 流式请求 ------------------------------ */
  const runCompletion = React.useCallback(
    async (history: ChatMessage[], conversationId: string) => {
      const assistantId = createId();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
      ]);
      messagesRef.current = [
        ...messagesRef.current,
        { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
      ];
      setStreamingId(assistantId);
      setStatus("streaming");

      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (patch: Partial<ChatMessage>) =>
        setMessages((prev) => {
          const next = prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m));
          messagesRef.current = next;
          return next;
        });

      // 构造发送用的消息数组：只有最后一条用户消息带多模态附件，
      // 历史消息用文字摘要，省 token 也省体积。
      const visionOkNow = visionEnabled(settings.model, settings.customProviders);
      const outboundMessages = history
        .filter((m) => !m.error)
        .map((m, idx, arr) => {
          const atts = m.attachments ?? [];
          const isLastUser = m.role === "user" && idx === arr.length - 1 && atts.length > 0;

          if (!isLastUser) {
            const past =
              atts.length > 0
                ? `${m.content}\n${t("chat.prevAttachments", {
                  names: atts.map((a) => a.name).join("、"),
                })}`
                : m.content;
            return { role: m.role, content: past };
          }

          const textAtts = atts.filter((a) => a.kind === "text" && a.content);
          const imgAtts = visionOkNow
            ? atts.filter((a) => a.kind === "image" && a.content)
            : [];
          const otherAtts = atts.filter(
            (a) => !textAtts.includes(a) && !imgAtts.includes(a),
          );

          const textBlocks = [
            m.content,
            ...textAtts.map(
                (a) => `\n---\n${t("chat.attachmentNamed", { name: a.name })}\n${a.content}`,
              ),
            ...otherAtts.map((a) =>
              a.content && /^https?:\/\//.test(a.content)
                ? `\n【${a.kind === "video" ? t("chat.video") : t("chat.attachment")}：${a.name}】${a.content}`
                : `\n${t("chat.attachmentNamed", { name: a.name })}${
                    a.note ?? t("chat.contentUnavailable")
                  }`,
            ),
            ...(atts.length > 0 && !visionOkNow && atts.some((a) => a.kind === "image")
              ? [`\n${t("chat.noVision")}`]
              : []),
          ]
            .filter(Boolean)
            .join("\n");

          if (imgAtts.length === 0) return { role: m.role, content: textBlocks };

          return {
            role: m.role,
            content: [
              { type: "text" as const, text: textBlocks },
              ...imgAtts.map((a) => ({
                type: "image_url" as const,
                image_url: { url: a.content!, detail: "auto" as const },
              })),
            ],
          };
        });

      /**
       * 联网搜索：开启时先搜一次，把结果作为上下文拼进最后一条用户消息。
       *
       * 搜不到不阻断 —— 提示一句后照常让模型用自己的知识回答，
       * 免得整句话卡在搜索上。
       */
      let searchNote = "";
      let searchSources: { title: string; url: string }[] = [];
      if (webSearchRef.current) {
        try {
          const lastUser = [...outboundMessages]
            .reverse()
            .find((m) => m.role === "user");
          const queryText =
            typeof lastUser?.content === "string"
              ? lastUser.content
              : Array.isArray(lastUser?.content)
                ? lastUser.content
                    .map((c) => (c as { text?: string }).text ?? "")
                    .join(" ")
                : "";
          const q = queryText.trim().slice(0, 200);

          if (q) {
            // 带上最近几条对话（只取文字，图片 base64 太大不能发）
            // 服务端据此理解指代，例如「它多少钱」里的「它」指什么
            const ctx = outboundMessages.slice(-4).map((m) => ({
              role: m.role,
              content:
                typeof m.content === "string"
                  ? m.content.slice(0, 300)
                  : Array.isArray(m.content)
                    ? m.content
                        .filter((c) => (c as { type?: string }).type === "text")
                        .map((c) => (c as { text?: string }).text ?? "")
                        .join(" ")
                        .slice(0, 300)
                    : "",
            }));

            const sr = await fetch("/api/web-search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: q, limit: 30, messages: ctx }),
              signal: abortRef.current?.signal,
            });
            const sd = (await sr.json()) as {
              ok?: boolean;
              skipped?: boolean;
              context?: string;
              error?: string;
              results?: { title: string; url: string }[];
            };
            if (sd.ok && sd.context) {
              // sd.skipped 表示决策器判断这条不用搜（问候、改写上文…），
              // 此时 context 与 error 都为空，两个分支都不成立，自然跳过。
              // 刻意不弹提示：否则每次对话都跳一个 toast 反而吵。
              searchNote = sd.context;
              searchSources = sd.results ?? [];
              // 来源先挂上，这样即使后面流式失败也能看到引用
              if (searchSources.length) patchAssistant({ sources: searchSources });
            } else if (sd.error) {
              toast.info(t("chat.webSearchFailed", { err: sd.error }));
            }
          }
        } catch (err) {
          if ((err as Error)?.name !== "AbortError") {
            toast.info(t("chat.webFailed"));
          }
        }
      }

      /** 把搜索上下文附到最后一条用户消息上 */
      const finalMessages = searchNote
        ? outboundMessages.map((m, idx) => {
            const isLastUser =
              m.role === "user" &&
              idx ===
                outboundMessages.reduce(
                  (acc, mm, i) => (mm.role === "user" ? i : acc),
                  -1,
                );
            if (!isLastUser) return m;

            if (typeof m.content === "string") {
              return { ...m, content: `${m.content}\n\n${searchNote}` };
            }
            if (Array.isArray(m.content)) {
              return {
                ...m,
                content: [
                  ...m.content,
                  { type: "text" as const, text: searchNote },
                ],
              };
            }
            return m;
          })
        : outboundMessages;

      // ---- 发送前体积预检 ----
      // Vercel Serverless 请求体硬上限 4.5MB，超出会在平台层直接被拒，
      // 连我们的接口都到不了。这里提前拦下并给出可操作的提示，
      // 比发出去收到一句「单条消息过大」有用得多。
      const bodyObj = {
        messages: finalMessages,
        model: settings.model,
        keys: settings.keys,
        baseUrls: settings.baseUrls,
        customProviders: settings.customProviders,
        conversationId,
        saveToCloud: Boolean(user) && cloudSync,
        // 带上标题，否则云端拉回来时全是「新对话」
        conversationTitle:
          conversations.find((c) => c.id === conversationId)?.title ?? "",
        thinking: thinkingRef.current,
        effort,
      };
      const bodyBytes = new TextEncoder().encode(JSON.stringify(bodyObj)).length;
      const PLATFORM_BODY_LIMIT =
        platformRef.current === "vercel" ? 4 * 1024 * 1024 : 20 * 1024 * 1024;

      if (bodyBytes > PLATFORM_BODY_LIMIT) {
        const hasImage = outboundMessages.some(
          (m) =>
            Array.isArray(m.content) &&
            m.content.some((c: { type?: string }) => c.type === "image_url"),
        );
        toast.error(
          hasImage
            ? t("chat.bodyTooLargeImages", { size: formatBytes(bodyBytes) })
            : t("chat.bodyTooLarge", { size: formatBytes(bodyBytes) }),
          { duration: 6000 },
        );
        setStatus("idle");
        return;
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(bodyObj),
        });

        if (!res.ok || !res.body) {
          let message = t("chat.requestFailed");
          // 优先用服务端给的文案（429 时会带上原因、上游原文与排查方向）
          let fromServer = false;
          try {
            const data = (await res.json()) as {
              error?: string;
              upstreamMessage?: string;
            };
            if (data?.error) {
              message = data.error;
              fromServer = true;
              // 上游原文单独一行，便于一眼看清到底是谁在限流
              if (
                data.upstreamMessage &&
                data.upstreamMessage !== t("chat.upstreamNoDetail")
              ) {
                message += `\n${t("chat.upstreamRaw", { msg: data.upstreamMessage })}`;
              }
            }
          } catch {
            /* 非 JSON 响应，走下面的兜底 */
          }
          if (!fromServer) {
            if (res.status === 401) message = t("chat.keyInvalid");
            else if (res.status === 429) message = t("chat.rateLimited");
            else if (res.status >= 500) message = t("chat.serverUnavailable");
          }
          patchAssistant({ error: message });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        let reasoningAcc = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const d = json?.choices?.[0]?.delta ?? {};
              // 思考内容：OpenAI 生态事实标准字段（Agnes thinking / DeepSeek R1 都用它）
              const reasoning: string = typeof d.reasoning_content === "string" ? d.reasoning_content : "";
              const delta: string = typeof d.content === "string" ? d.content : "";

              if (reasoning) {
                reasoningAcc += reasoning;
                patchAssistant({ reasoning: reasoningAcc });
              }
              if (delta) {
                acc += delta;
                // 正文开始到达 → 思考阶段结束，用于切换 UI 状态
                patchAssistant({ content: acc, reasoningDone: true });
              }
            } catch {
              /* SSE 分片，忽略 */
            }
          }
        }

        if (!acc && !reasoningAcc) patchAssistant({ error: t("chat.noContent") });
        else patchAssistant({ reasoningDone: true });
      } catch (error) {
        const isAbort = (error as Error)?.name === "AbortError";
        patchAssistant({ error: isAbort ? t("chat.stopped") : t("chat.networkErr") });
      } finally {
        setStatus("idle");
        setStreamingId(null);
        abortRef.current = null;
      }
    },
    [cloudSync, settings.baseUrls, settings.customProviders, settings.keys, settings.model, setMessages, user],
  );

  const send = React.useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (status === "streaming") return;
      if (!text && attachments.length === 0) return;

      /**
       * 强制登录：发送前就拦住并引导去登录。
       * 这只是体验层（服务端 /api/chat 另有校验），
       * 免得用户打完一长段字才被告知需要登录。
       */
      if (REQUIRE_LOGIN && !user) {
        toast.error(t("chat.needLogin"), {
          description: t("chat.needLoginDesc"),
          duration: 5000,
        });
        return;
      }

      // 确保有当前会话
      let convId = currentId;
      let base: ChatMessage[];
      if (!convId) {
        convId = newConversation();
        base = [];
      } else {
        base = messagesRef.current.filter((m) => !m.error);
        ensureConversation(convId, text);
      }

      /*
       * 这是会话的第一条消息时才去自动命名。
       * 放在请求发出之前：命名接口是独立的短请求，
       * 不该拖慢正式对话的响应。
       */
      if (base.length === 0) {
        autoTitleConversation(convId, text);
      }

      const pending = attachments;
      const userMessage: ChatMessage = {
        id: createId(),
        role: "user",
        content: text,
        createdAt: Date.now(),
        attachments: pending.length ? pending : undefined,
      };
      const next = [...base, userMessage];
      messagesRef.current = next;
      setMessages(next);
      setInput("");
      setAttachments([]);
      void runCompletion(next, convId);
    },
    [
      attachments,
      currentId,
      ensureConversation,
      autoTitleConversation,
      newConversation,
      runCompletion,
      setMessages,
      status,
    ],
  );

  /* ------------------------------ 图片生成 ------------------------------ */
  const generateImage = React.useCallback(async () => {
    if (imageBusy) {
      toast.error(t("image.busy"));
      return;
    }
    if (status === "streaming") return;

    const prompt = input.trim();
    if (!prompt) {
      toast.error(t("image.needPrompt"));
      return;
    }
    if (REQUIRE_LOGIN && !user) {
      toast.error(t("chat.needLogin"), {
        description: t("chat.needLoginDesc"),
        duration: 5000,
      });
      return;
    }

    setImageBusy(true);
    const toastId = toast.loading(t("image.generating"));

    // 确保有当前会话：生成的图要能留在历史里翻回去看
    let convId = currentId;
    let base: ChatMessage[];
    if (!convId) {
      convId = newConversation();
      base = [];
    } else {
      base = messagesRef.current.filter((m) => !m.error);
      ensureConversation(convId, prompt);
    }
    if (base.length === 0) autoTitleConversation(convId, prompt);

    try {
      const res = await fetch("/api/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, apiKey: settings.keys.agnes }),
      });
      const data = (await res.json()) as { images?: string[]; error?: string };
      if (!res.ok || !data.images?.length) {
        toast.error(data.error ?? t("image.failed"), { duration: 6000 });
        return;
      }

      const userMessage: ChatMessage = {
        id: createId(),
        role: "user",
        content: prompt,
        createdAt: Date.now(),
      };
      /*
       * 用 Markdown 图片写进消息，好处是沿用现成的渲染与点击放大，
       * 刷新后也能从会话里还原（前提是对外链接还没过期）。
       */
      const markdown = data.images.map((u) => `![](${u})`).join("\n\n");
      const next: ChatMessage[] = [
        ...base,
        userMessage,
        { id: createId(), role: "assistant", content: markdown, createdAt: Date.now() },
      ];
      messagesRef.current = next;
      setMessages(next);
      setInput("");
      toast.success(t("image.done"));
    } catch {
      toast.error(t("chat.networkErr"));
    } finally {
      setImageBusy(false);
      toast.dismiss(toastId);
    }
  }, [
    autoTitleConversation,
    currentId,
    ensureConversation,
    imageBusy,
    input,
    newConversation,
    setMessages,
    status,
    settings.keys.agnes,
    user,
  ]);

  const retry = React.useCallback(() => {
    const cleaned = messagesRef.current.filter((m) => !m.error && m.content.trim() !== "");
    if (cleaned.length === 0) return;
    messagesRef.current = cleaned;
    setMessages(cleaned);
    void runCompletion(cleaned, currentId);
  }, [currentId, runCompletion, setMessages]);

  function stop() {
    abortRef.current?.abort();
  }

  function handleNew() {
    abortRef.current?.abort();
    newConversation();
    setInput("");
  }

  function handleClearCurrent() {
    abortRef.current?.abort();
    messagesRef.current = [];
    setMessages([]);
    setAttachments([]);
    toast.success(t("chat.clearedCurrent"));
  }

  function clearAllData() {
    abortRef.current?.abort();
    messagesRef.current = [];
    setMessages([]);
    setSettings(DEFAULT_SETTINGS);
    setCloudSync(false);
    clearAllConversations();
    try {
      Object.values(LS_KEYS).forEach((k) => {
        if (k !== LS_KEYS.theme) localStorage.removeItem(k);
      });
    } catch {
      /* 忽略 */
    }
    toast.success(t("chat.clearedAll"));
  }

  /* --------------------------- 对象存储上传 --------------------------- */
  const s3Ref = React.useRef<S3Config>(DEFAULT_S3_CONFIG);
  React.useEffect(() => {
    s3Ref.current = settings.s3 ?? DEFAULT_S3_CONFIG;
  }, [settings.s3]);

  /**
   * 思考模式开关。
   * 用 ref 是因为 runCompletion 是 useCallback，
   * 依赖里带 settings 会导致每次改设置都重建回调；ref 能读到最新值又不触发重建。
   */
  const thinkingRef = React.useRef(false);
  React.useEffect(() => {
    thinkingRef.current = settings.thinking === true;
  }, [settings.thinking]);

  /**
   * 对象存储是否已就绪。
   * 未配置时隐藏上传入口 —— 否则用户传了文件才发现发不出去，体验很差。
   */
  const [storageReady, setStorageReady] = React.useState(false);
  /** 服务端是否通过 Worker binding 直连了 R2（有则免密钥直传） */
  const storageBoundRef = React.useRef(false);

  /** 联网搜索开关（同样用 ref，理由同上：避免重建 useCallback） */
  const webSearchRef = React.useRef(false);
  const [webSearch, setWebSearch] = React.useState(false);
  /** 思考强度：low / medium / high */
  const [effort, setEffort] = React.useState<"low" | "medium" | "high">("medium");

  React.useEffect(() => {
    webSearchRef.current = webSearch;
  }, [webSearch]);

  /** 当前部署平台，用于发送前的请求体体积预检（Vercel 上限比 Workers 小得多） */
  const platformRef = React.useRef<"cloudflare" | "vercel" | "local">("local");
  React.useEffect(() => {
    let alive = true;
    fetch("/api/upload/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d && typeof d.platform === "string") {
          platformRef.current = d.platform as "cloudflare" | "vercel" | "local";
        }
      })
      .catch(() => {
        /* 忽略：拿不到就按宽松处理 */
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 通过 R2 binding 直传 —— **不需要 AK/SK**。
   *
   * Worker 绑了 R2 之后，权限来自 binding 本身（桶是站长自己的），
   * 所以这条路优先于预签名：不用配任何密钥，也不用桶开公开读。
   * 文件经 Worker 落 R2，受 100MB 请求体上限约束。
   */
  const uploadViaBinding = React.useCallback(async (file: File): Promise<Attachment> => {
    const form = new FormData();
    form.append("file", file);
    form.append("filename", file.name);
    form.append("prefix", s3Ref.current?.prefix?.trim() || "agnes-chat");

    const res = await fetch("/api/upload/direct", { method: "POST", body: form });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      url?: string;
      size?: number;
      contentType?: string;
    };
    if (!res.ok || !data.url) {
      throw new Error(data.error ?? t("chat.directFailed", { code: res.status }));
    }

    const mime = data.contentType || file.type || "application/octet-stream";
    return {
      id: createId(),
      name: file.name,
      size: data.size ?? file.size,
      mime,
      kind: mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : "file",
      content: data.url,
    };
  }, []);

  const uploadViaS3 = React.useCallback(async (file: File): Promise<Attachment> => {
    const cfg = s3Ref.current;
    const res = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
        config: cfg,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      uploadUrl?: string;
      publicUrl?: string;
      kind?: string;
    };
    if (!res.ok || !data.uploadUrl || !data.publicUrl) {
      throw new Error(data.error ?? t("chat.presignFailed", { code: res.status }));
    }

    // 直传对象存储：文件不经过本站服务器（Vercel 请求体上限 4.5MB）
    const put = await fetch(data.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
    if (!put.ok) {
      throw new Error(t("chat.putFailed", { code: put.status }));
    }

    const kind: AttachmentKind =
      data.kind === "video" ? "video" : data.kind === "image" ? "image" : "file";

    return {
      id: createId(),
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
      kind,
      content: data.publicUrl,
    };
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(LS_KEYS.sidebarCollapsed, next ? "1" : "0");
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }, []);

  /** 顶栏按钮：移动端打开抽屉，桌面端切换收起 */
  const handleSidebarButton = React.useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      toggleSidebar();
    } else {
      setSidebarOpen(true);
    }
  }, [toggleSidebar]);

  /* ------------------------------ 附件 ------------------------------ */
  const addFiles = React.useCallback(async (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const room = MAX_FILES - attachments.length;
    if (room <= 0) {
      toast.error(t("chat.maxFilesReached", { n: MAX_FILES }));
      return;
    }
    if (list.length > room) {
      toast.warning(t("chat.maxFilesTrimmed", { n: MAX_FILES, room }));
    }

    const picked = list.slice(0, room);
    const s3 = s3Ref.current;
    // 图片 / 视频 / 非文本文件走对象存储；文本文件本地抽取，直接进上下文
    const needsRemote = (f: File) => isImageFile(f) || isVideoFile(f) || !isTextFile(f);

    /**
     * 「能用对象存储」的判定：用户前端配了 S3 **或** 服务端已绑定 R2。
     *
     * 之前只看 s3.enabled，于是 binding 模式下（用户压根没在设置里填过任何东西）
     * 传图片会静默走 base64 内嵌 —— 又慢又容易超限。
     */
    const storageAvailable = s3.enabled || storageBoundRef.current;
    const willUpload = storageAvailable && picked.some(needsRemote);

    let toastId: string | number | undefined;
    if (willUpload) toastId = toast.loading(t("chat.uploading"));

    // 本地内嵌（base64）的体积红线：超过这个就别硬塞了，必被服务端拒。
    // 图片经压缩后一般远低于此值，触发说明图确实太大或压缩没生效。
    const INLINE_LIMIT = IMAGE_TARGET_BASE64;

    const parsed = await Promise.all(
      picked.map(async (f) => {
        if (storageAvailable && needsRemote(f)) {
          try {
            /**
             * 视频：浏览器放不了的格式先在本地转成 mp4 再上传。
             *
             * 这样落库的就是 mp4，之后任何设备打开链接都能直接播，
             * 不用每次播放都在浏览器里现转一遍（播放端转码只存在内存里，
             * 换台设备又要重新下载 32MB 的解码器）。
             */
            let target = f;
            if (isVideoFile(f) && videoNeedsTranscode(f)) {
              const note = (msg: string) => {
                if (toastId !== undefined) toast.loading(msg, { id: toastId });
              };
              note(t("video.convertingUpload", { name: f.name }));

              try {
                target = await transcodeToMp4(f, { onProgress: note, t });
                note(t("chat.uploading"));
              } catch (err) {
                /**
                 * 转码失败**不阻断上传**：原文件照传。
                 * 播放端还有一层 ffmpeg 兜底，只是每次打开都要现转。
                 */
                if (toastId !== undefined) {
                  toast.warning(
                    t("video.convertFailedUpload", {
                      msg: err instanceof Error ? err.message : t("video.unknownError"),
                    }),
                    { id: toastId },
                  );
                }
                if (willUpload) toastId = toast.loading(t("chat.uploading"));
              }
            }

            /* 优先走 R2 binding（免密钥），失败再退回预签名 */
            const att = storageBoundRef.current
              ? await uploadViaBinding(target)
              : await uploadViaS3(target);

            /**
             * 上传"成功"不等于 AI 看得到。
             * 桶没开公开读、自定义域名没生效时，URL 是死的，
             * AI 在服务端拉不到 —— 表现为"配了存储还是看不见图"。
             *
             * 这里主动探测一次，不通就把图转回 base64 内嵌。
             * 内嵌是一定能让 AI 读到的，代价只是请求体变大。
             */
            /**
             * 上传成功后 content 里存的是公开链接。
             * 判断它是不是真能加载 —— 不能就换成 base64 内嵌。
             */
            if (
              att.kind === "image" &&
              att.content &&
              /^https?:\/\//i.test(att.content)
            ) {
              const reachable = await probeImageUrl(att.content);
              if (!reachable) {
                /**
                 * 链接不通 → 退回内嵌。
                 *
                 * ⚠️ 这里必须**先压缩再转 base64**：
                 * 直接用原图转出来的 data URL 动辄好几 MB，
                 * AI 侧解析不了（表现为图片内容为空或直接报错），
                 * 而用户只看到"发出去了但 AI 说没看到图"。
                 */
                const { dataUrl: inline } = await compressImageToDataUrl(
                  f,
                  INLINE_LIMIT,
                ).catch(() => ({ dataUrl: "", compressed: false }));
                if (inline && inline.length <= INLINE_LIMIT) {
                  toast.warning(
                    t("upload.linkNotPublic", { name: f.name }),
                  );
                  // 用 base64 覆盖链接：AI 一定能读到内嵌内容
                  return { ...att, content: inline };
                }
                return {
                  ...att,
                  note: t("upload.linkNotPublicBig", { name: f.name }),
                };
              }
            }
            return att;
          } catch (err) {
            // ⚠️ 不能无条件回落到 base64：大文件内嵌必然触发「单条消息过大」。
            //    只有小文件才值得降级内嵌；大文件要如实告诉用户上传没成功。
            if (f.size <= INLINE_LIMIT) {
              toast.warning(
                t("upload.fallbackLocal", {
                  name: f.name,
                  err: err instanceof Error ? err.message : "",
                }),
              );
              return readFileToAttachment(f);
            }
            return {
              id: createId(),
              name: f.name,
              size: f.size,
              mime: f.type || "application/octet-stream",
              kind: "file" as const,
              note: t("upload.failed", {
                name: f.name,
                err: err instanceof Error ? err.message : t("upload.unknownError"),
              }),
            };
          }
        }
        return readFileToAttachment(f);
      }),
    );

    // 未走对象存储、且内嵌体积仍然过大的：直接拦下并引导去配置存储，
    // 免得用户点发送后才收到服务端的「单条消息过大」。
    const oversize = parsed.filter(
      (a) => a.kind === "image" && (a.content?.length ?? 0) > INLINE_LIMIT,
    );
    if (oversize.length > 0) {
      toast.error(
        t("upload.tooBig", {
          name: oversize[0].name,
          size: formatBytes(oversize[0].content?.length ?? 0),
        }),
        { duration: 6000 },
      );
      return;
    }

    if (toastId !== undefined) {
      const okCount = parsed.filter((a) => a.content?.startsWith("http")).length;
      if (okCount > 0) toast.success(`${t("chat.uploadedFiles")} ${okCount} ${t("chat.filesUnit")}`, { id: toastId });
      else toast.dismiss(toastId);
    }

    setAttachments((prev) => [...prev, ...parsed]);
    const failed = parsed.filter((a) => a.note);
    if (failed.length) toast.warning(failed[0].note);
  }, [attachments.length, uploadViaS3, uploadViaBinding]);

  const removeAttachment = React.useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /* 真实 HTML5 拖拽：只在整页范围内生效，用深度计数避免子元素抖动 */
  const onDragEnter = React.useCallback(
    (e: React.DragEvent) => {
      // 对象存储没配好时不接管拖拽，免得给了提示却又收不下文件
      if (!storageReady) return;
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    [storageReady],
  );

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }, []);

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      if (!storageReady) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files?.length) void addFiles(files);
    },
    [addFiles, storageReady],
  );

  /** 在输入框里直接切模型 */
  function changeModel(modelId: string) {
    setSettings((prev) => {
      const next = { ...prev, model: modelId };
      try {
        localStorage.setItem(LS_KEYS.model, modelId);
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }

  /** 切换思考模式（输入框里的快捷开关） */
  function toggleThinking(on: boolean) {
    setSettings((prev) => {
      const next = { ...prev, thinking: on };
      thinkingRef.current = on;
      try {
        localStorage.setItem(LS_KEYS.thinking, on ? "true" : "false");
      } catch {
        /* 忽略 */
      }
      return next;
    });
  }

  /** 切换联网搜索（输入框里的快捷开关） */
  function toggleWebSearch(on: boolean) {
    setWebSearch(on);
    webSearchRef.current = on;
    try {
      localStorage.setItem(LS_KEYS.webSearch, on ? "true" : "false");
    } catch {
      /* 忽略 */
    }
  }

  function saveSettings(next: ChatSettings) {
    setSettings(next);
    try {
      localStorage.setItem(LS_KEYS.keys, JSON.stringify(next.keys));
      localStorage.setItem(LS_KEYS.baseUrls, JSON.stringify(next.baseUrls));
      localStorage.setItem(LS_KEYS.customProviders, JSON.stringify(next.customProviders));
      localStorage.setItem(LS_KEYS.model, next.model);
      if (next.thinking !== undefined) {
        localStorage.setItem(LS_KEYS.thinking, next.thinking ? "true" : "false");
      }
      if (next.s3) localStorage.setItem(LS_KEYS.s3, JSON.stringify(next.s3));
    } catch {
      /* 忽略 */
    }
    toast.success(t("chat.settingsSaved"));
  }

  const isEmpty = messages.length === 0;

  return (
    <div
      className="relative flex h-screen-safe overflow-hidden bg-background"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* 侧边栏 */}
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={selectConversation}
        onNew={handleNew}
        onDelete={deleteConversation}
        onRename={renameConversation}
        onClearAll={clearAllData}
        onOpenSettings={() => setSettingsOpen(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏：常驻显示，液态玻璃 */}
        <header className="liquid-glass liquid-bar sticky top-0 z-30 mx-2 mt-2 flex h-14 shrink-0 items-center justify-between px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSidebarButton}
              aria-label={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
              title={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </Button>
            {/* 收起时把「新对话」挪到顶栏，避免找不到入口 */}
            {sidebarCollapsed ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNew}
                aria-label={t("sidebar.newChat")}
                title={t("sidebar.newChat")}
                className="hidden md:inline-flex"
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : null}
            <span className="truncate text-sm text-fg-secondary">
              {isEmpty
                ? t("chat.newChat")
                : (conversations.find((c) => c.id === currentId)?.title ?? t("chat.newChat"))}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild title={t("sidebar.arena")}>
              <Link href="/arena" className="gap-1.5">
                <Swords className="h-4 w-4" />
                <span className="hidden lg:inline">{t("sidebar.arena")}</span>
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild title={t("chat.cloudPc")}>
              <Link href="/pc" className="gap-1.5">
                <Monitor className="h-4 w-4" />
                <span className="hidden lg:inline">{t("chat.cloudPc")}</span>
              </Link>
            </Button>
            {!isEmpty ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCurrent}
                title={t("chat.clearCurrent")}
                className="gap-1.5"
              >
                <Eraser className="h-4 w-4" />
                <span className="hidden lg:inline">{t("chat.clearCurrent")}</span>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              title={t("settings.title")}
              className="gap-1.5"
            >
              <Settings2 className="h-4 w-4" />
              <span className="hidden lg:inline">{t("settings.title")}</span>
            </Button>
            {/* 主题切换：常驻顶栏，液态玻璃 */}
            <ThemeToggle />
          </div>
        </header>

        {/* 消息区 */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="flex min-h-full flex-col justify-center py-6">
              <EmptyState onPick={(text) => send(text)} />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onRetry={retry}
                  isStreaming={m.id === streamingId}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </main>

        {/* 输入区 */}
        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto w-full max-w-3xl">
            {isEmpty ? (
              <>
                <ChatInput
                  variant="hero"
                  value={input}
                  onChange={setInput}
                  onSubmit={() => send(input)}
                  onStop={stop}
                  streaming={status === "streaming"}
                  model={mounted ? settings.model : undefined}
                  onModelChange={changeModel}
                  customProviders={settings.customProviders}
                  placeholder={t("input.placeholderDrop")}
                  attachments={attachments}
                  onPickFiles={storageReady ? addFiles : undefined}
                  onRemoveAttachment={removeAttachment}
                  thinkingSupported={supportsThinking(mounted ? settings.model : DEFAULT_MODEL)}
                  thinking={settings.thinking === true}
                  onThinkingChange={toggleThinking}
                  effort={effort}
                  onEffortChange={(v) => {
                    setEffort(v);
                    localStorage.setItem(LS_KEYS.effort, v);
                  }}
                  webSearchSupported={ALLOW_WEB_SEARCH}
                  webSearch={webSearch}
                  onWebSearchChange={toggleWebSearch}
                  imageBusy={imageBusy}
                  onGenerateImage={() => void generateImage()}
                />
                <p className="mt-3 text-center text-xs text-fg-quaternary">
                  {t("input.disclaimerHero")}
                </p>
              </>
            ) : (
              <>
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSubmit={() => send(input)}
                  onStop={stop}
                  streaming={status === "streaming"}
                  model={mounted ? settings.model : undefined}
                  onModelChange={changeModel}
                  customProviders={settings.customProviders}
                  placeholder={t("input.placeholderDrop")}
                  attachments={attachments}
                  onPickFiles={storageReady ? addFiles : undefined}
                  onRemoveAttachment={removeAttachment}
                  thinkingSupported={supportsThinking(mounted ? settings.model : DEFAULT_MODEL)}
                  thinking={settings.thinking === true}
                  onThinkingChange={toggleThinking}
                  effort={effort}
                  onEffortChange={(v) => {
                    setEffort(v);
                    localStorage.setItem(LS_KEYS.effort, v);
                  }}
                  webSearchSupported={ALLOW_WEB_SEARCH}
                  webSearch={webSearch}
                  onWebSearchChange={toggleWebSearch}
                  imageBusy={imageBusy}
                  onGenerateImage={() => void generateImage()}
                />
                <p className="mt-2 text-center text-xs text-fg-quaternary">
                  {t("input.disclaimer")}
                </p>
              </>
            )}
          </div>

          {/*
            备案条：放在主列内部、输入区之后。
            ⚠️ 之前放在根容器（flex-row + overflow-hidden）下，
            会变成主列右侧的一个窄条并被裁掉 —— 主界面根本看不到。
          */}
          <ChatFooter />
        </div>
      </div>

      {/* 拖拽文件时的全屏提示 */}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary/5 backdrop-blur-sm">
          <div className="glass flex flex-col items-center gap-3 rounded-2xl px-10 py-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium">{t("input.dropToAttach")}</p>
            <p className="text-xs text-fg-tertiary">
              {t("input.dropLimit", { max: Math.round(MAX_TEXT_SIZE / 1024 / 1024), count: MAX_FILES })}
            </p>
          </div>
        </div>
      ) : null}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSave={saveSettings}
        user={user}
        cloudSync={cloudSync}
        onCloudSyncChange={handleCloudSyncChange}
        onClearAll={clearAllData}
      />
    </div>
  );
}
