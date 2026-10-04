# AI 免費聊天站

> **免费 AI 聊天站** —— 站长把自己的 Key 和 Base URL 配进环境变量，
> 访客打开就能直接聊，不用自己申请 Key。当然也可以自带 Key。

由 **wcvjk8tnz8** 创作 · 上游迁移自 `AlotofSkymoon/agnes-chat`（原 Agnes AI 免费聊天）

---

## 📌 这个项目是什么？

如果你拿到某家的额度想给别人用（或者自己搭建一个面向访客的聊天入口），
需要一个**开箱即用的免费聊天站**：访客打开网页就能聊天，
不用去申请 Key、不用填 Base URL。

**本项目就是这样一个聊天站**，开箱即用：

| 角色 | 体验 |
|---|---|
| **访客** | 打开 → 直接聊，零配置 |
| **想用自己的额度** | 设置里填自己的 Key / Base URL（可关掉此权限） |
| **站长** | 环境变量配一次，全站生效，密钥不下发浏览器 |

默认品牌是 **Agnes AI**（`apihub.agnes-ai.com/v1`），
改环境变量就能换成任意 OpenAI 兼容服务 —— DeepSeek、Kimi、智谱、自建 One API / New API 都行。

**功能范围**：

- 纯文本聊天 + 图片/视频识别（需 vision 模型）
- **多对话管理**：可新建、切换、删除，也能**手动重命名**（双击侧边栏条目或点铅笔图标）
- **思考模式**：支持思考的模型会先输出推理过程，再给答案（可折叠）
- **联网搜索**：输入框「联网」开关，先搜再答并在回答下方列出来源
- **🖥️ 云电脑**：浏览器里跑的迷你桌面环境（终端 / 记事本 / 计算器 / 时钟 / 关于本机），
  窗口可拖动、最小化，数据全在本地，不联网不上传
- 用户系统（注册/登录/管理员面板）
- **Aceternity UI 风格视觉效果**：极光背景、聚光灯跟随卡片、3D 倾斜、旋转流光边框、光柱
- 文件上传（需先配置对象存储，见下）

不做 Agent、工具调用、代码执行。

---

## ⚖️ 许可与授权（部署前必读）

| | 说明 |
|---|---|
| **源代码** | MIT 许可，可自由阅读、学习、修改、提交 PR |
| **公开部署** | ⚠️ **需先取得作者 wcvjk8tnz8 书面许可** |
| **署名** | 公开副本必须保留创作者与上游来源标注 |

源码开源 ≠ 可以随便部署。原因很简单：站点内置的中转额度由站长买单，
无门槛克隆会导致额度盗刷和品牌冒用。完整条款见 [LICENSE](./LICENSE)。

**申请授权**：在仓库提 Issue，说明用途、域名、托管平台即可。
自用性质的小规模部署通常会获批。

---

## 🚀 部署（不会代码也能做）

存储与对象存储后端会**按部署平台自动识别**：
在 Cloudflare 上走 KV + D1 + R2，在 Vercel / Netlify 上走 Upstash + B2。

| | ⭐ Cloudflare Workers（推荐） | Netlify（拖 ZIP） | Vercel（不推荐） |
|---|---|---|---|
| 数据库 | KV + D1，**自带免费额度，不用额外注册** | 需另注册 Upstash Redis | 需另注册 Upstash Redis |
| 对象存储 | R2，**零出站流量费**（图片视频外链不花钱） | Backblaze B2 / Supabase | Backblaze B2 / Supabase |
| 上手难度 | 中（要配三件套） | **低**（拖文件夹即可） | 低 |
| 连 Git 仓库 | 需要 | 可选（拖 zip 则无需） | 需要 |
| 费用 | 免费额度充裕 | 免费额度够用 | 免费额度较紧 |

> 想最省事：**Netlify 拖 ZIP**。
> 想长期稳定、额度大：**Cloudflare Workers**。
> Vercel 也能跑，只是要额外配 Redis，且对象存储只能用 B2。

---

### 方式一：Cloudflare Workers + GitHub Actions（需 API 令牌）

