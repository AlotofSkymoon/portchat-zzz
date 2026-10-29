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
    date: "2026-10-29",
    title: { zh: "付款方式可以选 AlipayHK 或支付宝", en: "Choose between AlipayHK and Alipay" },
    entries: [
      {
        tag: "new",
        zh: "付款页把 AlipayHK 与支付宝两个钱包都列出来，各自标清能不能用；站长没配的那个标「未配置」，不再让人对着一片空白猜",
        en: "The payment page lists both AlipayHK and Alipay with their own availability. An unset-up wallet is marked as such instead of leaving a blank area",
      },
      {
        tag: "fix",
        zh: "赞助页以前共用一个开关，配了 AlipayHK 就把内地支付宝也点亮，选了却跳到一个没有码的付款页 —— 现在两个钱包各自判断",
        en: "Both wallets used to share one flag, so setting up AlipayHK wrongly enabled mainland Alipay too, and picking it led to a page with no code. They are now evaluated separately",
      },
      {
        tag: "improve",
        zh: "在赞助页选好的钱包会带到付款页，不用再选一次；内地支付宝的码配好后设 NEXT_PUBLIC_ALIPAY_QR 与 NEXT_PUBLIC_ALIPAY_PAY_URL 即可，不用改代码",
        en: "The wallet picked on the sponsor page carries over to the payment page, and a mainland Alipay code only needs the NEXT_PUBLIC_ALIPAY_QR and NEXT_PUBLIC_ALIPAY_PAY_URL env vars",
      },
    ],
  },
  {
    date: "2026-10-29",
    title: { zh: "收款码改成真实支付链接", en: "Payment QR now points at the real payment page" },
    entries: [
      {
        tag: "fix",
        zh: "付款页以前取的是渠道列表第一项（支付宝），而那张图根本没放进站点，扫码的人看到的正是「该二维码对应服务无法支持」—— 现在只展示真正有码或有支付链接的渠道",
        en: "The payment page used the first channel (Alipay), whose image was never uploaded — that is what caused the 'this QR code is not supported' error. Only channels with an actual code or link are shown now",
      },
      {
        tag: "new",
        zh: "不用扫码了：付款页加了「打开 AlipayHK 付款页」按钮，点了直接跳到真正的支付页，付完回来填交易号",
        en: "No scanning needed: a button opens the real AlipayHK payment page directly — come back afterwards to enter the transaction number",
      },
      {
        tag: "improve",
        zh: "付款页的二维码改为用真实支付链接现场生成（不再依赖 public/ 里那张图），扫了直接进支付页；站内收款码也换成了最新那张",
        en: "The payment QR is now generated live from the real payment URL instead of relying on an image file, and the stored code was replaced with the latest one",
      },
    ],
  },
  {
    date: "2026-10-29",
    title: { zh: "赞助分成赞助与代购档位", en: "Sponsorship split into sponsor and purchase tiers" },
    entries: [
      {
        tag: "new",
        zh: "赞助页新增五个档位：赞助站长 10 HKD、赞助 .xyz 域名 7 HKD、赞助 .top 域名 33 HKD、代购 .xyz 6.82 HKD、代购 .top 31.78 HKD —— 选完档位收款码会按该档金额重新生成",
        en: "Five tiers on the sponsor page: sponsor the owner HKD 10, fund a .xyz domain HKD 7, fund a .top domain HKD 33, buy a .xyz HKD 6.82, buy a .top HKD 31.78 — the QR code regenerates for the selected amount",
      },
      {
        tag: "new",
        zh: "代购档要先填上想要的域名（如 123456.xyz）才会出码，后缀必须与档位一致；域名会显示在付款页和后台订单里，站长照着买",
        en: "Purchase tiers require the domain you want (e.g. 123456.xyz) before the QR appears; the suffix must match the tier. The domain shows on the payment page and in the admin order",
      },
      {
        tag: "improve",
        zh: "AI 审核会连档位、金额和域名一起看：代购订单的域名不像样也会被标为可疑转人工",
        en: "AI review now weighs the tier, amount and domain together — a purchase order with a bogus domain is flagged for manual review",
      },
      {
        tag: "improve",
        zh: "后台订单卡片标出每一笔的档位，代购单直接显示域名，不再只看金额猜这是赞助还是代购",
        en: "Admin orders now show each tier, and purchase orders display the domain — no more guessing from the amount alone",
      },
      {
        tag: "new",
        zh: "付款页可以选择支付方式：AlipayHK、支付宝、Apple Pay、银行卡，或站内 Pot Pay 余额",
        en: "The payment page now offers a choice: AlipayHK, Alipay, Apple Pay, bank card, or your in-site Pot Pay balance",
      },
      {
        tag: "new",
        zh: "新增 Pot Pay 钱包：在账号页充值后可用余额付费，流水可查；余额不足时会提示先充值",
        en: "New Pot Pay wallet: top up from your account page and pay with the balance, with a running ledger. You'll be prompted to top up when the balance runs short",
      },
      {
        tag: "fix",
        zh: "修掉两处会让部署直接失败的问题：赞助分档的模块漏传，以及充值接口多导出一个常量被 Next 判为非法导出",
        en: "Fixed two issues that broke deployment: a missing module for the sponsor tiers, and an extra export in the top-up endpoint that Next rejects",
      },
    ],
  },
  {
    date: "2026-10-20",
    title: { zh: "赞助改成订单号核销", en: "Sponsorship now runs on order numbers" },
    entries: [
      {
        tag: "new",
        zh: "赞助页的收款码改成服务端生成的订单码：扫下去先落到本站付款页，页面上有本笔订单的令牌，付款时填进备注就能对上账",
        en: "The sponsor QR is now generated per order: scanning it opens a payment page showing that order's token, which goes in the payment note so payments can be matched",
      },
      {
        tag: "new",
        zh: "付款完成后可提交平台交易号，AI 先审一遍合理性，判可疑的转站长人工确认 —— 不会自动驳回，避免误杀真付款",
        en: "After paying you can submit the transaction number. An AI pre-checks it; anything suspicious goes to manual review — it never auto-rejects, so real payments are never lost",
      },
      {
        tag: "new",
        zh: "管理员面板新增赞助订单卡片，待确认的排最前并标红，可一键确认、驳回或重新审核",
        en: "The admin panel gained a sponsor orders card: orders awaiting review sort first and show a red badge, with one-click confirm, reject or re-review",
      },
      {
        tag: "improve",
        zh: "二维码链接里只有订单号、不含令牌，令牌只显示在付款页上由付款人手动抄写",
        en: "The QR link carries only the order id, never the token — the token is shown on the payment page and copied by hand",
      },
      {
        tag: "fix",
        zh: "手机上扫不了自己这块屏幕，所以付款页地址也直接给成了可点的链接",
        en: "You can't scan your own screen on a phone, so the payment link is also tappable directly",
      },
    ],
  },
  {
    date: "2026-10-19",
    title: { zh: "明暗切换不再卡顿", en: "Theme switching no longer stutters" },
    entries: [
      {
        tag: "improve",
        zh: "圆形扩散改用合成器动画（缩放 + 淡出），不再对整页做快照：实测掉帧从 11 次降到 0 次",
        en: "The circular reveal now uses compositor-only animation (scale + fade) instead of snapshotting the whole page: dropped frames went from 11 to 0 in testing",
      },
      {
        tag: "improve",
        zh: "切换动作发生在新主题圆盖满屏幕之后，重渲染过程被遮住，不会再看到中间态",
        en: "The swap happens after the circle covers the screen, so the re-render stays hidden",
      },
    ],
  },
  {
    date: "2026-10-18",
    title: { zh: "邮箱白名单加入 DNSHE 与 Henna", en: "DNSHE and Henna addresses are now accepted" },
    entries: [
      {
        tag: "new",
        zh: "注册与换绑现在接受 DNSHE 邮箱（@v.cd、@cn.mt）和 Henna 邮箱（@r0.us.ci）",
        en: "DNSHE (@v.cd, @cn.mt) and Henna (@r0.us.ci) addresses are now accepted at sign-up and when changing email",
      },
    ],
  },
  {
    date: "2026-10-12",
    title: { zh: "全站圆角统一为一套量表", en: "One radius scale for the whole site" },
    entries: [
      {
        tag: "fix",
        zh: "样式引擎换回 Tailwind CSS：UnoCSS 不认识的类名会静默不产出 CSS，换回后可预期性更好",
        en: "Switched the style engine back to Tailwind CSS — UnoCSS drops unknown classes silently",
      },
      {
        tag: "improve",
        zh: "配色主题只保留 Anthropic、Sidefolio、Material 3 三套，其余移除",
        en: "Only Anthropic, Sidefolio and Material 3 presets remain",
      },
      {
        tag: "improve",
        zh: "Material 3 主题重做：官方 baseline purple 色值、五级表面容器、状态层（8% / 12%）、三级高度阴影、M3 形状标度与 emphasized 曲线",
        en: "Material 3 rebuilt: baseline purple tokens, five surface containers, 8%/12% state layers, three elevation levels, M3 shape scale and emphasized easing",
      },
      {
        tag: "fix",
        zh: "圆角不再各走各的：顶栏、模型按钮、设置卡片用的是一套大圆角变量，而页面里绝大多数组件走的是 Tailwind 的 rounded-*，两者数值差了一倍多，所以同一个画面里顶栏很圆、下面的卡片却是方的。现在所有圆角都来自同一套量表，换主题时整站一起变",
        en: "Radius no longer comes from two competing scales: the top bar, model button and settings cards used one set of large radius variables while most of the page used Tailwind rounded-*, and the two differed by more than double — so the bar looked round while the cards below looked square. Every corner now comes from one scale that shifts together when you switch themes",
      },
      {
        tag: "fix",
        zh: "繁体中文不再一会儿昭源環方、一会儿系统字体：九个主题各写了一遍中文字体，摆的位置还不一样——iOS 主题把它排在系统字体之后，于是中文永远被系统字截胡；iOS 观感那一块压根没写中文；Material 3 末尾还混了个 Noto Sans。现在统一成一个 --font-tc 变量，中文字体来源唯一",
        en: "Traditional Chinese no longer flips between Chiron Rounded and a system font: nine themes each declared the Chinese font in a different position — the iOS theme placed it after the system font so Chinese was always intercepted, the iOS variant block omitted it entirely, and Material 3 had a stray Noto Sans at the end. One --font-tc variable is now the single source for Chinese type",
      },
      {
        tag: "fix",
        zh: "中文标点跟着汉字走了：字体的 unicode-range 原先只覆盖汉字和中文标点区，漏了引号、省略号、破折号和间隔号，这些字符会掉到系统字体去——同一句话里汉字是昭源環方、旁边的「」却是另一种字体，看着就像字体在跳。现在补上了",
        en: "Chinese punctuation now matches the characters: the font's unicode-range covered hanzi and the CJK punctuation block but omitted quotes, ellipsis, dashes and the interpunct, so those glyphs fell through to the system font — a sentence could render hanzi in Chiron while the adjacent 「」 used another face, which read as the font jumping. The ranges are filled in",
      },
      {
        tag: "fix",
        zh: "深色模式下发送按钮的箭头回来了：Material 3 深色主题把「四级文字」误写成了 outline-variant，而它的值和禁用按钮的底色 --muted 完全相同，于是灰底上的灰箭头对比度是 1:1，等于隐形。现在四级文字改回真正的文字色，并让禁用按钮的图标走 muted-foreground（它与底色是成对设计的），所有主题的对比度都回到 3.6:1 以上",
        en: "The send arrow is back in dark mode: the Material 3 dark theme set the quaternary text token to the outline-variant value, which is byte-identical to --muted, the disabled button's background — a grey arrow on a grey circle at 1:1 contrast, effectively invisible. Quaternary is now a real text colour again, and the disabled button's icon uses muted-foreground (the token designed to pair with that background), bringing every theme above 3.6:1",
      },
    ],
  },
  {
    date: "2026-10-11",
    title: { zh: "扫码回归 + 移除云电脑 + 注销账号可反悔 + 去 AI 味重构", en: "QR scan returns, cloud PC removed, reversible deletion, de-AI redesign" },
    entries: [
      {
        tag: "improve",
        zh: "全站圆角回到圆润的一套：前一轮去 AI 味把按钮压到 6px，是全站最方的一档，看着难受。现在按钮、输入框、卡片、气泡与顶栏、模型切换、设置卡片共用同一套量表（10 / 20 / 26 / 32 / 38 / 44 / 52px），换主题时整站一起变，不会再上面圆、下面方",
        en: "Radii are round again across the site: the previous de-AI pass pushed buttons down to 6px, the squarest step in the scale, which felt harsh. Buttons, inputs, cards and bubbles now share one scale with the top bar, model switcher and settings cards (10 / 20 / 26 / 32 / 38 / 44 / 52px), so a theme changes everything at once instead of leaving rounded chrome above square content",
      },
      {
        tag: "improve",
        zh: "账号相关设置全部收进「账号」页：昵称、邮箱、两步验证、GitHub 绑定、登录令牌、注销账号、云端保存只在账号页出现，设置里只留聊天本身的配置，并留一行说明告诉这些东西去哪了",
        en: "Everything account-related now lives on the Account page: nickname, email, two-factor, GitHub link, login token, deletion and cloud sync appear only there. Settings keeps just the chat configuration, with a line pointing to where the account items went",
      },
      {
        tag: "improve",
        zh: "云端保存改为强制开启：不再有开关，登录后一定会从服务端拉回历史对话，换设备也能接着聊，不会再出现进来一片空白以为记录没了",
        en: "Cloud save is now always on: the toggle is gone, and signing in always pulls your history back from the server, so switching devices keeps the conversation instead of showing an empty screen",
      },
      {
        tag: "fix",
        zh: "移除 Passkey 登录：登录页按钮、二次认证选项、账号页绑定卡片、后台接口与底层代码全部清除，二次认证回到密码 / 两步验证 / 邮箱验证码三选一",
        en: "Passkey sign-in removed: the button on the sign-in page, the second-factor option, the binding card on the account page, the API routes and the underlying code are all gone. Second-factor verification is back to password, two-factor or email code",
      },
      {
        tag: "improve",
        zh: "更新日志每天可折叠：点日期标题即可展开或收起，右上角有「全部展开 / 全部收起」。默认只展开最新一天，每节右侧标出当天条目数",
        en: "Changelog days are collapsible: click a date heading to expand or collapse it, and use Expand all / Collapse all in the top-right corner. Only the newest day is open by default, and each heading shows how many entries that day holds",
      },
      {
        tag: "improve",
        zh: "去 AI 味重构（第一轮）：新增一套设计 Token（间距 4px 基数、圆角四档、描边三档、表面层级、阴影四档、动效四档时长与四条曲线），组件不再各写各的数值。首页三色极光压成单色极淡光晕、标题渐变文字改成品牌色单色、卡片与侧边栏去掉无效的毛玻璃、按钮与输入框圆角降到 6px / 10px、彩色外发光全部改中性投影、消息入场从 550ms 缩到 240ms、正文加上 72 字符单行上限",
        en: "De-AI redesign, round one: a design token layer now covers spacing, a four-step radius scale, three border weights, surface elevation, four shadow levels and four motion durations with four easing curves, so components stop inventing their own numbers. The landing page's tri-colour aurora became a single faint brand glow, gradient headlines became solid brand colour, cards and the sidebar dropped their useless backdrop blur, button and input radii dropped to 6px / 10px, coloured glows became neutral shadows, message entry shrank from 550ms to 240ms and body text is capped at 72 characters per line",
      },
      {
        tag: "fix",
        zh: "按钮 hover 不再靠 brightness 提亮：原先是品牌色外发光 + 整体调亮，改投影抬升（悬浮高度变化）+ 按下时压回，反馈是物理的而不是滤镜",
        en: "Button hover no longer relies on brightness: it used a brand-coloured glow plus a global brighten, and now raises the shadow instead (a change in elevation) with a press-back on click, so the feedback is physical rather than a filter",
      },
      {
        tag: "new",
        zh: "扫码登录回归：二维码里现在只有登录令牌本身，不再是一串网址；登录页新增「扫码登录」，点开调用相机取景，识别到令牌后自动完成登录。相机被拒、设备没有摄像头、非 HTTPS 环境都会给出明确提示，不会黑屏",
        en: "QR sign-in is back: the code now contains only the login token, not a URL. The sign-in page gained a Scan option that opens the camera; once the token is recognised, sign-in completes automatically. Denied permission, missing cameras and non-HTTPS contexts all get a clear message instead of a black screen",
      },
      {
        tag: "new",
        zh: "注销账号需要三要素并留 100 分钟反悔期：GitHub 认证 + 密码 + 两步验证齐全才受理（未绑定 GitHub 的账号退化为密码 + 两步验证），受理后 100 分钟内可以再做一次两步验证取消，也可以先把聊天记录导出成文件",
        en: "Deleting an account now needs three factors and offers a 100-minute grace period: GitHub verification plus password plus two-factor (accounts without GitHub fall back to password plus two-factor). During those 100 minutes another two-factor check cancels the deletion, and you can export your chats first",
      },
      {
        tag: "improve",
        zh: "登录当下就能看到注销提醒：账号处于宽限期时，登录成功会先显示醒目横幅告知剩余时间，并给出「去设置取消」与「仍然继续」两个选择，不会一进聊天就被划走",
        en: "You see the deletion warning the moment you sign in: if the account is in its grace period, sign-in shows a prominent banner with the time left and two choices — cancel it in Settings, or continue anyway",
      },
      {
        tag: "improve",
        zh: "移除云电脑：页面、顶部入口、过渡名称与相关文案全部清理",
        en: "Cloud PC removed: the page, the top-bar entry, its transition name and all related copy are gone",
      },
    ],
  },
  {
    date: "2026-10-11",
    title: { zh: "登录改用令牌 & 同一网络重复使用即作废", en: "Sign-in token replaces QR, voided on reuse" },
    entries: [
      {
        tag: "new",
        zh: "登录令牌取代扫码：已登录设备在设置里生成一串令牌，另一台设备直接粘贴到登录页即可登录，不用再扫二维码。旧的 /qr 链接形态仍然兼容",
        en: "A sign-in token replaces the QR code: a signed-in device generates a token in Settings, and another device simply pastes it into the sign-in page. The old /qr link form still works",
      },
      {
        tag: "new",
        zh: "同一网络 24 小时内第二次使用同一令牌，令牌立即作废：每次提交都给「IP × 令牌」记一次数，第二次提交时先作废再返回，不管这次能不能通过校验 —— 把令牌转给别人用就没意义了",
        en: "Reusing the same token from the same network twice within 24 hours voids it on the spot. Every submission is counted per IP × token; the second one voids the token before validation, whether or not it would have passed. Sharing a token with someone else is pointless",
      },
      {
        tag: "improve",
        zh: "IP 不落明文：只存哈希前 16 位，避免把登录记录变成一份可回溯的 IP 清单",
        en: "IPs are never stored in plaintext — only the first 16 hex digits of a hash, so login records do not turn into a traceable IP list",
      },
      {
        tag: "fix",
        zh: "令牌粘贴容错：复制时带上的空格、换行，以及整条 /qr 链接都能正确解析；含非法字符或超长的输入会直接拒绝，不再送到存储层",
        en: "Pasted tokens are forgiving: stray spaces, line breaks and even a full /qr link parse correctly. Input with illegal characters or excessive length is rejected before reaching storage",
      },
    ],
  },
  {
    date: "2026-10-25",
    title: { zh: "端砚模型更新，移除浦语", en: "InkStone models refreshed, InternLM removed" },
    entries: [
      {
        tag: "new",
        zh: "书生·端砚模型清单更新：新增 Atria Dawn、Sage A1.5、书生 Decision 4B、DeepSeek V4.1 Flash（1017）",
        en: "InkStone model list refreshed: added Atria Dawn, Sage A1.5, Intern Decision 4B and DeepSeek V4.1 Flash (1017)",
      },
      {
        tag: "improve",
        zh: "移除「书生·浦语」供应商，其模型已并入端砚，设置里不再出现该分组",
        en: "Removed the InternLM (Atria) provider — its model is now part of InkStone and the group no longer appears in settings",
      },
    ],
  },
  {
    date: "2026-10-11",
    title: { zh: "朗读不再念符号", en: "Read-aloud no longer reads symbols" },
    entries: [
      {
        tag: "fix",
        zh: "朗读不再把 emoji 念出来：新增专门的文本清洗，去掉表情、合体 emoji（👨‍👩‍👧）、肤色与旗帜修饰符、装饰符号，keycap 会整串去掉而不是只剩数字",
        en: "Read-aloud no longer speaks emoji out loud: a dedicated text cleaner strips emoji, joined sequences, skin-tone and flag modifiers and dingbats. Keycap sequences are removed whole instead of leaving a lone digit",
      },
      {
        tag: "improve",
        zh: "朗读改成分句排队：浏览器语音引擎念到约 15 秒会自行中断，长回答以前会念一半就没声。现在按句切成小段依次播放，并自动挑选匹配语言的语音",
        en: "Read-aloud now queues sentence-length chunks: browser speech engines cut off after roughly 15 seconds, so long answers used to stop midway. It now plays chunk by chunk and picks a voice matching the text language",
      },
      {
        tag: "improve",
        zh: "朗读前还会清掉 markdown 标记、表格分隔行、引用标号、HTML 实体与链接地址 —— 链接只提示「链接已省略」，代码整段跳过",
        en: "Markdown markers, table separators, citation numbers, HTML entities and URLs are stripped before speaking. Links are announced as omitted, and code blocks are skipped entirely",
      },
    ],
  },
  {
    date: "2026-10-11",
    title: { zh: "品牌换成 Pot & 过渡动画修正", en: "Pot branding & transition fix" },
    entries: [
      {
        tag: "improve",
        zh: "站名统一为 Pot：输入框提示语、欢迎语、两步验证发行方、Passkey 站点名、证书 PDF 全部改掉，不再出现旧名称",
        en: "The site is now consistently called Pot: input placeholders, greeting, 2FA issuer, Passkey relying-party name and the certificate PDF no longer show the old name",
      },
      {
        tag: "fix",
        zh: "品牌图真正做了去背：之前那版只是加了个圆角，白色底仍整块留在图上，深色界面里是一张白卡片。现在按洪水填充重抠，白色「脸」保留、外框白底去掉",
        en: "The brand image is now properly cut out. The previous version only rounded the corners and kept the whole white background, so it showed up as a white card on dark surfaces. It is now re-masked with flood fill: the white face stays, the outer white is gone",
      },
      {
        tag: "fix",
        zh: "过渡动画的纸飞机不再压到文字上：终点从航迹容器的 108% 收到 62%，机身右缘留在容器内，与文字留出 42px 间距",
        en: "The paper plane no longer overlaps the text during page transitions: it now stops at 62% of the trail container instead of 108%, leaving a 42px gap before the label",
      },
      {
        tag: "improve",
        zh: "纸飞机改成只飞一趟并停在航线末端后轻微起伏，不再无限循环 —— 之前遮罩停留时间短于一趟飞行，每次收起时飞机停在哪全看运气",
        en: "The paper plane now flies once and rests at the end of the trail with a gentle bob, instead of looping forever — the overlay used to close mid-flight, so where the plane stopped was pure luck",
      },
      {
        tag: "new",
        zh: "朗读可以自己挑语音了：设置里新增卡片，列出设备上所有可用语音，可当场试听，并能调节语速与音调（记在本机，换设备需重设）",
        en: "You can now pick the read-aloud voice: a new settings card lists every voice on the device with instant preview, plus speed and pitch sliders (stored locally, so it resets on a new device)",
      },
      {
        tag: "fix",
        zh: "朗读不再默认用设备里最老的语音：之前只按语言取第一个匹配到的，那几乎总是年代最久、最机械的合成器。现在按质量打分排序，优先自然语音（Siri / Neural / Enhanced / Premium），并避开 eSpeak 这类机械引擎",
        en: "Read-aloud no longer defaults to the oldest voice on the device. It used to take the first voice matching the language, which was almost always the oldest and most robotic synth. Voices are now scored: natural ones (Siri / Neural / Enhanced / Premium) rank first and robotic engines like eSpeak are pushed to the bottom",
      },
    ],
  },
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
      {
        tag: "new",
        zh: "GitHub 登录支持多域名：管理员面板可以按域名各填一套 OAuth App，站点用 chat.xyz.ci、pot-ai.cc.cd 等多个域名时，各自走自己的 App，互不串号",
        en: "GitHub sign-in now supports multiple domains: admins can register one OAuth App per domain, so a site reachable on chat.xyz.ci and pot-ai.cc.cd uses its own app on each",
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
