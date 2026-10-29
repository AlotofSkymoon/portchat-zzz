# 🚀 Vercel 小白部署教程

> 全程点点点，不用敲命令，不用装任何软件。大约 10 分钟搞定。
> 你只需要：**一个 GitHub 账号**（代码已经推好了）+ **一个 Upstash 账号** + **一个 Vercel 账号**。

---

## 开始前先准备这 4 个值

部署过程中会要你填 4 个"环境变量"，先知道它们是啥，待会儿照抄就行：

| 变量名 | 值从哪来 | 你现在要做什么 |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | 第 ① 步创建数据库后复制 | 空着，等下填 |
| `UPSTASH_REDIS_REST_TOKEN` | 第 ① 步创建数据库后复制 | 空着，等下填 |
| `SESSION_SECRET` | 自己随便打一串长字符 | 可以用：`agnes-free-chat-2026-secret-xyz` |
| `PRESET_AGNES_API_KEY` | 已给你了 | `sk-d5DyJCcfW9TmkeIHnfFPgHJ2ZjxfKHCx5ip3tR14abyrgZEi` |

---

## ① 创建 Upstash Redis 数据库（存用户账号）

**1-1** 打开 👉 https://console.upstash.com/
点右上角 **Sign up / Log in**，推荐直接用 **GitHub 账号登录**（最快，不用验证邮箱）。

**1-2** 登录后，点页面上的 **Create Database**（创建数据库）大按钮。
> 💡 如果找不到，看左侧菜单有没有 **Redis**，点进去后再找 Create Database。

**1-3** 填这几个地方，其他全部保持默认不动：

- **Name**（名字）：随便写，比如 `agnes-chat`
- **Type**：选 **Regional**（区域型，免费额度更大）
- **Region**（地区）：选离你最近/用户最多的，推荐：
  - `ap-southeast-1`（新加坡）← 亚洲用户选这个
  - 或 `us-east-1`（美东）
- **Plan**：确认是 **Free**（免费）

点 **Create**。

**1-4** 创建好后会自动进入数据库详情页。往下找，会看到一块叫 **REST API** 的区域（有的界面叫 "Connect your database" → 选 **REST API** 标签页）。

你会看到类似这样两行代码：

```bash
UPSTASH_REDIS_REST_URL=https://gently-moth-12345.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXhaASQgXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**1-5** 把这两个值 **分别复制** 下来，粘贴到记事本里备用。

> ⚠️ 注意：一定要复制带 `REST` 字样的这两个！页面上可能还有 `UPSTASH_REDIS_URL`（不带 REST）那种是另一种连接方式，别复制错了。

**免费额度**：每天 10 万次命令，个人公益项目完全够用，不会扣费。

---

## ② Vercel 导入项目

**2-1** 打开 👉 https://vercel.com/
点 **Sign Up**，同样用 **GitHub 账号登录**。

**2-2** 登录后点右上角 **Add New** → **Project**（或首页的 Import Project）。

**2-3** 你会看到一个 GitHub 仓库列表。如果没看到 `agnes-chat`：
- 点列表上方的 **Adjust GitHub App Permissions**（或 Configure）
- 在弹出的 GitHub 页面里选 **Only select repositories** → 勾上 `agnes-chat` → Save
- 回到 Vercel 刷新页面

**2-4** 找到 `AlotofSkymoon/agnes-chat`，点右边的 **Import**。

---

## ③ 填环境变量（最关键的一步 ⭐）

导入后会进入配置页面。

**3-1** 先确认这几项 —— **全部保持默认，什么都别改**：

- Framework Preset：**Next.js**（自动识别的）
- Root Directory：`./`（默认）
- Build Command：**留空**
- Output Directory：**留空**

**3-2** 找到 **Environment Variables**（环境变量）这一块，点开它。

**3-3** 一个一个添加。每次填左边的 **Key** 和右边的 **Value**，然后点 **Add**：

**第 1 个：**
```
Key:   UPSTASH_REDIS_REST_URL
Value: https://gently-moth-12345.upstash.io      ← 换成你第 ① 步复制的
```

**第 2 个：**
```
Key:   UPSTASH_REDIS_REST_TOKEN
Value: AXhaASQgXXXXXXXXXXXXXXXXXXXXXXXXXXXX      ← 换成你第 ① 步复制的
```

**第 3 个：**
```
Key:   SESSION_SECRET
Value: agnes-free-chat-2026-secret-xyz           ← 随便写，越长越乱越好
```

**第 4 个：**
```
Key:   PRESET_AGNES_API_KEY
Value: sk-d5DyJCcfW9TmkeIHnfFPgHJ2ZjxfKHCx5ip3tR14abyrgZEi
```

**3-4** 填完应该是 4 条，像这样：

| Key | Value |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` | https://xxx.upstash.io |
| `UPSTASH_REDIS_REST_TOKEN` | AXxx... |
| `SESSION_SECRET` | agnes-free-chat-... |
| `PRESET_AGNES_API_KEY` | sk-d5Dy... |

