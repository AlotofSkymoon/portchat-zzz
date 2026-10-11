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
    date: "2026-10-11",
    title: { zh: "助手自称简化 & 实验性标注", en: "Simpler self-intro & experimental labels" },
    entries: [
      {
        tag: "improve",
        zh: "助手打招呼时只说「嗨！我是 Pot」，不再附带「现在透过 Portchat 与你的对话」这句多余说明",
        en: "The assistant now greets with just \"Hi! I'm Pot\" instead of tacking on an explanation about talking through Portchat",
      },
      {
        tag: "new",
        zh: "Passkey 登录与扫码登录标注为「实验性」，并说明失败时改用邮箱或 GitHub 登录",
        en: "Passkey sign-in and QR sign-in are now labelled experimental, with a hint to fall back to email or GitHub if they fail",
      },
      {
        tag: "improve",
        zh: "换上新版品牌标识：蓝气泡 + 橙色三道闪光，字标改成 Pot（首字母蓝、其余橙），站点名同步改为 Pot",
        en: "New brand mark: blue speech bubble with three orange sparkles, wordmark now reads Pot (initial in blue), and the site name follows",
      },
      {
        tag: "fix",
        zh: "修复白底转透明时把气泡里的白色「脸」一起抠掉的问题 —— 改用从画布边缘洪水填充判定背景，只有跟外框连通的白才算背景",
        en: "Fixed the white 'face' inside the bubble being punched out when removing the white background. Background is now detected by flood-filling from the canvas edge, so only white connected to the border is treated as background",
      },
    ],
  },
  {
    date: "2026-10-10",
    title: { zh: "Passkey 存储重构", en: "Passkey storage rebuilt" },
    entries: [
      {
        tag: "fix",
        zh: "修复 Passkey 绑定成功却看不到、登录永远提示「没有对应的账号」：凭据原存在用户记录的单个字段里，而该字段在部分存储后端会被静默丢弃（写入不报错、读取永远为空）。现改为独立存储，与用户记录解耦",
        en: "Fixed passkeys binding successfully yet never showing up, with login always saying 'no matching account'. Credentials used to live in a single field on the user record, which some storage backends silently dropped — the write reported success while reads always came back empty. They are now stored independently of the user record",
      },
      {
        tag: "improve",
        zh: "登录改用 WebAuthn 标准的 userHandle 反查账号作为主路径，自建索引只作兜底 —— 索引丢失或编码写法不一致时仍能登录",
        en: "Login now resolves the account via the standard WebAuthn userHandle first, with our own index only as a fallback, so sign-in still works if the index is lost or encodings differ",
      },
      {
        tag: "improve",
        zh: "凭据匹配放宽为三级（自解凭证 ID → 浏览器回传 ID → 逐字节比对），同一把钥匙不再因字符串写法不同被判为陌生",
        en: "Credential matching now falls back three ways (decoded ID, browser-returned ID, byte-for-byte), so the same key is never rejected over a difference in string formatting",
      },
      {
        tag: "fix",
        zh: "修复页面切换遮罩显示成一大张品牌图：改用横向布局时新增的类名漏写样式，右上角徽标里的图片没有尺寸约束，512px 原图直接铺满画面把纸飞机盖住。现补齐样式，飞机回到航迹上飞行",
        en: "Fixed the page-transition overlay rendering as one giant brand image: the new class names from the horizontal layout shipped without styles, so the badge image had no size constraint and the 512px artwork filled the screen, hiding the paper plane. Styles are now in place and the plane flies along its trail again",
      },
    ],
  },
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
      {
        tag: "new",
        zh: "iOS / PWA 观感：装到主屏幕后自动切换（系统字体、加厚毛玻璃、弹簧曲线、避让刘海与底部小黑条、蓝色发送按钮），设置里可手动选「自动 / 始终 iOS / 始终网页」",
        en: "An iOS-flavoured look that turns on automatically once installed to the home screen — system font, thicker frosted glass, spring curves, safe-area insets and a blue send button. Settings lets you force it on, off or keep it automatic",
      },
      {
        tag: "new",
        zh: "HTML 预览：代码块可一键预览网页，沙箱开启脚本但拿不到本站登录信息，支持刷新与三档高度",
        en: "HTML preview: render a code block right inside the chat. Scripts run in a sandbox that cannot touch your site data, with reload and three height presets",
      },
      {
        tag: "new",
        zh: "输入栏精简为「模型标签 + 附件 + 发送」，思考 / 联网 / 生图收进模型菜单，并新增生图参数页",
        en: "The composer is now just model tag, attach and send — thinking, web search and image generation moved into the model menu, which also gained an image-settings page",
      },
      {
        tag: "new",
        zh: "Vercel AI Gateway 作为内置供应商（填 Key 后才显示，可继续探测新模型）",
        en: "Vercel AI Gateway is now a built-in provider — it appears once its key is set and supports probing for more models",
      },
      {
        tag: "improve",
        zh: "推理滑块换成 Codex 那套实现：拖动 1:1 跟手、手指滑出范围也不掉跟、支持方向键微调，星空浓淡随位置连续变化",
        en: "The reasoning slider was rebuilt from the Codex implementation: it tracks your finger 1:1, keeps tracking when you drag outside, supports arrow-key nudging, and its starfield intensity ramps continuously with position",
      },
      {
        tag: "improve",
        zh: "页面过渡改为纸飞机横飞：虚线航迹自左向右拉出，飞机落位后「正在前往…」与目的地排成一行",
        en: "Page transitions now fly a paper plane across the screen: a dashed trail draws left to right, and \"heading to…\" plus the destination sit inline beside the plane",
      },
      {
        tag: "improve",
        zh: "新品牌标识：全套图标换成圆角版，空状态与聊天头像统一改用新 logo",
        en: "New brand mark: the whole icon set is rounded-corner now, and both the empty-state art and chat avatars use it",
      },
      {
        tag: "improve",
        zh: "助手名由 Coffing 改为 Pot，四门语言文案同步更新",
        en: "The assistant is renamed from Coffing to Pot across all four languages",
      },
      {
        tag: "improve",
        zh: "侧边栏历史按今天 / 昨天 / 近 7 天 / 近 30 天 / 更早分组",
        en: "Chat history is grouped by day: Today, Yesterday, past 7 days, past 30 days and older",
      },
      {
        tag: "improve",
        zh: "首页回归：未登录先看到首页，已登录直接进聊天",
        en: "The landing page is back — visitors see it first, while signed-in users go straight to chat",
      },
      {
        tag: "fix",
        zh: "联网搜索不再把检索结果当你的话复读：结果改为服务端独立注入且不进历史，条数压到 10 条、不再把网址喂给模型",
        en: "Web search no longer gets echoed back as if you'd said it — results are injected server-side, kept out of history, trimmed to 10 and stripped of URLs before reaching the model",
      },
      {
        tag: "fix",
        zh: "不同供应商的同名模型现在分开显示与勾选，不会出现两个都打勾",
        en: "Same-named models from different providers are separated and checked independently instead of both appearing selected",
      },
      {
        tag: "fix",
        zh: "修复 iOS 添加到主屏幕后仍以普通 Safari 打开，导致观感不生效",
        en: "Fixed iOS opening the site in plain Safari even after adding it to the home screen, which kept the iOS look from ever activating",
      },
      {
        tag: "fix",
        zh: "「最垃圾模型」投票只列出本站点实际可用的模型：此前直接渲染全量内置清单，把站点根本没配的 Claude / GPT 等也摆出来给人投",
        en: "The worst-model ballot now lists only models this site can actually run — it used to render the entire built-in catalogue, including Claude and GPT entries this site never configured",
      },
      {
        tag: "fix",
        zh: "修复扫码登录扫不出来：原先自己实现的二维码编码器生成的矩阵是错的（同内容下 1369 个模块错了 579 个），码画得出来却扫不出。改用成熟的二维码库生成",
        en: "Fixed QR sign-in being unscannable: the hand-rolled QR encoder produced a wrong matrix (579 of 1369 modules off for the same input), so the code rendered but could never be scanned. Now generated by a proven QR library",
      },
      {
        tag: "improve",
        zh: "Passkey 卡片显示已绑定数量与同步状态，绑定失败时给出真实原因（取消 / 超时 / 已绑定过 / 非 HTTPS）而不再只说「添加失败」",
        en: "The passkey card now shows how many are bound and whether each syncs; failures report the real reason (cancelled / timed out / already registered / not HTTPS) instead of a bare \"failed\"",
      },
      {
        tag: "improve",
        zh: "输入框附件「+」移到最左侧，模型选择器与发送按钮靠右",
        en: "The attachment \"+\" moved to the far left; the model picker and send button stay on the right",
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
