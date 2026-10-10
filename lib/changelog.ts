/**
 * 更新日志数据源（10-09 起连载）
 *
 * 只放「用户能感知到」的改动，内部重构不写进来。
 * 每条给中英两版文案：zh-CN / zh-TW 走 zh，en / fr 走 en，
 * 避免为了一个日志页去维护四门语言的重复文本。
 */

export type ChangelogTag = "new" | "improve" | "fix";

export type ChangelogEntry = {
  tag: ChangelogTag;
  zh: string;
  en: string;
};

export type ChangelogDay = {
  /** ISO 日期，倒序排列 */
  date: string;
  title: { zh: string; en: string };
  entries: ChangelogEntry[];
};

export const CHANGELOG_START_DATE = "2026-10-09";

export const CHANGELOG: ChangelogDay[] = [
  {
    date: "2026-10-10",
    title: { zh: "滑块消耗提示与菜单定位", en: "Effort cost hint & menu placement" },
    entries: [
      {
        tag: "improve",
        zh: "推理等级滑块上方显示实际消耗倍率（1× / 1.25× / 1.6× / 2.2×），拉满时提示「更快消耗使用额度」",
        en: "The reasoning slider now shows its real cost multiplier (1× / 1.25× / 1.6× / 2.2×) and warns that higher levels burn quota faster",
      },
      {
        tag: "fix",
        zh: "修复模型菜单浮在半空：此前按最大高度定位，内容较短时菜单底边离按钮几百像素，现改为渲染后按真实高度贴合",
        en: "Fixed the model menu floating in mid-air — it was positioned by max height, so short menus hung hundreds of pixels above the button. It now measures its real height and sits flush against it",
      },
    ],
  },
  {
    date: "2026-10-09",
    title: { zh: "连载开始", en: "First entry" },
    entries: [
      {
        tag: "new",
        zh: "竞技场 /arena：多模型自动辩论（立论→交锋→结辩→裁判裁决）与狼人杀（最多 12 座，含猎人、白神）",
        en: "Arena: multi-model debates and Werewolf games (up to 12 seats, Hunter & Idiot roles)",
      },
      {
        tag: "new",
        zh: "创作页 /create：独立生图与生影片，可选张数、比例（含 21:9）、画质与时长",
        en: "Create page: image & video generation with count, aspect ratio (incl. 21:9), quality and duration",
      },
      {
        tag: "new",
        zh: "生成记录自动保存，可一键转存到对象存储永久保留",
        en: "Generation history is saved automatically and can be persisted to object storage",
      },
      {
        tag: "new",
        zh: "思考强度滑块：关 / 低 / 高 / 最高，等级越高模型想得越久、token 消耗越大",
        en: "Reasoning slider: Off / Low / High / Max — higher means longer thinking and far more tokens",
      },
      {
        tag: "new",
        zh: "上传视频时自动抽取关键帧，视觉模型现在能「看到」视频内容",
        en: "Uploaded videos are sampled into key frames so vision models can actually see them",
      },
      {
        tag: "new",
        zh: "两步验证（2FA）与 GitHub 登录 / 绑定，免验证登录状态可保持 30 天",
        en: "Two-factor auth plus GitHub sign-in & linking; trusted devices stay signed in for 30 days",
      },
      {
        tag: "new",
        zh: "自定义昵称，账户设置页整合昵称、邮箱、GitHub 与两步验证",
        en: "Custom nickname; the account page now hosts nickname, email, GitHub and 2FA in one place",
      },
      {
        tag: "new",
        zh: "支持七牛云 S3 存储，空间域名自动拼接",
        en: "Qiniu S3 storage support with automatic bucket-domain assembly",
      },
      {
        tag: "new",
        zh: "更新日志（本页），从今天开始连载",
        en: "This changelog — serialised from today on",
      },
      {
        tag: "improve",
        zh: "内置书生·浦语（Atria-Dawn-Preview，256K 上下文），未填 Key 的供应商不再显示",
        en: "Built-in Atria Dawn Preview (256K context); providers without a key are hidden",
      },
      {
        tag: "improve",
        zh: "管理员追加的模型可保存到站点，对所有用户生效",
        en: "Models added by an admin can be saved site-wide for every user",
      },
      {
        tag: "improve",
        zh: "邮箱策略放宽：支持 Hypermail / Gmail / QQ 以及各类教育邮箱（.edu、.edu.hk 等）",
        en: "Email policy allows Hypermail, Gmail, QQ and education addresses (.edu, .edu.hk, …)",
      },
      {
        tag: "improve",
        zh: "视频解码器换用 unpkg 源并加入魔数预检，不再下载到一半才发现是坏包",
        en: "The video decoder now uses unpkg with a magic-number check instead of failing mid-download",
      },
      {
        tag: "fix",
        zh: "修复视频抽帧附件缺少字段导致的构建失败",
        en: "Fixed a build failure caused by missing fields on video frame attachments",
      },
      {
        tag: "new",
        zh: "联网搜索升级为 Agent 模式：模型自己决定搜什么、还要不要再搜，最多三轮并串成关键词链（例：问「孙楠最近在做什么」会先搜「孙楠」再搜「孙楠 现状」）",
        en: "Web search is now agentic: the model decides what to search and whether to search again, chaining up to three queries (asking about someone's latest news searches the name, then the name plus \"current\")",
      },
      {
        tag: "improve",
        zh: "思考强度滑块移进模型菜单，模型与推理等级同屏调节，按钮上直接显示当前档位",
        en: "The reasoning slider moved into the model menu — model and effort level in one view, with the level shown on the button",
      },
    ],
  },
];

export const CHANGELOG_TAG_LABEL: Record<ChangelogTag, { zh: string; en: string }> = {
  new: { zh: "新增", en: "New" },
  improve: { zh: "改进", en: "Improved" },
  fix: { zh: "修复", en: "Fixed" },
};