> 不想配令牌？直接看[界面部署](https://github.com/AlotofSkymoon/agnes-chat/blob/main/Cloudflare部署教程.md#方式二cloudflare-界面部署workers-builds)，更省事。

#### 1. 准备 Cloudflare 三件套

在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 创建：

```bash
# KV 命名空间（存 session、限流、缓存）
npx wrangler kv namespace create agnes-chat-kv

# D1 数据库（存用户）
npx wrangler d1 create agnes-chat-db

# R2 桶（存图片/视频，可选但推荐）
npx wrangler r2 bucket create agnes-chat
```

记下返回的 **KV Namespace ID** 和 **D1 Database ID**。

#### 2. 获取 API Token

Dashboard → 我的个人资料 → API 令牌 → 创建令牌 → 使用「编辑 Cloudflare Workers」模板。

需要的权限（手动创建时逐条勾）：

| 层级 | 权限项 | 级别 |
|---|---|---|
| 账户 | Workers 脚本 / Workers KV 存储 / D1 / Workers R2 存储 | 编辑 |
| 用户 | **User Details** | 读取 |
| 用户 | **Memberships** | 读取 |

> ⚠️ 后两个「用户」层级权限极易漏勾，漏了会报
> `Authentication error [code: 10000]`。可用 `npx wrangler whoami` 本地验证。

同时记下 **账户 ID**（Dashboard 右侧栏）。

#### 3. 配置 GitHub Secrets

仓库 → Settings → Secrets and variables → Actions → New repository secret：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第 2 步的 API 令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `KV_NAMESPACE_ID` | 第 1 步的 KV ID |
| `D1_DATABASE_ID` | 第 1 步的 D1 ID |
| `SESSION_SECRET` | `openssl rand -base64 32` 生成 |
| `PRESET_AGNES_API_KEY` | 站点内置 Key（见 `.env.example`） |
| `R2_ACCOUNT_ID` | R2 账户 ID（可选） |
| `R2_ACCESS_KEY_ID` | R2 令牌 Access Key（可选） |
| `R2_SECRET_ACCESS_KEY` | R2 令牌 Secret（可选） |
| `R2_BUCKET` | 桶名，如 `agnes-chat`（可选） |
| `R2_PUBLIC_BASE_URL` | 公开域名，如 `https://pub-xxx.r2.dev`（可选） |

#### 4. 推送代码

工作流已经在 `.github/workflows/deploy-cloudflare.yml`，推到 `main` 即自动触发：

1. 校验必需 Secrets（缺哪个会直接告诉你，不用等构建完）
2. 自动查找/创建 KV、D1、R2，并把 ID 写回配置（**你不用手填**）
3. 执行 `schema.sql` 建表（幂等，已存在不会重复建）
4. 确保 R2 桶存在（未开通则跳过，不影响其余功能）
5. OpenNext 构建 + `wrangler deploy`
6. 用 `wrangler secret put` 写入密钥（**不会进仓库**）

> ⚠️ 密钥一律走 `wrangler secret put`，**不要**写进 `wrangler.jsonc`——那个文件会提交到仓库。

#### 5. 首个用户

注册第一个账号 → 自动成为管理员 → 侧边栏盾牌图标进 `/admin`。

---

### 方式二：Cloudflare 界面部署（Workers Builds，⭐ 小白推荐）

**不用创建 API 令牌** —— Cloudflare 会自动为你的账户生成凭证，
绕开方式一里最容易踩的「令牌权限不足」坑。

1. Cloudflare 后台先建好三个资源（各点几下就行，**不用复制任何 ID**）：
   - **Workers 和 Pages → KV** → 创建命名空间 → 名字随便（如 `agnes-chat-kv`）
   - **Workers 和 Pages → D1** → 创建数据库 → 名字随便（如 `agnes-chat-db`）
   - **存储和数据库 → R2** → 创建存储桶 → 名字随便（如 `agnes-chat`）
2. Cloudflare 后台 → **Workers 和 Pages** → **创建** → **连接到 Git**
   → 选本仓库 → 构建命令填 **`npm run cf:build`**
   → 部署命令填 **`npx wrangler deploy -c wrangler.dashboard.jsonc`** → 保存并部署
3. 部署完成后，Worker → **设置 → 绑定 → 添加**，把三个资源挂上去：

   | 类型 | 变量名 |
   |---|---|
   | KV 命名空间 | `KV` |
   | D1 数据库 | `DB` |
   | R2 存储桶 | `R2` |

   （小写 `kv` / `db` / `r2` 也能识别）
4. 同页切到 **变量和机密**，添加两个加密变量：
   - `PRESET_AGNES_API_KEY` = 站点内置 Key
   - `SESSION_SECRET` = `openssl rand -base64 32` 生成的随机串
5. **重新部署一次**让绑定和密钥生效

之后每次推 `main` 都会自动重新部署。

> 💡 **全程不用改任何配置文件。** KV / D1 / R2 的 ID 一律在后台绑定页点选，
> 不用手抄 32 位十六进制串；**D1 表也不用手动建** ——
> 首次访问时会自动执行 `CREATE TABLE IF NOT EXISTS`（幂等，重复无害）。

> ⚠️ 不要同时启用方式一的自动部署和方式二，否则一次推送会部署两遍。
> 详细图解见 [Cloudflare部署教程.md](./Cloudflare部署教程.md) 的「方式二」。

---

### 方式三：Vercel（不推荐，但仍可用）

1. [Upstash](https://console.upstash.com/redis) 创建 Redis —— **注册信息、登录态都存这里**，
   复制 **REST URL** 和 **REST TOKEN**（⚠️ 一定是带 `REST` 字样的两个值）
2. Vercel → Add New → Project → Import 本仓库（框架自动识别 Next.js）
3. 填环境变量：

| Key | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |
| `SESSION_SECRET` | 任意长随机串 |
| `PRESET_AGNES_API_KEY` | 站点内置 Key |
| `B2_REGION` / `B2_ACCESS_KEY_ID` / `B2_SECRET_ACCESS_KEY` / `B2_BUCKET` | 对象存储（可选） |

4. Deploy。Vercel 上**不要**填 `R2_*`（不会被读取）。

> 改了环境变量后必须 Redeploy 才生效。

---

### 方式四：Netlify（拖 ZIP，最省事）

和 Vercel 一样走 Node.js 运行时 + Upstash Redis，但**不用连 Git 仓库**，
把源码拖上去就行。

1. 准备 Upstash Redis（同方式三第 1 步）
2. 在 GitHub 仓库页下载源码：`Code` → `Download ZIP`，解压得到文件夹
3. 打开 https://app.netlify.com/drop ，**把整个文件夹拖进去**
4. 部署完成后：Site configuration → **Environment variables**，填：

| Key | Value |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |
| `SESSION_SECRET` | 任意长随机串 |
| `PRESET_AGNES_API_KEY` | 站点内置 Key |

5. **再触发一次部署**（改环境变量后必须重新构建才生效）：
   Deploys → `Trigger deploy` → `Deploy site`

> Netlify 上不填 `R2_*` / `CLOUDFLARE_*`，不会被读取。
> 需要对象存储就用 `B2_*` 那组（Backblaze B2）。
>
> 首次部署可能会失败一次并显示「No Cache Detected」——
> 那是 Next.js 提示没配构建缓存，不影响成败，忽略即可。

> ⚠️ 拖拽部署不会随仓库更新自动同步。
> 想持续更新，改成在 Netlify 里 `Import from Git` 连仓库即可。

---

## 🔁 自动部署与自动更新

### 推送即部署

`.github/workflows/deploy-cloudflare.yml` 在推送到 `main` 时自动触发
（只改 `*.md` 不触发），也可以手动 Run workflow。

同时启用了 Cloudflare 界面部署的话，一次推送会部署两遍、互相覆盖。
在仓库 **Variables** 里加 `AUTO_DEPLOY=false` 即可关掉自动触发，
保留手动运行。

### 自动同步上游

`.github/workflows/sync-upstream.yml` 每天检查一次上游更新，
有则**创建 Pull Request**（不直接覆盖，避免弄丢你的改动）。
也可以手动触发。

无冲突且构建通过 → 直接合并 PR 即可。

---

## 🔄 多平台数据同步

**默认就是统一的**：只要配了 Upstash，无论部署到 Vercel / Netlify / Cloudflare，
都连**同一个库**，账号、聊天记录、站点配置全部互通。

```bash
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx
```

填完这两个，多平台同步就生效了 —— 不需要额外开关。

`STORAGE_BACKEND` 只在你想**改变**这个默认行为时才需要：

| 取值 | 行为 |
|---|---|
| `auto`（默认） | **有 Upstash 就统一用 Upstash**（数据互通）；没配才退回平台原生 |
| `unified` | 强制 Upstash，缺配置直接报错（不会静默退回本地） |
| `cloudflare` | 强制 KV + D1（单平台部署、不想跨网络回源时用） |
| `upstash` | 强制 Upstash |

**为什么统一后端比双写同步好**：双写要处理冲突、重试、乱序到达、
部分失败……是这类需求里最容易埋雷的做法。统一后端让所有平台读写同一份数据，
天然一致，代码也简单得多。

代价：Cloudflare 上要跨网络回源到 Upstash，比原生 KV 略慢。
只部署一个平台时用 `auto` 即可。

> ⚠️ 选 `unified` 时 `UPSTASH_REDIS_REST_URL` / `TOKEN` **必填**，
> 缺了会直接启动报错（而不是悄悄退回本地存储，那样更难排查）。

### 怎么验证两个站真的共用同一份数据

分别访问两个站的 `/api/health`，比对 `storage.storageFingerprint`：

```bash
curl https://站A/api/health | grep storageFingerprint
curl https://站B/api/health | grep storageFingerprint
```

| 结果 | 含义 |
|---|---|
| 两值**相同** | ✅ 同一份数据，账号 / 聊天记录 / 站点配置互通 |
| 两值**不同** | ❌ 各存各的，换个域名记录就没了 |

指纹的原理：首次访问时往库里种一个随机串，后续同库的其他平台会读到同一个值。

**聊天记录的 key 是 `chat:{userId}:{conversationId}`** —— 不含任何平台标识，
所以只要指向同一个库，A 站发的消息在 B 站一定看得到。

---

## 🔑 Cloudflare 令牌识别不到怎么办

**先确认一件事：如果用 R2 binding（推荐方式），你根本不需要 API 令牌。**

binding 的权限来自 Worker 本身，不走 API。令牌只在「自动查找账户 ID / 桶名」时才用得上。
所以如果你只是想让上传能用，绑好 `r2_buckets` 就够了，令牌配不配无所谓。

真需要令牌时（比如自动发现桶），识别不到通常是下面四种原因：

| 原因 | 现象 | 处理 |
|---|---|---|
| **Workers 上 `process.env` 读不到 secret** | 本地好使，部署后失效 | 用 `wrangler secret put CLOUDFLARE_API_TOKEN` 写入；代码会同时去 binding 里找 |
| **变量名不一致** | 一直报"缺少令牌" | 已兼容 `CLOUDFLARE_API_TOKEN` / `CF_API_TOKEN` / `R2_API_TOKEN` / `CLOUDFLARE_TOKEN` / `CF_TOKEN` |
| **粘贴混入换行或引号** | 401，但令牌看着没错 | 已自动 trim 并去掉误粘的引号；请求前会校验是否残留空白 |
| **填成了 Global API Key** | 401 | Global Key 是 **37 位**，API Token 是 **40 位**，前者不能单独用于 Bearer 鉴权 |

**排查方式**：管理员访问 `/api/diagnose`，看 `cloudflareCredentials` 字段：

```jsonc
{
  "token": {
    "present": true,
    "key": "CLOUDFLARE_API_TOKEN",   // 实际命中的变量名
    "from": "cf-binding",            // process.env 还是 Worker binding
    "masked": "abcd************wxyz", // 脱敏，只给前4后4
    "ok": true,
    "hint": ""
  }
}
```

`present: false` → 完全没读到，检查变量名和部署方式。
`present: true` 但 `ok: false` → 读到了但形态不对，看 `hint`。

> ⚠️ 用 `wrangler secret put` 写入的是 **binding 而非 process.env**，
> OpenNext 各版本对 `process.env` 的垫片行为不一致 —— 这是部署后"突然读不到"的主因。

---

## 🎬 视频播放（含 WMV / MPG）

浏览器原生只支持 **mp4 / webm / ogg** 三种容器。
`wmv`、`mpg`、`mpg2`、`avi`、`flv`、`rmvb` 这些**一律放不了**——
不是 bug，是浏览器根本没内置对应解码器。

解决办法是把 **ffmpeg 编译成 wasm 在浏览器里现场转码成 mp4**，
即"解码器内嵌"：解码在客户端完成，服务端只存原文件，
既不烧服务器 CPU，也不用把原片传出去。

| 格式 | 播放方式 |
|---|---|
| mp4 / m4v / webm / ogv / ogg | **直接播** |
| wmv / asf / avi / mpg / mpeg / mpg1 / mpg2 / m1v / m2v / ts / vob / flv / rmvb / mov / mkv / 3gp | 点「解码并播放」→ 内置解码器转 MP4 |

转码参数：`libx264` + `ultrafast` + `+faststart`（可边下边播）+ `aac` 音轨。

> ⚠️ ffmpeg.wasm 核心约 25~32MB，**不打包进项目** ——
> 否则 Cloudflare Workers（免费版脚本上限 1 MiB）会直接部署失败。
> 改成首次点播放时才从 CDN 按需加载，不用不下载。

---

## 🎭 五套界面风格

主题切换改的不是配色，而是**整套设计语言**：字体、圆角、阴影、间距密度、
卡片材质、背景处理全都不同。

| 风格 | 气质 | 字体 | 圆角 | 表面 |
|---|---|---|---|---|
| **Anthropic** | 纸感编辑排版，克制 | Inter（近似 Styrene B）+ Source Serif 4（近似 Tiempos） | 中等（控件 16px / 卡片 28px） | 几乎无阴影，发丝边框分层 |
| **Fuwari** | 极简卡片博客，清爽 | Montserrat + 昭源環方 | 偏大（卡片 36px） | 卡片有存在感，hover 轻抬 |
| **Violet Rose** | 紫粉柔光糖果，软 | Montserrat + 昭源環方 | 最大（卡片 28px） | 带紫色调的柔和扩散阴影 |
| **Sidefolio** | 侧栏工作台，冷峻 | Inter + Source Serif 4 | 偏小（卡片 12px） | 几乎无阴影，靠 1px 描边；深色下近纯黑 |
| **Minimalist** | 极简作品集，纸上排版 | Inter + Source Serif 4 | 最小（卡片 6px） | 无阴影，纯留白 + 发丝框；密度最宽松 |

### 后面两套是怎么来的

**Sidefolio** 参考 Aceternity 的同名作品集模板：侧边栏布局、现代克制，
层次靠 hover 的微交互而不是阴影。识别点是**中性灰阶 + 单一蓝紫强调色**，
深色下背景接近 `#0a0a0a`。想换强调色改 CSS 里 `--hue` 一个数即可（默认 258 蓝紫）。

**Minimalist** 参考极简作品集模板：纯白纸面、发丝描边、大留白，
标题用衬线做锚点。刻意把强调色做成**低饱和**（默认 hue 215 石板蓝）——
极简风里鲜艳的彩色只会破坏留白。圆角是五套里最小的：
大圆角在这套里会显得"没做完"。

> 两套都没引入 framer-motion。微交互用 CSS transition 就够，
> 为一个过渡拉进一整个动画库不值得（项目刚因为 peer 依赖冲突折腾过一轮）。

### Anthropic 风格的两个细节

**① AI 回复用衬线体**

Claude 最有辨识度的设计：**用户消息用无衬线、AI 回复用衬线**。
前者代表现代灵动的人，后者代表深沉权威的思考者。

原始字体是 Anthropic 定制的 Anthropic Sans / Anthropic Serif（基于
Commercial Type 的 Styrene B 和 Klim 的 Tiempos/Copernicus），**商业授权不能随项目分发**。
所以用了官方 fallback 栈的第一顺位：

| 用途 | Anthropic 原字体 | 本项目替代 | 授权 |
|---|---|---|---|
| 无衬线 | Anthropic Sans（Styrene B） | **Inter** | OFL |
| 衬线 | Anthropic Serif（Tiempos） | **Source Serif 4** | OFL |
| 中文 | — | 昭源環方 Chiron GoRound TC | OFL |

两者都是官方 fallback 栈里排在 `system-ui` 之前的第一个，观感最接近。

**② 标题统一 500 字重**

Claude 从不用粗体标题，全部衬线 + 500，像同一个作者写下来的。

### 圆角尺度

用户要"更圆"，所以整套 Tailwind 圆角量表放大了一档：

| 工具类 | 原来 | 现在 |
|---|---|---|
| `rounded-sm` | 0.125rem | **0.5rem** |
| `rounded-md` | 0.375rem | **1rem** |
| `rounded-lg` | 0.5rem | **1.25rem** |
| `rounded-xl` | 0.75rem | **1.5rem** |
| `rounded-2xl` | 1rem | **1.75rem** |
| `rounded-3xl` | 1.5rem | **2rem** |

改的是量表本身，所有 `rounded-*` 一次性生效，不用逐个组件改。

---

## 📋 环境变量速查（按平台分列）

三个平台用的存储后端不同，**变量不能混着填**。
下面按平台完整列出，照抄即可。

---

### 🟠 Cloudflare Workers

存储用 **KV + D1 + R2**，不需要 Redis。

**必须（GitHub Secrets / Workers 环境变量）**

| Key | 说明 |
|---|---|
| `SESSION_SECRET` | `openssl rand -base64 32` 生成 |
| `PRESET_AGNES_API_KEY` | 站点内置 Key |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL（**多平台同步必须**） |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |

### 📦 对象存储教程

| 部署平台 | 看这份 |
|---|---|
| **Cloudflare Workers** | [R2对象存储配置教程.md](./R2对象存储配置教程.md)（推荐 binding，零密钥） |
| **Vercel / Netlify** | [S3对象存储配置教程.md](./S3对象存储配置教程.md)（Backblaze B2 为主） |

`S3_*` 那组通用变量支持任何 S3 兼容服务：
AWS S3、MinIO 自建、阿里云 OSS、腾讯云 COS、七牛。

**Supabase** 有专用变量 `SUPABASE_*`，只填项目 ref + 密钥即可，
endpoint 和公开域名自动拼（它的公开域名格式特殊，手写容易漏 `public`）。
注意免费版单文件上限 50MB，且 S3 兼容层只接受 path-style（已自动处理）。

> ⚠️ **Supabase 必须自己建两条 Storage Policy，否则上传必失败。**
> 这是 Supabase 侧的 RLS（行级安全），站点调不了，只能你在后台点。
>
> 1. 桶设为 **Public**（Storage → bucket → 齿轮 → Public bucket）
> 2. Storage → Policies → `storage.objects` → New policy：
>    - **INSERT**（上传）：目标角色选 `anon`（或 `authenticated`，取决于站点走哪种）
>    - **SELECT**（公开读）：目标角色选 `anon`
>    - 条件可先用 `bucket_id = '<你的桶名>'` 放行全部，通了再收窄到某个文件夹
>
> 只建 SELECT 不建 INSERT 的话：签名能生成、URL 能拿到，
> 但浏览器 PUT 上去会被 RLS 挡回 403 —— 表现为"配置都对但就是传不上去"。
>
> 另外确认桶所在 **region**：Supabase 托管项目的 S3 兼容层按项目 region 校验签名，
> region 填错会报 `SignatureDoesNotMatch`，填 `SUPABASE_REGION` 覆盖（默认 `us-east-1`）。

**R2 对象存储 —— 推荐走 binding，零密钥**

`wrangler.jsonc` 里已经绑好了：

```jsonc
"r2_buckets": [{ "binding": "R2", "bucket_name": "agnes-chat" }]
```

**只要这个 binding 存在，就不需要任何 Access Key / Secret Key。**

R2 桶是你自己的，Worker 通过 binding 读写时，权限来自 binding 本身——
再生成一对 AK/SK 纯属多余。绑定后：

- 上传走 `/api/upload/direct`，文件经 Worker 落 R2
- 读取走 `/api/r2/<key>`，**桶不用开公开读**也能正常访问
- 前端会优先选这条路，预签名只在没有 binding 时才用

> ⚠️ 唯一约束：文件要过 Worker，受请求体上限（免费版 100MB）限制。
> 超大文件改用 `/api/upload/presign` 的预签名直传。

**用 S3 兼容 API 时才需要这些**（比如 Vercel 上远程访问 R2）

| Key | 说明 |
|---|---|
| `R2_BUCKET_NAME` | 桶名，如 `agnes-chat` |
| `CLOUDFLARE_API_TOKEN` | 用来按桶名反查账户 ID |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 的 S3 密钥 |
| `S3_ACCESS_HOST` | 自定义访问域名，如 `https://images.example.com` |
| `R2_ACCOUNT_ID` | 账户 ID（**一般不用填**，token 能反查） |

> 💡 **KV / D1 的 ID 不用手填。** Actions 会自动完成：
> 给了 ID 就直接用；没给就找同名的（`agnes-chat` / `agnes-chat-db`）；
> 都没有就自动创建。R2 同理，只要桶名。
> 省去复制 32 位十六进制串的麻烦，也不会因填错 ID 导致"部署成功但存不进去"。

**仅 Cloudflare 原生存储模式需要**（设了 `STORAGE_BACKEND=cloudflare` 时）

| Key | 说明 |
|---|---|
| `KV_NAMESPACE_ID` | KV 命名空间 ID |
| `D1_DATABASE_ID` | D1 数据库 ID |
| `JWT_SECRET` | 建表接口 `/api/d1/cshsjk/<token>` 用 |
| `CLOUDFLARE_ACCOUNT_ID` | 账户 ID（Actions 部署用） |

> ⚠️ 密钥走 `wrangler secret put`，别写进 `wrangler.jsonc`（会提交到仓库）。
> 💡 默认 `STORAGE_BACKEND=auto` 且配了 Upstash 时，**KV / D1 不会被用到**。

---

### 🔵 Vercel

存储用 **Upstash Redis**，对象存储只能用 **Backblaze B2**。

| Key | 说明 |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL（⚠️ 带 `REST` 字样那个） |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |
| `SESSION_SECRET` | 任意长随机串 |
| `PRESET_AGNES_API_KEY` | 站点内置 Key |
| `B2_REGION` | B2 区域（可选） |
| `B2_ACCESS_KEY_ID` | B2 Key ID（可选） |
| `B2_SECRET_ACCESS_KEY` | B2 Secret（可选） |
| `B2_BUCKET` | 桶名（可选） |

> ❌ **不要填** `R2_*` / `CLOUDFLARE_*` —— Vercel 上不读。

---

### 🟢 Netlify

和 Vercel **完全一样**（Node 运行时 + Upstash + B2）。

| Key | 说明 |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST TOKEN |
| `SESSION_SECRET` | 任意长随机串 |
| `PRESET_AGNES_API_KEY` | 站点内置 Key |
| `B2_*` | 对象存储（可选，同 Vercel） |

> ❌ **不要填** `R2_*` / `CLOUDFLARE_*`。

---

### ⚪ 三个平台通用（可选）

这些不管部署在哪都能用。

| Key | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SITE_NAME` | `Agnes AI` | 站点名 |
| `NEXT_PUBLIC_THEME` | `anthropic` | 配色：`anthropic` / `fuwari` / `violet-rose` / `sidefolio` / `minimalist` |
| `NEXT_PUBLIC_REQUIRE_LOGIN` | `false` | 设 `true` 则必须登录才能对话 |
| `NEXT_PUBLIC_ALLOW_WEB_SEARCH` | `true` | 设 `false` 关闭联网开关 |
| `NEXT_PUBLIC_ALLOW_CUSTOM_KEY` | `true` | 设 `false` 锁死只能用站长的 Key |
| `SERPER_API_KEY` | — | 联网搜索（⭐ 推荐，注册不用信用卡） |
| `TAVILY_API_KEY` | — | 联网搜索，专为 LLM 设计 |
| `BRAVE_API_KEY` | — | 联网搜索，独立索引 |
| `BOCHA_API_KEY` | — | 联网搜索，国内可用 |
| `EXA_API_KEY` | — | 联网搜索，语义检索 |

> 搜索源配了任一 Key 就优先用它；一个都不配则自动用免费的
> Bing RSS / Sogou / DuckDuckGo，零配置也能联网。

---

## 🎨 换成你自己的品牌（中转站必看）

默认整套品牌是 **Agnes AI**。想挂上你自己的中转服务，改环境变量即可，**不用动代码**。

### 基础品牌

| 变量 | 默认值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SITE_NAME` | `Agnes AI` | 站点名，出现在标题栏、侧边栏、页脚 |
| `NEXT_PUBLIC_SITE_TAGLINE` | `免费聊天` | 副标题，跟在站点名后面 |
| `NEXT_PUBLIC_SITE_DESCRIPTION` | 自动拼接 | SEO 描述 |
| `NEXT_PUBLIC_THEME` | `anthropic` | 界面风格：`anthropic` / `fuwari` / `violet-rose` / `sidefolio` / `minimalist` |
| `NEXT_PUBLIC_AUTHOR_NAME` | `wcvjk8tnz8` | 页脚创作者署名 |
| `NEXT_PUBLIC_SHOW_SOURCE_LINKS` | `false` | 设 `true` 才在页脚/赞助页显示源码与上游仓库链接（**默认不显示，避免暴露 GitHub 账号**） |
| `NEXT_PUBLIC_REPO_URL` | 本仓库 | 页脚源码链接 |
| `NEXT_PUBLIC_UPSTREAM_URL` | 上游仓库 | 页脚上游标注 |

> 两套配色访客都能在「设置 → 配色主题」里随时切换，
> `NEXT_PUBLIC_THEME` 只决定**首次打开**用哪套。

### 换成别的中转服务

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PRESET_AGNES_API_KEY` | Agnes 内置 Key | 站长提供的 Key，访客不填时用这个 |
| `UPSTREAM_BASE_URL` | `https://apihub.agnes-ai.com/v1` | 中转地址 |
| `UPSTREAM_MODEL` | `agnes-3.0-flash` | 默认模型 |
| `NEXT_PUBLIC_ALLOW_CUSTOM_KEY` | `true` | 设 `false` 锁死：访客只能用站长的 Key |
| `NEXT_PUBLIC_REQUIRE_LOGIN` | `false` | 设 `true` 则必须登录才能对话 |
| `NEXT_PUBLIC_ALLOW_WEB_SEARCH` | `true` | 设 `false` 关闭联网搜索功能 |
| `JWT_SECRET` | 无 | D1 初始化接口的签名密钥，界面部署时用它生成建表令牌 |
| `CLOUDFLARE_API_TOKEN` | 无 | 选填，配了就能自动寻找 R2 桶（`agnes-chat` / `agnes-chat-r2`） |
| `NEXT_PUBLIC_ALLOW_CUSTOM_BASE_URL` | `true` | 设 `false` 锁死 Base URL |

> 💡 只要服务兼容 OpenAI 的 `/chat/completions` 就能直接套用。
> One API / New API / VoAPI 这类自建聚合站同样支持。

### 两种运营玩法

**A. 站长全包（推荐）**
配好 `PRESET_AGNES_API_KEY` + `UPSTREAM_BASE_URL`，再把
`NEXT_PUBLIC_ALLOW_CUSTOM_KEY` 设成 `false`。
访客打开就能聊，看不到也改不了任何 Key 配置。

**B. 自带 Key（开放）**
用默认值即可。访客可以在设置里填自己的 Key 和 Base URL，
不填就用站长内置的。适合小圈子共享。

---

## 本地运行

```bash
npm install
cp .env.example .env.local   # 本地可留空 Upstash，仍能聊天
npm run dev
```

打开 http://localhost:3000

未配置存储后端时也能直接聊天（用站点内置 Key），只是不能注册/登录。

**Workers 本地预览**：

```bash
npm run cf:build && npx wrangler dev
```

---

## 💛 赞助与支持

本项目永久免费、无广告、不采集隐私。

服务器、域名、API 额度用的都是**免费额度**，站长本人不担心这块。
站长是名学生，赞助会直接变成他的**生活经费与日常购物基金** ——
如果你愿意请他喝杯咖啡，可以访问 `/sponsor`。

### 放上你自己的收款码

**默认已经内置两个渠道**，访客按所在地挑一个扫：

| 渠道 | 图片文件 | 适用 |
|---|---|---|
| 支付宝 | `public/sponsor-alipay.png` | 内地用户 |
| AlipayHK | `public/sponsor-qr.png` | 香港用户 |

> 只放一个的话，另一边的用户根本扫不了 —— 所以建议两个都留着。

**方式一：替换文件（最简单）**

把你的收款码图片存成上面两个文件名，覆盖仓库里的图即可。
只想放一个渠道，就只替换其中一个 —— 另一个会自动隐藏（图片加载不出来时不显示破图）。

**方式二：用外链**

```bash
NEXT_PUBLIC_SPONSOR_QR=https://你的图床/alipayhk.png
```

> ⚠️ 别用会过期的临时链接，二维码一旦失效赞助入口就废了。

### 可配置的项

| 变量 | 默认 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SPONSOR_ENABLED` | `true` | 设 `false` 关闭赞助页（页面返回 404，侧边栏入口也隐藏） |
| `NEXT_PUBLIC_SPONSOR_QR` | `/sponsor-qr.png` | 二维码图片地址，也支持外链（填了就只显示这一个渠道） |
| `NEXT_PUBLIC_SPONSOR_CHANNELS` | 内置两个 | JSON 数组，完全自定义渠道，如 `[{"name":"微信支付","qr":"https://...","note":"..."}]` |
| `NEXT_PUBLIC_SPONSOR_METHOD` | `AlipayHK` | 显示在二维码上方的收款方式名 |
| `NEXT_PUBLIC_SPONSOR_NOTE` | 一句说明 | 二维码下方的说明文字 |

### 没放图片会怎样

页面**不会显示破图**。加载失败时会切成一张说明卡：

- 访客看到：「收款码暂未配置」
- 站长看到：该把图片放哪、该配哪个环境变量

所以即使先部署、后补图，页面也不会难看。

---

## 📜 自定义页脚与备案

**推荐在管理员面板里填**：`/admin` → 站点配置 → 页脚与备案。
填完保存即生效，**不用改环境变量、不用重新部署**。

| 字段 | 说明 |
|---|---|
| 备案号 | 如 `京ICP备12345678号-1` / `萌ICP备2026xxxxx号`。留空不显示 |
| 备案链接 | 留空时自动指向工信部备案查询系统 |
| 备案徽章图片地址 | 第三方备案（icp.gov.moe / icp.sakura.ink）给的图标链接 |
| 页脚额外文字 | 版权声明、联系方式、免责说明等 |

**第三方备案填法（以萌备案为例）**

萌备案给你的是一整段 `<a>` 标签，**直接粘进「备案号」输入框即可**，会自动拆出链接和文字：

```html
<a href="https://icp.gov.moe/?keyword=20260645" target="_blank">萌ICP备20260645号</a>
```

粘贴后自动变成：

| 字段 | 值 |
|---|---|
| 备案号 | `萌ICP备20260645号` |
| 备案链接 | `https://icp.gov.moe/?keyword=20260645` |

> 粘裸链接（只有 URL）也能识别，会自动填进链接框、文字留给你自己补。

> ⚠️ 徽章是外链图片，对方域名失效时**会自动隐藏**，不会留破图。

### 也可以用环境变量（当初始值）

想在部署时就定好、或还没建管理员账号时，可用环境变量：

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_ICP_TEXT` | 备案号 |
| `NEXT_PUBLIC_ICP_URL` | 备案链接 |
| `NEXT_PUBLIC_ICP_ICON_URL` | 徽章图片 |
| `NEXT_PUBLIC_FOOTER_EXTRA` | 额外文字 |

**优先级**：管理员面板存的值 > 环境变量 > 空。
面板里留空并保存，会用环境变量的值补上；想彻底清空就把环境变量也去掉。

---

## ☁️ 换浏览器后聊天记录不见了？

**原因**：云端只写不读。以前发送时会把记录存进 Redis，但从没有人去取回来 ——
换浏览器 / 换设备后本地是空的，看起来像数据丢了。

**现在的行为**：登录 + 开启「云端保存」后，会自动从云端拉取合并。

合并规则（谁的更新时间新听谁的）：

| 情况 | 结果 |
|---|---|
| 本地有、云端没有 | 保留本地 |
| 云端有、本地没有 | 拉下来 |
| 两边都有 | 取较新的一份 |

> ⚠️ 前提是**登录且开启了云端保存**。免登录访客的记录只存在当前浏览器，
> 这是浏览器本地存储的性质，不是 bug —— 清缓存或换设备都会没。

---

## 🧪 书生·端砚（Intern InkStone，可选）

[书生·端砚](https://discovery.intern-ai.org.cn/) 是上海 AI 实验室的科研模型平台，
聚合了 DeepSeek / GLM / Kimi / MiniMax / Qwen / 书生 等多个系列，走**墨点**计费。

项目已内置这个服务商，设置里选中后填自己的 Key 即可用。

### 两步配好

**1. 拿 Key**

登录 [discovery.intern-ai.org.cn](https://discovery.intern-ai.org.cn/)，在个人中心创建 API Key。

**2. 填进设置**

站点右上 ⚙️ → **服务商 → 书生·端砚** → 粘贴 Key → 保存。
Key 只存在浏览器本地（开了云端同步才加密上传）。

Base URL 已预置为 `https://discovery-api.intern-ai.org.cn/v1`，一般不用改。

> ⚠️ **别填成 `https://discovery-api.intern-ai.org.cn`（不带 `/v1`）** ——
> 那个是平台的 **Anthropic 协议**入口，本项目走 OpenAI 兼容协议，
> 填错的表现是所有请求 404。

### 内置模型

| 模型 ID | 说明 | 识图 |
|---|---|---|
| `intern-s2` | 书生 S2，397B 科学多模态 | ✅ |
| `atria-dawn-preview` | Atria Dawn，512K 科学推理 | ❌ |
| `agents-a1` | Agents A1，多模态 Agent | ✅ |
| `deepseek-v4-flash-0731` | DeepSeek V4 Flash，1M 上下文 | ❌ |
| `deepseek-v4-flash-vision` | DeepSeek V4 Flash，1M 上下文 | ✅ |
| `deepseek-v4-pro-0813` | DeepSeek V4 Pro，1M 上下文 | ❌ |
| `glm-5.3` | GLM 5.3，1M 上下文，始终深度推理 | ❌ |
| `kimi-k2.6` | Kimi K2.6，1M 上下文 | ❌ |
| `minimax-m3` | MiniMax M3，1M 上下文 | ❌ |
| `qwen3.8-27b` | Qwen3.8 27B，轻量通用 | ❌ |

**墨点**：每月免费额度 10 墨点（按月恢复）。`intern-s2` / `atria-dawn-preview` /
`agents-a1` 三款限时 0 墨点；`glm-5.3`、`kimi-k2.6` 输出百万 Token 分别约 28 / 27 墨点。
具体以平台公告为准。

**限流**：约 50 次/分钟、2M Token/分钟，超限会返回 429（项目已内置一次自动重试）。

### 模型 ID 对不上怎么办

上表的 ID 是**小写 slug 形式**。平台偶尔会用驼峰或其他写法，
如果选了模型却提示「模型不存在」，用设置里的**探测**按钮：

设置 → 书生·端砚 → 填好 Key 后点**探测**，会从 `/v1/models` 拉回平台当前的真实 ID 列表，
选一个填进模型名即可。

> 探测不要求 Key 一定有效（部分中转站的 `/v1/models` 是公开的），
> 但端砚这边未带 Key 会返回 403，所以**先填 Key 再探测**。

### 关于思考模式

GLM 5.3 这类原生推理模型会直接返回 `reasoning_content`，
前端按同一字段渲染成可折叠的思考过程，**不需要开开关**。

项目刻意**不对端砚发送** `chat_template_kwargs` 这类扩展字段 ——
那是 Agnes 的私有扩展，端砚不一定认，多发一个字段就多一份报错风险。

---

## 🔐 自带 API Key 的同步与免责

### 跨站点同步

在 A 站（或 A 浏览器）填的 API Key、Base URL、自定义供应商、模型、对象存储配置，
登录后会同步到 B 站 —— 不用重复填。

**前提**：登录 + 开启「保存聊天记录到云端」。

**同步范围**：`keys` / `baseUrls` / `customProviders` / `model` / `s3`

> 思考模式、联网开关这类即时开关**不同步** ——
> 否则多设备之间会互相打架（这边开了那边被关掉）。

### 存储安全

API Key 属于敏感信息，**服务端用 AES-256-GCM 加密后入库，明文不落盘**。

| 项 | 说明 |
|---|---|
| 算法 | AES-256-GCM（带认证标签，防篡改） |
| 密钥来源 | `USER_SETTINGS_SECRET` > `SESSION_SECRET` > `JWT_SECRET` |
| 字段白名单 | 只存指定字段，防止客户端塞任意数据 |
| 体积上限 | 64 KB |

> ⚠️ **这不是零知识加密**：服务端密钥泄露，密文仍可被解出。
> 真正的零知识需要用户口令 + 客户端加密，代价是无法跨设备免密恢复。
> 这里取的是「跨设备同步」与「存储侧不明文」的平衡点。

**建议**：单独设一个 `USER_SETTINGS_SECRET`，与其他用途的密钥分开。

### 免责声明

设置面板填写 Key 的位置会展示免责声明，要点：

- Key 仅用于代用户向对应服务商发起请求
- 开启云端保存后加密存储，用于跨设备同步
- **Key 由用户自行保管；因分享账号、使用公共设备等导致泄露或被盗用，费用由用户自行承担**
- 建议使用额度受限的子密钥，并定期轮换

---

## 📧 注册邮箱验证（Resend，可选）

注册时发一封 6 位验证码到用户邮箱，验证通过才算注册成功。

**用户侧流程**：注册页填邮箱 → 点「发送验证码」→ 邮箱收到 6 位码 →
填进验证码框 → 点「注册」即完成并自动登录。
验证码区域只在**服务端确实配好了 Resend** 时才出现，没配就不显示，不会有点了必然失败的按钮。

**不配也能用**：没填 Key 时注册会**跳过验证**直接放行，站点照常可用。
这是刻意的 fail-open —— 否则站长忘了配邮件服务，所有新用户都注册不了。

### 三步配好

**1. 拿 API Key**

去 [resend.com/api-keys](https://resend.com/api-keys) 注册并创建一个 Key。
免费额度 3,000 封/月、每天 100 封，个人站够用。

**2. 验证发件域名**

Resend 后台 → Domains → 添加你的域名 → 按提示加两条 DNS 记录（SPF / DKIM）。

> ⚠️ 免费用户**不验证域名只能发到你自己注册邮箱**，别人收不到。
> 这一步最容易漏，漏了的表现是"注册时收不到邮件，但站点没报错"。
>
> 赶时间可以用 `onboarding@resend.dev` 这个 Resend 提供的测试发件地址，
> 但同样只能发给你自己，仅适合自测。

**3. 填两个变量**

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM=Agnes AI <onboarding@yourdomain.com>
```

`RESEND_FROM` 支持 `名字 <地址>` 和纯地址两种写法，域名必须已在 Resend 验证过。

### 按部署方式填在哪

| 部署方式 | 填在哪 | 备注 |
|---|---|---|
| **Actions** | Settings → Secrets → Actions | 脚本已自动注入，改完推送一次即可 |
| **界面部署** | Workers → 设置 → 变量和机密 | 类型选「机密」，**改完要重新部署** |
| **Vercel** | 项目 → Settings → Environment Variables | 改完 Redeploy |

> ⚠️ Actions 部署时，**填在 GitHub Secrets 但没被脚本注入的话运行时读不到**，
> 表现是"配了邮箱验证，但注册从来不发信"。
> `RESEND_API_KEY` / `RESEND_FROM` 已在注入列表里（`scripts/prepare-deploy.mjs` 的 `SECRET_VARS`），
> 正常推送即可生效。

### 其他行为

- 验证码 **30 分钟**有效
- 重发有 **60 秒**冷却，防刷
- **发信失败时放行并提示**：账号会被标记为已验证、直接登录，页面提示
  「注册成功（邮件服务暂不可用，已直接放行）」。
  这是刻意的 —— 邮件服务故障不该变成用户的注册障碍；
  但反过来说，**配了 Key 也不代表一定能拦住未验证邮箱**，这点要有预期。
- 邮件标题与正文里的站名跟随 `SITE_NAME`

### 排查

收不到信，按顺序查：

1. 打开 `/admin` → **邮箱验证（Resend）** 卡片，先看它是「已启用」还是「未启用」
   - 显示未启用 + 列出缺失变量 → 环境变量**根本没被运行时读到**
     （只在 Preview 环境配了、或配完没重新部署，都会这样）
   - 显示已启用 → 变量没问题，往下查
2. 在同一张卡片里填一个邮箱点「发送」，会**真的发出一封验证码邮件**
   - 成功但收不到 → 查垃圾箱，或域名没验证（见下）
   - 失败 → 卡片直接显示 Resend 返回的原因（401 Key 无效 / 403 域名未验证 / 429 超配额）
3. 发件域名在 Resend 后台显示 **Verified**
4. Resend 后台 → Emails 看投递状态和失败原因（这里能看到被拒的真实原因）

> **「配了却收不到」最常见的原因**：发件域名没验证时，Resend 只允许发给你
> **自己注册账号的邮箱**，发给别人一律静默失败。用测试邮件发给自己的邮箱能成功、
> 换个邮箱就收不到，就是这个原因，去 Resend 后台验证域名即可解决。

---

## 路由一览

| 路由 | 说明 |
|---|---|
| `/` | 聊天主界面（空状态海豚 + 流式对话） |
| `/login` | 登录 |
| `/register` | 注册（第一个用户 = admin） |
| `/account` | 改密码、登出、清空云端记录 |
| `/admin` | 管理员：用户列表、切角色、删用户、查看内置 Key |
| `/sponsor` | 赞助页（收款码 + 支持方式，可关） |
| `/api/chat` | 聊天代理（SSE 流式，避免 CORS） |
| `/api/auth/register` | 注册 |
| `/api/auth/login` | 登录（限流 1 分钟 10 次） |
| `/api/auth/logout` | 登出 |
| `/api/auth/password` | 改密码 |
| `/api/auth/me` | 当前用户 |
| `/api/admin/users` | 用户管理（服务端校验 admin） |
| `/api/admin/preset-key` | 内置 Key（仅 admin） |
| `/api/conversations` | 云端会话列表 / 清空 |
| `/api/upload/config` | 对象存储平台信息（脱敏） |
| `/api/upload/presign` | 预签名上传链接 |

---

## 存储层设计

业务代码统一走 `lib/storage` 抽象，**不关心底层是 Redis 还是 KV/D1**。

```
lib/storage/
├── types.ts        # Store 接口（Redis 风格子集）
├── index.ts        # 后端自动选择
├── cloudflare.ts   # KV + D1 实现
└── upstash.ts      # Upstash Redis 实现
```

选择逻辑：

1. 检测到 KV / D1 binding → **Cloudflare**（Workers 部署）
2. 否则有 Upstash 配置 → **Upstash**（Vercel / 本地）
3. 都没有 → 无存储（可聊天，不可注册登录）

### Cloudflare 数据结构

**D1 表**（见 `schema.sql`）：

| 表 | 用途 |
|---|---|
| `users` | 用户：`id, email, password_hash, role, created_at` |
| `meta` | 计数器：`users_count` 原子自增，判定首个用户 |

**KV**：`user:{id}`、`user:email:{email}`、`session:{sid}`、`chat:*`、限流键。

### Vercel（Upstash Redis）数据结构

**登录信息全部存在 Upstash Redis 里**，站点自身不保存任何账号数据到文件或数据库。

| Key | 类型 | 说明 |
|---|---|---|
| `users:count` | String | 自增计数器，判断是否第一位用户（决定管理员） |
| `user:{userId}` | Hash | 账号主体：`id, email, passwordHash, role, createdAt` |
| `user:email:{email}` | String | 邮箱 → userId，登录时反查 |
| `session:{sessionId}` | String | **登录态**：sessionId → userId，TTL 7 天 |
| `user:sessions:{userId}` | Set | 该用户所有 session，便于整体踢下线 |
| `chat:{userId}:{conversationId}` | String | 云端聊天记录（需用户开启开关） |
| `chat:index:{userId}` | Set | 会话索引 |
| `ratelimit:login:{ip}` | String | 登录限流，1 分钟 10 次 |
| `ratelimit:upload:{ip}` | String | 上传限流 |

**一次登录发生了什么：**

```
1. POST /api/auth/login
2. 用 user:email:{email} 反查 userId
3. 取 user:{userId} 的 passwordHash，bcrypt.compare 校验
4. 生成 32 字节随机 sessionId
5. SET session:{sessionId} = userId，EX 604800（7 天）
6. SADD user:sessions:{userId} sessionId
7. 通过 httpOnly Cookie 把 sessionId 下发给浏览器
```

浏览器只拿到一个**无意义的随机串**，拿不到 userId、更拿不到密码哈希。
后续每个请求用 `getCurrentUser()` 读 Cookie → 查 `session:{sessionId}` → 查 `user:{userId}`。

> ⚠️ **Upstash token 绝不下发浏览器**，所有读写都在服务端 API Route 内完成。
> 免费版额度为每天 1 万条命令，个人站足够；超出需升级。

### 登录信息存放在哪（按平台）

| 部署平台 | 账号数据 | 登录态（session） |
|---|---|---|
| **Vercel** | Upstash Redis `user:{id}` | Upstash Redis `session:{sid}` |
| **Cloudflare Workers** | D1 `users` 表 | KV `session:{sid}` |
| 本地（未配置） | 无 | 无 —— 只能聊天，不能注册登录 |

---

## 对象存储（图片 / 视频）

按平台锁定，避免选错：

- **Workers → Cloudflare R2**：零出站流量费、10GB 免费、S3 完全兼容
- **Vercel → Backblaze B2**：10GB 免费存储，但 S3 兼容层只覆盖部分操作

流程：浏览器请求 `/api/upload/presign` 拿预签名 PUT 链接（AWS SigV4，服务端签名），
然后**直传对象存储**——文件不经过站点服务器，绕开 Serverless 请求体上限。

服务端会强制校验 endpoint 域名与平台匹配，前端绕过也没用。

存储桶需要：① 允许**公开读**；② CORS 允许站点域名做 **PUT**。

---

## 安全说明

- **密码**：Node/Vercel 用 bcrypt（cost 10）；Workers 用 **PBKDF2-SHA256 210000 次**
  （Web Crypto 原生，比纯 JS bcrypt 快得多，不浪费 CPU 配额）。
  验证时按哈希前缀自动识别算法，**跨平台迁移后老密码仍能登录**。
- **Session**：32 字节随机数，只存服务端（Vercel 在 Upstash Redis、Workers 在 KV），
  Cookie `httpOnly + secure + sameSite=lax`，TTL 7 天。浏览器拿到的只是随机串。
- **登录信息去向**：邮箱 + bcrypt/PBKDF2 哈希 + 角色写在服务端存储里，
  **从不写入日志、不落盘到站点服务器、不下发给任何前端**。
  普通用户请求 `/api/admin/*` 一律 403。
- **管理员权限**：服务端 `requireAdmin()` 校验，前端隐藏按钮不算权限控制。
- **预设 API Key**：只在服务端环境变量，非管理员请求返回 403。
- **登录失败**统一提示「邮箱或密码错误」，不区分邮箱是否存在。
- **日志**不打印密码、sessionId、API Key。

---

## 字体

- **英文 / 数字**：Montserrat
- **中文**：昭源環方 Chiron GoRound TC（[OFL 授权](https://chiron-fonts.github.io/)）
- **代码**：SuperSFMonoV1（SF Mono + 苹方）

均按 `unicode-range` 分包，中文只下载需要的字形子集。

---

## 其他细节

- 离开页面时标签页标题变成「别走啊～～(´･Д･)」—— 由 `components/dynamic-title.tsx` 实现
- 侧边栏可收起，状态记在 localStorage
- 支持拖拽 / 粘贴上传文件，图片走 vision 模型识图
- 主题切换按钮为液态玻璃质感，常驻顶栏

---

## 🩺 部署自检：/api/health

部署完访问 `https://你的域名/api/health`，会返回一份**不含任何密钥**的诊断：

```jsonc
{
  "ok": true,
  "platform": "cloudflare",        // 或 vercel / local
  "storage": {
    "backend": "cloudflare",       // cloudflare(KV+D1) | upstash | none
    "reachable": true              // 是否真的读写成功，不只是"配置了"
  },
  "objectStorage": { "kind": "r2", "siteManaged": true },
  "problems": []                   // 有内容就按提示逐条修
}
```

常见报错对照：

| `problems` 内容 | 原因 | 怎么办 |
|---|---|---|
| 未检测到 KV / D1 binding | `wrangler.jsonc` 的 ID 没填对，或 Actions 的 `KV_NAMESPACE_ID` / `D1_DATABASE_ID` 写错 | 核对 Actions Secrets；本地 `npx wrangler kv namespace list` 复查 |
| 存储读写失败 | D1 表没建 | `npx wrangler d1 execute agnes-chat-db --file=./schema.sql --remote` |
| 未设置 PRESET_AGNES_API_KEY | 密钥没写进 Workers | `npx wrangler secret put PRESET_AGNES_API_KEY` |
| backend 是 upstash | 部署到了 Vercel 却填了 Redis | 正常，符合预期 |

> 注册第一个账号前先打一发这个接口，能省掉大半排查时间。

---

## 🛡️ 代理访问拦截（可选）

行为就两条：

- **判定为代理 → 服务端直接返回 403 拦截页**，不是前端提示，绕过不了
- **判定为 iCloud Private Relay（中继）→ 放行**

### 判定方式：组合打分，不是单点判断

先说结论：**没有任何方案能 100% 拦住**。
免费情报库的覆盖率本来就追不上 VPN 服务商换 IP 的速度，
用单一数据源"碰运气"，表现就是「有时候拦得住，有时候拦不住」。

所以这里改成**打分制**：多个信号各记 1 分，
**总分 ≥ `IP_GUARD_BLOCK_SCORE`（默认 2）才拦截**。
单条信号命中只记录、不拦截 —— 因为公司内网、手机 CGNAT
都可能命中任意一条，一刀切误伤太重。

| 信号 | 数据来源 | 成本 | 命中条件 |
|---|---|---|---|
| `header` | 请求头 | 免费 | `X-Forwarded-For` 多跳 / `Via` / `Forwarded` / `Proxy-Connection` |
| `asn-hosting` | ip-api.com `hosting` | 免费 | IP 属于机房、云厂商出口而非住宅 ISP |
| `ipinfo` | IPinfo privacy | 免费 5 万次/月 | `vpn` / `proxy` / `tor` / `hosting` 任一为 true |
| `tor` | Tor 官方出口名单 | 免费 | IP 在 Tor 出口节点清单内 |
| `ipip` | ipip.net 风险画像 | 付费 | 风险分 ≥ 阈值，或命中指定行为（默认 代理/秒拨） |

**不配任何 token 也能用**：`header` + `asn-hosting` + `tor` 三个信号零成本自动生效。

几个说明：

- **ASN 比黑名单靠谱**：很多免费检测漏报，是因为只查"IP 在不在黑名单"，
  没看 ASN 归属。M247、DataCamp、OVH 这类 VPN 常驻机房，看 ASN 一眼就能认出来。
- **请求头可伪造**，高级代理还会主动 strip 掉，所以它只是辅助信号。
  Cloudflare 自己也会加头，判定时会先排除平台自身注入的那几跳。
- **住宅代理（residential proxy）用的是真实家庭宽带 IP，任何名单都查不出来。**
  目标应该是提高批量盗刷的成本，而不是追求零漏网。

> ⚠️ ip-api.com 免费端点**仅限非商业用途**，且约 45 次/分钟。
> 商业运营或流量大时请关掉它改用付费源：`IP_GUARD_FREE_SOURCE=false`

### 配置

```bash
IP_GUARD_ALLOWLIST=1.2.3.4/32,203.0.113.0/24   # 强烈建议先填这个
IPINFO_TOKEN=你的ipinfo.io token               # 可选，免费额度
IPIP_RISK_TOKEN=你的ipip.net风险画像token       # 可选，付费
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `IP_GUARD_ALLOWLIST` | 空 | **建议填**。永久放行的 CIDR，逗号分隔 |
| `IP_GUARD_BLOCK_SCORE` | `2` | 拦截阈值。改 `1` 更严但误伤明显增加 |
| `IPINFO_TOKEN` | 空 | 不填则 `ipinfo` 信号跳过 |
| `IPIP_RISK_TOKEN` | 空 | 不填则 `ipip` 信号跳过 |
| `IP_GUARD_ENABLED` | `true` | 设 `false` 整体关闭 |
| `IP_GUARD_FREE_SOURCE` | `true` | 设 `false` 关闭 ip-api.com |
| `IP_GUARD_HEADER_XFF_MIN` | 自动 | XFF 判定多跳的跳数（有 CF 头时 3，否则 2） |
| `IP_GUARD_RISK_THRESHOLD` | `90` | ipip 风险分阈值。官方建议 90 分以上才限制 |
| `IP_GUARD_BLOCK_BEHAVIORS` | `代理,秒拨` | ipip 命中哪些行为记 1 分。加 `机房` 更严但误伤更多 |

### ⚠️ 一定要先填白名单

真拦截之后，**误判的代价从"多点一下"变成"彻底打不开"**。
而企业网络、国内 CGNAT 移动网络被判成代理非常常见 ——
站长自己很可能就在这种网络里。

一旦被拦，你**已经没法登录后台去关掉这个功能了**。
`IP_GUARD_ALLOWLIST` 是唯一不依赖站点自身的逃生通道。

### iCloud Private Relay 为什么放行

Private Relay 技术上确实"换了 IP"，但它不是用户主动开的代理工具 ——
它是 Apple 系统级隐私功能，很多人根本不知道自己开着。
一律拦截会把大批正常 iPhone / Mac 用户挡在门外，而且他们不知道该怎么修。

判定用 **Apple 官方发布的出口段清单**（免费、权威、无需 token）：

```
https://mask-api.icloud.com/egress-ip-ranges.csv
```

每 24 小时刷新一次，拉取失败时保留上一份可用清单。清单里的 IP 一律放行。

> 顺序很关键：**先查中继，再跑其他信号**。
> Apple 的出口段极容易被判成机房，反过来的话放行就失效了。

### 依然 fail-open

任何信号源超时、报错、token 失效 —— **该信号按 0 分处理**，
不会因为一个源抽风就把访客拦在门外。
一个信号都没给出结论时，按 `error` 放行。

想临时关掉：`IP_GUARD_ENABLED=false`。

### 实现上的两个坑

**① 用的是 `middleware.ts`，不是 Next 16 的 `proxy.ts`**

proxy.ts 默认跑 Node.js runtime，而 OpenNext（Cloudflare 适配器）
**不支持 Node.js middleware**，构建时会直接抛错导致部署失败，
而 proxy.ts 又不允许改回 Edge。所以只能用已标记 deprecated、
但默认 Edge runtime 且被 OpenNext 支持的 `middleware.ts`。

**② token 必须在构建时就存在**

Edge bundle 里的 `process.env` 是**构建时内联**的。
构建环境里没有 token，打包出来就是 `undefined`，
之后在后台补配也读不到 —— 功能静默失效（不报错，但也不拦）。

用 Actions 部署的话，脚本已把相关变量加入注入列表，构建时可用。

### 排查：开关开了，VPN 却能进

一眼分清是哪种情况：

```bash
curl -I https://你的域名/
```

看 `X-IP-Guard` 响应头：

| 看到 | 说明 |
|---|---|
| **没有这个头** | middleware 没运行（多半是适配器/构建问题） |
| `allowed(error)` | 跑了，但**没有任何信号给出结论**（多半 token 全没配） |
| `allowed(ok)` | 信号都跑了，但总分没到阈值（VPN 未被识别） |
| `allowed(relay)` | 判定为 iCloud Private Relay，按设计放行 |
| `blocked(proxy)` | 已拦截 ✅ |

### 自检：为什么没拦住

`/api/ip-guard` 返回完整打分明细（不拦截，只报告）：

```jsonc
{
  "allowed": true,
  "reason": "ok",        // ok / relay / allowlist / proxy / error / no-ip / disabled
  "ip": "1.2.3.4",
  "points": 1,           // 当前总分
  "threshold": 2,        // 达到这个分数才拦截
  "signals": [
    { "name": "header", "hit": false, "points": 0, "ok": true, "detail": "XFF=1 跳" },
    { "name": "asn-hosting", "hit": true, "points": 1, "ok": true, "detail": "hosting=true" },
    { "name": "ipinfo", "hit": false, "points": 0, "ok": false, "note": "未配置 IPINFO_TOKEN" },
    { "name": "tor",    "hit": false, "points": 0, "ok": true, "detail": "不在出口名单内" },
    { "name": "ipip",   "hit": false, "points": 0, "ok": false, "note": "未配置 IPIP_RISK_TOKEN" }
  ],
  "status": {
    "enabled": true,
    "blockScore": 2,
    "allowlist": 2,
    "torNodes": 1234,
    "activeSources": 3      // 实际可用的数据源数量，0 = 检测整体没跑
  }
}
```

对照这份清单就能看出是「信号没配」还是「信号配了但没命中」：
`ok: false` = 该信号没跑起来（多半缺 token）；
`ok: true` 且 `hit: false` = 跑了，但情报库没认出这个 IP。

被拦时页面返回 403；`/api/*` 请求返回 JSON：

```jsonc
{ "error": "PROXY_BLOCKED", "reason": "proxy", "points": 2, "threshold": 2 }
```

## 🔐 依赖安全说明（构建日志里的警告要不要管）

`npm install` 时你可能会看到几条黄字，逐个说明：

| 警告 | 严重吗 | 处理 |
|---|---|---|
| `@opennextjs/cloudflare@0.4.8: CVE-2025-6087 was fixed in 1.3.0` | ⚠️ 真实漏洞，但**本站不受影响** | 见下方详解 |
| `deprecated crypto-js / glob / uuid / rollup-plugin-inject` | 无害 | 是依赖的依赖废弃提示，不影响运行 |
| `allow-scripts: esbuild / sharp / workerd` | 无害 | 已加 `trustedDependencies` 声明 |

### 关于 CVE-2025-6087

这是一个 SSRF 漏洞（CVSS 7.8）：Cloudflare 适配器的 `/_next/image` 端点
可被用来代理任意远程地址，攻击者能借你的域名托管钓鱼内容。

**为什么本站不受影响：**

1. 漏洞只存在于 **Cloudflare 适配器**，Vercel 部署完全不涉及（**Cloudflare 平台侧也已自动缓解**：限制该端点只返回图片）
2. 本站**根本没有用 `next/image`**，也不加载任何外部图片（图标全是内联 SVG）
3. 已在 `next.config.mjs` 设置 `images.remotePatterns: []` + `unoptimized: true`，
   即官方推荐的白名单缓解方案

**当前状态：已彻底修复（Next 15.5 + OpenNext ^1.3.0）**

本项目已升级到 `next@^15.5` + `@opennextjs/cloudflare@^1.3.0` + `wrangler@^4`，
正是官方修复版要求的组合，SSRF 面已从依赖侧消除。

升级时同步处理的 Next 15 破坏性改动：
- `cookies()` / `headers()` / `draftMode()` 改为异步（本项目 3 处 `cookies()` 已加 `await`）
- 页面与路由的 `params` / `searchParams` 改为 `Promise`（本项目 2 处本就是 Promise 写法）
- 26 个 API 路由全部带 `export const dynamic = "force-dynamic"`，
  因此 Next 15「`fetch` 与 GET 不再默认缓存」的变化对本站无影响

`next.config.mjs` 里仍保留 `remotePatterns: []` + `unoptimized: true`，
但这已与安全无关 —— 只是本站本就不加载外部图片，省一层运行时开销。

---

## 不实现的功能

Agent、工具调用、代码执行、语音 —— 聊天之外不做多余的事。
需要 Agent 功能请去 **AgentScope** 添加 Agnes API Key。

> 联网搜索是唯一例外：它只是"检索结果拼进上下文"，
> 不涉及工具调用循环，所以做进来了。

---

## ✨ 视觉效果（Aceternity 风格）

用纯 CSS + 少量 JS 复刻了 Aceternity UI 的观感，**没有引入 framer-motion**。

> 为什么不直接用官方组件：它依赖 framer-motion（约 50KB gzip），
> 而本项目要部署到 Cloudflare Workers（免费版脚本上限 1 MiB），
> 多一个大依赖很奢侈。Aceternity 的效果本质是 CSS 渐变 + 变换，
> 原生实现能拿到 95% 观感，体积几乎为零。

| 类名 / 组件 | 效果 |
|---|---|
| `.aurora` | 极光背景，多色光斑缓慢漂移 |
| `.acet-spotlight` | 鼠标跟随的聚光灯 + 亮边（JS 只写 `--mx/--my`） |
| `.acet-tilt` | 3D 倾斜卡片，±6° 克制幅度 |
| `.acet-glow-border` | 旋转流光边框（conic-gradient + mask） |
| `.acet-shimmer` | 斜向微光扫过 |
| `.acet-grid` | 网格背景，中心清晰四周淡出 |
| `.acet-beams` | 从顶部落下的细光柱 |
| `.acet-glow` | 鼠标跟随的**边框**发光（内部保持干净） |
| `.acet-meteors` | 斜向下落的流星带尾迹 |
| `.acet-sparkles` | 随机闪现的星点 |
| `.acet-moving-border` | 沿边框循环流动的流光 |
| `.acet-tracing-beam` | 沿容器左侧向下流动的光束 |
| `.acet-pointer` | 鼠标位置的弥散光晕（比 spotlight 更淡） |
| `.acet-vortex` | 旋涡背景（多层 conic 反向旋转） |
| `.acet-lamp` | 顶部落下的锥形光束 |
| `.acet-wobble` | 鼠标靠近时轻微形变 |
| `.acet-bento` | Bento 栅格（卡片有大有小形成节奏） |
| `.acet-noise` | 极淡噪点，压住大面积渐变的塑料感 |
| `.acet-text-shimmer` | 沿文字扫过的高光 |

组件在 `components/ui/aceternity.tsx`，共 20 个。

> ⚠️ 顺带修了个隐藏 bug：`.aurora` 之前被 5 个页面引用
> （登录、注册、账户、管理、导航），但 CSS 里**从未定义**，
> 那些页面的背景一直是空的。现在补上了。

---

## 🔍 联网搜索实现说明

| 项 | 说明 |
|---|---|
| 搜索源 | 多源自动回退，见下表 |
| 需要 API Key 吗 | 默认不需要；配了 Key 会优先用 API 源（更稳） |
| 结果条数 | 默认 30，最多 100（摘要自动压缩，见下） |

### 搜索源优先级

| 类别 | 搜索源 | 需要 Key | 说明 |
|---|---|---|---|
| 免费 | **Bing RSS** | 否 | 官方 RSS 输出，结构化，默认主源 |
| 免费 | **Sogou** | 否 | 中文结果质量好（无摘要、链接为跳转地址） |
| 免费 | DuckDuckGo | 否 | 备用源 |
| API | ⭐ **Serper** | 是 | **推荐**：注册不用信用卡，免费 2500 次，走 Google 索引 |
| API | **Tavily** | 是 | 专为 LLM 设计，返回已提炼的片段 |
| API | **Brave Search** | 是 | 独立索引，不依赖 Google/Bing |
| API | **博查 AI** | 是 | 国内可用，中文友好 |
| API | Exa | 是 | 语义/神经搜索 |

**配了 Key 就优先用 API 源** —— 爬虫源随时可能因反爬失效，而 API 有 SLA。
按上表顺序取第一个配了 Key 的。

> **为什么默认推荐 Serper**：注册只要邮箱，**不需要信用卡**，
> 免费额度 2500 次，对个人站足够。其余几个要么要卡（Brave/Tavily 部分套餐），
> 要么国内访问不稳。

> ⚠️ **关于"某引擎不可用"的判断，这里踩过坑**：
> 开发环境有出网白名单，连 `example.com` 和 npm 官方源都会返回 403，
> 响应体是 `{"detail":"No policy rule matched the request"}`。
> 所以**本地测出的 403 不代表生产环境不可用** ——
> 早前据此判定 DuckDuckGo / SearXNG 不可用，是误判。
> 现在改成多源自动回退，运行时谁通谁上，不写死单一结论。

搜索接口会返回诊断字段，便于排查"搜不到/搜不准"：
- `via`：实际命中的源
- `attempts`：每个源的尝试情况
- `keyedSources`：当前配置了哪些 Key 源（只有标识，不含密钥）

**条数与压缩**：不再限制 5 条。结果越多，单条摘要自动截得越短：

| 结果条数 | 单条摘要上限 |
|---|---|
| ≤ 8 | 260 字 |
| ≤ 20 | 140 字 |
| ≤ 40 | 90 字 |
| > 40 | 60 字 |

100 条结果注入约 6K 字符，不会撑爆上下文。
回答下方的来源列表默认只显示前 6 条，其余点「展开」查看。

---

## 🖼️ 图片上传与"AI 看不到"的自救

正常情况下图片会上传到对象存储，以链接形式发给模型。

但有个隐蔽的坑：**上传返回 200 不代表 AI 看得到** ——
如果存储桶没开公开读、或自定义域名没生效，那个链接是外部访问不了的，
模型在服务端拉不到图，表现为"明明配了存储，AI 还是看不见"。

所以上传后会**主动探测链接可达性**：

```
上传 → 探测 URL 能否加载
     ├─ 能   → 用链接（省体积）
     └─ 不能 → 自动转 base64 内嵌，并提示检查公开读设置
```

内嵌是一定能被模型读到的（OpenAI 的 `image_url` 原生接受 data URL，
这就是所谓的"自动解码"，不需要额外处理）。代价是请求体变大，
所以只在不超体积红线时才回退。
