# Cloudflare Workers 部署教程

> **只填 GitHub Secrets，其余全自动。**
> 不需要在 Cloudflare 后台点来点去，不需要手抄任何 ID，
> 不需要访问建表地址，不需要装 Node/Wrangler。
>
> 全程 5 分钟，只需要 4 个 Secret。

---

## 两种方式，都很简单 —— 选一个

| | ⭐ 界面部署 | Actions 部署 |
|---|---|---|
| 要配 API 令牌吗 | **不用** | 要（1 个） |
| 建 KV / D1 / R2 | 后台点几下 | 脚本全自动 |
| 要抄 32 位 ID 吗 | **不用**（后台直接选） | 不用（脚本查） |
| 配站点密钥 | 后台加 2 个 | 自动注入 |
| 建 D1 表 | 访问一次地址 | 自动 |
| 自动更新 | 推代码即部署 | 同 |

**两种都不用手抄 ID** —— 这是关键。界面部署在后台直接点选绑定，
Actions 由脚本自动查找创建。以前那份教程让你抄 3 个 ID，是我写得不好。

- 不想碰令牌 → [界面部署](#方式二界面部署)（5 分钟，全在网页点）
- 想全自动、零后台操作 → 继续看下面的 Actions

---

# 方式二：界面部署

按 cloud-mail 的思路：配置文件里**不写任何 ID**，绑定全在 Cloudflare 后台点。

## 第 1 步：克隆/导入仓库

1. 打开 <https://github.com/AlotofSkymoon/agnes-chat>
2. **Fork** 到自己账号（或直接 clone 后推到自己的仓库）

## 第 2 步：创建 Worker 项目

1. <https://dash.cloudflare.com> → **Workers 和 Pages** → **创建**
2. 选 **连接到 Git**，授权后选中 `agnes-chat` 仓库
3. 填构建配置：

| 配置项 | 值 |
|---|---|
| 项目名称 | `agnes-chat` |
| 生产分支 | `main` |
| **构建命令** | `npm run cf:build` |
| **部署命令** | `npx wrangler deploy`（默认就是这个，不用改） |

> ✅ **仓库里所有 wrangler 配置文件都不用你改**，一个字都不用动。
>
> `wrangler.jsonc` 里**没有**任何 KV / D1 / R2 的 ID 或占位符 ——
> ID 不用抄，绑定在下一步后台点两下就完成。

4. 点 **保存并部署**

首次会失败或能过都不影响 —— 因为还没绑定数据库，下一步补上就好。

## 第 3 步：创建并绑定 KV / D1 / R2

### 先创建三个资源

| 资源 | 位置 | 名字 |
|---|---|---|
| KV 命名空间 | **Workers 和 Pages → KV** → 创建命名空间 | `agnes-chat` |
| D1 数据库 | **Workers 和 Pages → D1** → 创建数据库 | `agnes-chat-db` |
| R2 桶 | **R2** → 创建存储桶 | `agnes-chat` |

名字可以随便起，**下面绑定时选对就行**。

### 再绑定到 Worker

进你的 Worker → **设置** → **绑定** → **添加绑定**，加三条：

| 类型 | **变量名** | 值 |
|---|---|---|
| KV 命名空间 | `KV`（或 `kv`） | 选刚建的 `agnes-chat` |
| D1 数据库 | `DB`（或 `db`） | 选刚建的 `agnes-chat-db` |
| R2 桶 | `R2`（或 `r2`） | 选刚建的 `agnes-chat` |

> ⚠️ **变量名必须是 `KV` / `DB` / `R2`**（小写 `kv` / `db` / `r2` 也能识别）。
> 写别的名字代码认不出来，会一直提示"缺少绑定"。

**这一步不需要抄任何 ID** —— 后台是下拉选择，点一下就绑好了。

## 第 4 步：设置环境变量

Worker → **设置** → **变量和机密** → **添加**：

| 类型 | 名称 | 值 |
|---|---|---|
| 机密 | `SESSION_SECRET` | `openssl rand -base64 32` 生成的随机串 |
| 机密 | `PRESET_AGNES_API_KEY` | Agnes Key（可先用 `sk-d5DyJCcfW9TmkeIHnfFPgHJ2ZjxfKHCx5ip3tR14abyrgZEi`） |
| 机密 | `JWT_SECRET` | 随便一串字符串，**不要用特殊字符**（`? % # / \`） |

> ⚠️ 改完环境变量**必须重新部署一次**才生效（Deployments → 重新部署）。

## 第 5 步：注册管理员（直接就能用）

打开站点 → 注册 → **第一个注册的账号自动成为管理员**。

> 💡 **不用手动建表。** 首次访问时会自动执行
> `CREATE TABLE IF NOT EXISTS`（幂等，重复无害），
> 建 5 张表：users、meta、conversations、messages、site_settings。
>
> 想手动触发或排查，可以访问
> `https://你的域名/api/d1/cshsjk/你的jwt_secret`——
> 但正常情况**不需要**这一步。

---

# 方式一：Actions 部署

---

## 第 1 步：创建 API 令牌

1. 打开 <https://dash.cloudflare.com/profile/api-tokens>
2. **创建令牌** → 找 **「编辑 Cloudflare Workers」** → **使用模板**
3. 账户资源选「包括 → 你的账户」，区域资源选「包括 → 所有区域」
4. **继续到摘要** → **创建令牌** → 复制（只显示一次）

> 用官方模板就行，权限都已配好。手动勾选容易漏掉
> `User Details` 和 `Memberships` 这两个**用户层级**的权限
> （漏了会报 `Authentication error [code: 10000]`）。

## 第 2 步：拿账户 ID

<https://dash.cloudflare.com> 登录后，右侧栏能看到 **账户 ID**（32 位）。

## 第 3 步：填 4 个 Secrets

仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Name | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第 1 步的令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | 第 2 步的账户 ID |
| `SESSION_SECRET` | `openssl rand -base64 32` 生成的随机串 |
| `PRESET_AGNES_API_KEY` | Agnes Key，可先用默认的 `sk-d5DyJCcfW9TmkeIHnfFPgHJ2ZjxfKHCx5ip3tR14abyrgZEi` |

**就这 4 个。KV / D1 / R2 的 ID 不用填 —— 脚本会自己找、自己创建。**

<details>
<summary>可选：想自定义更多（点开）</summary>

**Secrets**（敏感值）：

| Name | 说明 |
|---|---|
| `UPSTASH_REDIS_REST_URL` / `..._TOKEN` | 多平台数据同步（填了就统一用 Upstash） |
| `SERPER_API_KEY` | 联网搜索（serper.dev 免费 2500 次，不用信用卡） |
| `JWT_SECRET` | D1 建表接口鉴权（不配则接口直接 500，更安全） |

**Variables**（非敏感，在 Variables 标签页）：

| Name | 默认 | 说明 |
|---|---|---|
| `R2_BUCKET_NAME` | `agnes-chat` | 换桶名 |
| `SITE_NAME` | `Agnes AI` | 站点名 |
| `NEXT_PUBLIC_REQUIRE_LOGIN` | `false` | 是否必须登录才能对话 |
| `NEXT_PUBLIC_ALLOW_WEB_SEARCH` | `true` | 是否开放联网按钮 |
| `STORAGE_BACKEND` | `auto` | `auto` / `cloudflare` / `upstash` / `unified` |
| `INJECT_SECRETS` | `true` | 设为 `false` 则自己到 Cloudflare 后台配密钥 |

</details>

## 第 4 步：推送，或手动触发

推到 `main` 自动部署；也可以 **Actions** → 选工作流 → **Run workflow**。

等 3～5 分钟，看到绿色 ✅ 就完成了。

---

## 部署时自动发生的事

```
校验配置 → 查找/创建 KV、D1、R2 → 把 ID 写回 wrangler.jsonc
        → 注入站点密钥 → 建 D1 表 → 构建 → 部署
```

| 环节 | 说明 |
|---|---|
| KV 命名空间 | 找同名 `agnes-chat`，没有就创建 |
| D1 数据库 | 找同名 `agnes-chat-db`，没有就创建 |
| R2 桶 | 找同名 `agnes-chat`，没有就创建 |
| **R2 不可用** | 自动移除 `r2_buckets`，部署继续（不因缺桶失败） |
| D1 建表 | 执行 `schema.sql`，幂等，5 张表 |
| 密钥注入 | 写进配置，所以**运行时真的读得到** |

最后一点是关键。**GitHub 仓库的 Secrets 只对 Actions 生效**，
部署完成后 Worker 读不到 —— 这就是过去"明明配了却说缺少 Key"的真正原因。
现在脚本在构建阶段把它们写进配置，绕开了这个坑。

想改回自己在后台配：设变量 `INJECT_SECRETS=false`。

---

## 上线自检

打开 `https://你的域名/api/health`（地址在部署日志里）：

```jsonc
{
  "ok": true,
  "platform": "cloudflare",
  "storage": { "backend": "cloudflare", "reachable": true },
  "problems": []
}
```

- `ok: true` → 注册第一个账号，**自动成为管理员**
- `problems` 有内容 → 按提示修

---

## 常见报错

### `Authentication error [code: 10000]`

令牌权限不足。用官方「编辑 Cloudflare Workers」模板重建一个，
重点确认有这两个**用户层级**权限：

- 用户 → **User Details** → 读取
- 用户 → **Memberships** → 读取

### 压缩后超过 1 MiB

免费版 Worker 脚本上限 1 MiB。Next.js 应用容易碰线，
需升级 Workers 付费版（$5/月，上限 10 MiB）。

### 未注册 workers.dev 子域名

Cloudflare 后台 → **Workers 和 Pages** → 设置子域名，随便起一个。

### 部署后注册/登录报错

看 `/api/health` 的 `storage.reachable`。
`false` 说明 D1 表没建成 —— 检查日志里建表那一步。

---

## R2 对象存储

**桶已自动创建并绑定，直接用就行，不用配置任何密钥。**

设置 → 对象存储 会显示「✓ 已通过 Worker 绑定直连 R2」。
桶是本站自己的，Worker 通过 binding 读写，**不需要 Access Key / Secret Key**。

需要自定义域名、或想改用别的 S3 服务，见 [R2 教程](./R2对象存储配置教程.md)。

---

## 想换其他平台

| 平台 | 存储 | 说明 |
|---|---|---|
| **Cloudflare Workers** | KV + D1 + R2 | 本教程，免费额度大 |
| Vercel | Upstash + B2 | 见 [Vercel 教程](./Vercel小白部署教程.md) |
| Netlify | Upstash + B2 | 拖 ZIP 即可 |

三者运行时代码相同，站点自动检测平台选后端。

### ⚠️ 重要：Cloudflare 与 Vercel 默认**不互通**

这是最容易踩的坑，务必先读：

| 平台 | 默认存储 | 后果 |
|---|---|---|
| **Cloudflare** | KV + D1（本教程默认） | 数据只在这一处 |
| **Vercel / Netlify** | Upstash Redis | 数据在另一处 |

**这两套是彼此独立的存储，账号和聊天记录不会自动同步。**
你在 Cloudflare 端注册的账号，在 Vercel 端登录会提示用户不存在；聊天记录同理。

**要打通，唯一的办法是让所有平台共用同一个 Upstash：**

1. 去 [Upstash](https://upstash.com) 建一个 Redis（免费额度够用）
2. 复制 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN`
3. **给每一个平台都填上这两个变量**（包括 Cloudflare）
   - Cloudflare：Workers → 设置 → 变量和机密 → 添加（类型选「机密」）
   - Vercel / Netlify：项目设置 → Environment Variables
4. 改完**重新部署一次**

配好后 Cloudflare 端会自动改用 Upstash（Upstash 优先级高于 KV+D1），
两端就合并为同一份数据了。

**验证**：各站访问 `/api/health`，看这两个字段：

```jsonc
{
  "storage": {
    "syncStatus": "shared",        // shared=已共享 / isolated=孤岛
    "storageFingerprint": "xxxx"   // 各站比对，相同=同一份数据
  }
}
```

- `syncStatus: "shared"` + 各站 fingerprint 相同 → ✅ 已互通
- `syncStatus: "isolated"` → 还在跑 KV+D1，按上面步骤配 Upstash

> 如果只部署一个平台，不配 Upstash 也完全没问题 ——
> Cloudflare 的 KV + D1 免费额度更大，是单机部署的推荐选择。