> 💡 每条右边有个 Environments 勾选框，默认全勾（Production + Preview + Development），**保持默认全勾**就行。

---

## ④ 开始部署

**4-1** 确认 4 个变量都填好后，点页面底部的蓝色大按钮 **Deploy**。

**4-2** 等 1～3 分钟。会看到 Building 的日志在滚动，这是在装依赖和编译。

**4-3** 出现 🎉 **Congratulations** 或一堆彩带，就成功了！

**4-4** 点 **Continue to Dashboard** 进入项目页，顶部会显示你的网址，类似：
```
https://agnes-chat-xxxx.vercel.app
```
点它就能打开你的网站了。

---

## ⑤ 注册第一个账号 = 自动成为管理员

**5-1** 打开你的网站，右上角点 **登录** → 点下面的 **去注册**。

**5-2** 填邮箱和密码（密码至少 8 位），点注册。

**5-3** 因为你是第一个用户，会弹出提示：**"你是第一位用户，已获得管理员权限。"**

**5-4** 之后右上角会多出一个盾牌图标 🛡️，点进去就是 `/admin` 管理后台，可以：
- 看所有注册用户
- 切换别人为管理员 / 普通用户
- 删除用户
- **查看站点内置 API Key 的完整值**（只有你能看，普通用户看不到）

---

## ❓ 常见问题

**Q1：注册时提示"服务端未配置 Upstash Redis"**
→ 环境变量没生效。回 Vercel 项目页 → **Settings** → **Environment Variables** 检查 4 个有没有填全 → 然后去 **Deployments** 点最新的那一条右边的 **⋯** → **Redeploy**。

**Q2：改了环境变量，但还是老样子**
→ 环境变量改完**必须 Redeploy** 才生效，不会自动更新。

**Q3：聊天一直转圈 / 报 401**
→ 检查 `PRESET_AGNES_API_KEY` 有没有填对（注意别多复制空格）。或者在网站设置里填你自己的 Agnes Key 试试。

**Q4：网站能打开但很慢**
→ Upstash 地区选远了。可以在 Upstash 重新建一个离你近的数据库，把 URL 和 TOKEN 换掉再 Redeploy。（旧数据会没，个人项目无所谓）

**Q5：想换成我自己的 API Key**
→ 打开网站 → 右上角齿轮 ⚙️ 设置 → 填你的 Key → 保存。留空则用站点内置的 Key。

**Q6：部署失败，日志里报红字**
→ 90% 是环境变量问题，先检查 Q1。如果还有问题，把报错信息复制给我。

**Q7：会不会花钱？**
→ 不会。Vercel Hobby（免费版）和 Upstash 免费版足够个人使用，都不需要绑信用卡。

**Q8：怎么更新网站？**
→ 代码推到 GitHub 后，Vercel 会**自动重新部署**，什么都不用做。

---

## 🎯 一句话总结

> 建 Upstash 数据库 → 复制两个 REST 值 → Vercel 导入 `agnes-chat` → 填 4 个环境变量 → Deploy → 注册第一个账号变管理员。

搞定！有问题随时问。
