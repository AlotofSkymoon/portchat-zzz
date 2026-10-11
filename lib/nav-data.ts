/**
 * 导航站数据（照搬 leoi.org 的栏目结构）
 *
 * 内置默认数据；管理员可在 /admin 的「导航管理」里增删改，
 * 自定义后的数据存在 Redis（key: nav:data）。
 */

export interface NavItem {
  id: string;
  name: string;
  url: string;
  desc?: string;
  /** 是否标注「推荐」 */
  recommended?: boolean;
}

export interface NavCategory {
  id: string;
  title: string;
  icon: string;
  items: NavItem[];
}

export const DEFAULT_NAV: NavCategory[] = [
  {
    id: "search",
    title: "查询工具",
    icon: "🔍",
    items: [
      {
        id: "whois",
        name: "Whois查询",
        url: "https://www.whois.com/whois/",
        desc: "查询域名注册信息",
      },
      {
        id: "icann-tld",
        name: "ICANN搜后缀",
        url: "https://www.iana.org/domains/root/db",
        desc: "IANA 根区数据库，权威后缀列表",
      },
      {
        id: "icann-whois",
        name: "ICANN权威whois查询",
        url: "https://lookup.icann.org/",
        desc: "ICANN 官方 whois",
      },
    ],
  },
  {
    id: "speed",
    title: "测速 & IP",
    icon: "⚡",
    items: [
      {
        id: "speed-test",
        name: "网站测速",
        url: "https://pagespeed.web.dev/",
        desc: "Google PageSpeed Insights",
      },
      { id: "ip", name: "查ip", url: "https://ip.sb/", desc: "查看本机 IP 与归属" },
      { id: "seo", name: "查SEO", url: "https://www.aizhan.com/", desc: "SEO 综合查询" },
      {
        id: "dns",
        name: "查DNS传播",
        url: "https://www.whatsmydns.net/",
        desc: "全球 DNS 解析传播检查",
      },
    ],
  },
  {
    id: "price",
    title: "域名价格 & 注册商",
    icon: "💰",
    items: [
      {
        id: "tld-list",
        name: "搜最便宜的域名价格",
        url: "https://tld-list.com/",
        desc: "对比各后缀注册/续费价",
      },
      {
        id: "gname",
        name: "新晋域名提供商（可支付宝）",
        url: "https://www.gname.com/",
        desc: "支持支付宝",
        recommended: true,
      },
      {
        id: "namesilo",
        name: "老牌域名提供商",
        url: "https://www.namesilo.com/",
        desc: "免费 WHOIS 隐私保护",
      },
      {
        id: "regery",
        name: "提供近2000种后缀购买的域名提供商",
        url: "https://www.regery.com/",
        desc: "后缀种类极全",
      },
    ],
  },
  {
    id: "freedomain",
    title: "免费域名",
    icon: "🎁",
    items: [
      {
        id: "gname-free",
        name: "Gname免费域名计划",
        url: "https://www.gname.com/",
        desc: "Gname 免费域名活动",
      },
      { id: "cccc", name: "cc.cc聚合页", url: "https://cc.cc/", desc: "免费域名" },
      {
        id: "katabump",
        name: "katabump免费域名",
        url: "https://katabump.com/",
        desc: "免费域名",
        recommended: true,
      },
      {
        id: "digitalplat",
        name: "DigitalPlat Domain",
        url: "https://domain.digitalplat.org/",
        desc: "免费域名，可接入 Cloudflare",
        recommended: true,
      },
      {
        id: "dnshe",
        name: "DNSHE免费域名",
        url: "https://dnshe.com/",
        desc: "免费域名 + DNS",
        recommended: true,
      },
      {
        id: "stackryze",
        name: "Stackryze免费域名",
        url: "https://stackryze.com/",
        desc: "审核较严格，因此域名质量更高",
      },
    ],
  },
  {
    id: "deploy",
    title: "免费部署静态页面",
    icon: "📃",
    items: [
      {
        id: "cloudflare-pages",
        name: "Cloudflare",
        url: "https://pages.cloudflare.com/",
        desc: "免费 CDN + Pages，全球节点，静态站首选",
        recommended: true,
      },
      { id: "gh-pages", name: "GitHub", url: "https://pages.github.com/", desc: "GitHub Pages" },
      {
        id: "freepage",
        name: "FreePage",
        url: "https://free.page/",
        desc: "零配置上线，复制粘贴就能有一个网页",
        recommended: true,
      },
      {
        id: "cf-drop",
        name: "Cloudflare Drop",
        url: "https://drop.cloudflare.com/",
        desc: "临时部署整个静态站，链接大陆用不了",
      },
      {
        id: "pagedrop",
        name: "pagedrop",
        url: "https://pagedrop.io/",
        desc: "临时部署单页面，链接大陆可用，免费域名",
      },
      {
        id: "pagebowl",
        name: "Page Bowl",
        url: "https://pagebowl.io/",
        desc: "临时部署整个静态站，链接大陆可用",
        recommended: true,
      },
    ],
  },
  {
    id: "hosting",
    title: "免费主机",
    icon: "🖥️",
    items: [
      {
        id: "infinityfree",
        name: "infinityfree",
        url: "https://www.infinityfree.com/",
        desc: "运营多年的免费 PHP 主机",
      },
      {
        id: "byethost",
        name: "byethost",
        url: "https://www.byethost.com/",
        desc: "欧洲机房，PHP + MySQL 免费空间",
        recommended: true,
      },
      {
        id: "hyperphp",
        name: "hyperphp",
        url: "https://hyperphp.com/",
        desc: "控制台与 byethost 同源，欧洲节点",
        recommended: true,
      },
      {
        id: "tinkerhost",
        name: "Tinkerhost",
        url: "https://tinkerhost.com/",
        desc: "可自定义域名，自带证书",
        recommended: true,
      },
      {
        id: "mofh",
        name: "Mofh",
        url: "https://mofh.net/",
        desc: "分销式主机账户，需自行签发证书",
      },
    ],
  },
  {
    id: "ai",
    title: "免费工作流AI与免费key",
    icon: "🧰",
    items: [
      {
        id: "trae",
        name: "Trae",
        url: "https://www.trae.ai/",
        desc: "AI 编程 IDE，中文支持好",
      },
      {
        id: "grok",
        name: "Gork",
        url: "https://grok.com/",
        desc: "免费额度充足，无需绑卡即可体验",
        recommended: true,
      },
      {
        id: "aistudio",
        name: "Google AI Studio",
        url: "https://aistudio.google.com/",
        desc: "好用，且没有额度限制，门槛稍高",
      },
      {
        id: "zhipu",
        name: "智谱",
        url: "https://bigmodel.cn/",
        desc: "新用户送 2000 万 tokens，4.7 flash 免费调用",
        recommended: true,
      },
      {
        id: "siliconflow",
        name: "硅基流动",
        url: "https://siliconflow.cn/",
        desc: "一大堆免费模型",
        recommended: true,
      },
      { id: "manus", name: "Manus", url: "https://manus.im/", desc: "AI Agent 产品" },
      {
        id: "qwenpaw",
        name: "QwenPaw国际版",
        url: "https://qwen.ai/",
        desc: "多说无用，用了才知道",
        recommended: true,
      },
      {
        id: "agnes",
        name: "Agnes",
        url: "https://agnes-ai.com/",
        desc: "新加坡公司，agent 非常强，搭配 AgentScope Platform 神中神，有中国站",
        recommended: true,
      },
      {
        id: "niulai-main",
        name: "牛来 API（主力）",
        url: "https://hiapi.cc.cd/",
        desc: "牛来大模型 API 中转，主力入口",
        recommended: true,
      },
      {
        id: "niulai-backup",
        name: "牛来 API（备用）",
        url: "https://1hi.dpdns.org/",
        desc: "牛来 API 备用域名，主力打不开时走这里",
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        url: "https://openrouter.ai/",
        desc: "聚合平台，一个 Key 调用全球主流模型",
        recommended: true,
      },
    ],
  },
  {
    id: "ssl",
    title: "免费证书 & CDN",
    icon: "🔐",
    items: [
      {
        id: "letsencrypt",
        name: "Let's Encrypt",
        url: "https://letsencrypt.org/",
        desc: "免费证书行业标准，90 天自动续，支持通配符",
        recommended: true,
      },
      {
        id: "cf-ssl",
        name: "Cloudflare SSL",
        url: "https://www.cloudflare.com/ssl/",
        desc: "托管 DNS 即自动签发，永久免费，自带 CDN",
        recommended: true,
      },
      {
        id: "zerossl",
        name: "ZeroSSL",
        url: "https://zerossl.com/",
        desc: "90 天免费无限续，少数支持纯 IP 证书",
      },
      {
        id: "cf-cdn",
        name: "Cloudflare CDN",
        url: "https://www.cloudflare.com/",
        desc: "免费全球 CDN + WAF + DNS",
        recommended: true,
      },
      {
        id: "joyssl",
        name: "JoySSL",
        url: "https://www.joyssl.com/",
        desc: "国产 CA，支持国密 SM2，中文客服",
      },
    ],
  },
  {
    id: "storage",
    title: "免费图床 & 存储",
    icon: "🖼️",
    items: [
      {
        id: "smms",
        name: "SM.MS",
        url: "https://sm.ms/",
        desc: "老牌图床，5G 免费空间，支持 PicGo",
        recommended: true,
      },
      { id: "imgchr", name: "路过图床", url: "https://imgchr.com/", desc: "有 CDN，支持多种链接格式" },
      { id: "imgurl", name: "ImgURL", url: "https://imgurl.org/", desc: "可自部署，游客每日 10 张" },
      {
        id: "qiniu",
        name: "七牛云对象存储",
        url: "https://www.qiniu.com/",
        desc: "10G 免费空间，支持图片处理",
        recommended: true,
      },
      {
        id: "cos",
        name: "腾讯云 COS",
        url: "https://cloud.tencent.com/product/cos",
        desc: "新用户免费额度，国内加速稳定",
      },
      {
        id: "oss",
        name: "阿里云 OSS",
        url: "https://www.aliyun.com/product/oss",
        desc: "新用户免费额度，节点覆盖广",
      },
    ],
  },
  {
    id: "email",
    title: "免费域名邮箱",
    icon: "📮",
    items: [
      {
        id: "zoho",
        name: "Zoho Mail 免费版",
        url: "https://www.zoho.com/mail/",
        desc: "接近企业邮箱，独立收件箱 + 自定义域名",
        recommended: true,
      },
      {
        id: "cf-email",
        name: "Cloudflare Email Routing",
        url: "https://www.cloudflare.com/products/email-routing/",
        desc: "免费域名邮件转发到现有邮箱",
        recommended: true,
      },
      { id: "forwardemail", name: "Forward Email", url: "https://forwardemail.net/", desc: "开源邮件转发，开发者友好" },
      { id: "proton", name: "Proton Mail", url: "https://proton.me/mail", desc: "端到端加密，重视隐私" },
    ],
  },
  {
    id: "devtools",
    title: "开发者常用工具",
    icon: "🛠️",
    items: [
      { id: "caniuse", name: "Can I Use", url: "https://caniuse.com/", desc: "浏览器兼容性查询", recommended: true },
      { id: "regex101", name: "Regex101", url: "https://regex101.com/", desc: "正则在线测试与解释", recommended: true },
      { id: "jsonlint", name: "JSONLint", url: "https://jsonlint.com/", desc: "JSON 校验与格式化" },
      { id: "excalidraw", name: "Excalidraw", url: "https://excalidraw.com/", desc: "手绘风白板，画架构图", recommended: true },
      { id: "stackblitz", name: "StackBlitz", url: "https://stackblitz.com/", desc: "浏览器里跑完整前端项目" },
      { id: "codepen", name: "CodePen", url: "https://codepen.io/", desc: "前端代码片段演示" },
      { id: "tsplay", name: "TypeScript Playground", url: "https://www.typescriptlang.org/play", desc: "在线编译 TS 看产物" },
      { id: "webaim", name: "WebAIM WAVE", url: "https://wave.webaim.org/", desc: "无障碍与对比度检查" },
      { id: "webpagetest", name: "WebPageTest", url: "https://www.webpagetest.org/", desc: "真实网络下的加载瀑布图" },
      { id: "mdn", name: "MDN Web Docs", url: "https://developer.mozilla.org/", desc: "Web 权威文档", recommended: true },
      { id: "jsonplaceholder", name: "JSONPlaceholder", url: "https://jsonplaceholder.typicode.com/", desc: "免费假 REST API，练手必备" },
    ],
  },
  {
    id: "db",
    title: "免费数据库 & 后端",
    icon: "🗄️",
    items: [
      {
        id: "supabase",
        name: "Supabase",
        url: "https://supabase.com/",
        desc: "Postgres + 认证 + 存储，免费额度大",
        recommended: true,
      },
      {
        id: "neon",
        name: "Neon",
        url: "https://neon.tech/",
        desc: "Serverless Postgres，支持分支",
        recommended: true,
      },
      {
        id: "turso",
        name: "Turso",
        url: "https://turso.tech/",
        desc: "边缘 SQLite，免费 9GB",
        recommended: true,
      },
      {
        id: "upstash",
        name: "Upstash Redis",
        url: "https://upstash.com/",
        desc: "按量计费 Redis，免费 1 万命令/天",
        recommended: true,
      },
      {
        id: "mongo",
        name: "MongoDB Atlas",
        url: "https://www.mongodb.com/atlas",
        desc: "文档数据库，免费 512MB 集群",
      },
      {
        id: "planetscale",
        name: "PlanetScale",
        url: "https://planetscale.com/",
        desc: "MySQL 兼容，免费 5GB 存储",
      },
      {
        id: "appwrite",
        name: "Appwrite",
        url: "https://appwrite.io/",
        desc: "开源 BaaS，可云端用也可自部署",
        recommended: true,
      },
      {
        id: "firebase",
        name: "Firebase Spark",
        url: "https://firebase.google.com/",
        desc: "免费套餐含数据库/托管/认证",
      }
    ],
  },
  {
    id: "api",
    title: "免费 API & 数据",
    icon: "🔌",
    items: [
      {
        id: "publicapis",
        name: "Public APIs 清单",
        url: "https://github.com/public-apis/public-apis",
        desc: "数千个免费 API 汇总，找数据第一站",
        recommended: true,
      },
      {
        id: "dummyjson",
        name: "DummyJSON",
        url: "https://dummyjson.com/",
        desc: "假数据 REST API，练手/原型首选",
        recommended: true,
      },
      {
        id: "nominatim",
        name: "Nominatim",
        url: "https://nominatim.org/",
        desc: "OpenStreetMap 地理编码，完全免费",
        recommended: true,
      },
      {
        id: "frankfurter",
        name: "Frankfurter",
        url: "https://frankfurter.app/",
        desc: "汇率 API，无需 Key，开源",
      },
      {
        id: "restcountries",
        name: "REST Countries",
        url: "https://restcountries.com/",
        desc: "国家信息 API，做下拉框很方便",
      },
      {
        id: "openweather",
        name: "OpenWeatherMap",
        url: "https://openweathermap.org/api",
        desc: "天气数据，免费额度够做练手项目",
      },
      {
        id: "pokeapi",
        name: "PokeAPI",
        url: "https://pokeapi.co/",
        desc: "宝可梦数据，零门槛，适合教学",
      },
      {
        id: "nasa",
        name: "NASA Open APIs",
        url: "https://api.nasa.gov/",
        desc: "天文图片、火星车照片等，免费 Key",
      }
    ],
  },
  {
    id: "design",
    title: "免费设计 & 素材",
    icon: "🎨",
    items: [
      {
        id: "unsplash",
        name: "Unsplash",
        url: "https://unsplash.com/",
        desc: "高质量免费可商用图片",
        recommended: true,
      },
      {
        id: "pexels",
        name: "Pexels",
        url: "https://www.pexels.com/",
        desc: "免费图片与视频素材",
      },
      {
        id: "pixabay",
        name: "Pixabay",
        url: "https://pixabay.com/",
        desc: "图片/插画/音效，免版权",
      },
      {
        id: "undraw",
        name: "unDraw",
        url: "https://undraw.co/",
        desc: "可改色的开源插画 SVG",
        recommended: true,
      },
      {
        id: "svgrepo",
        name: "SVG Repo",
        url: "https://www.svgrepo.com/",
        desc: "数十万免费 SVG 图标",
      },
      {
        id: "gfonts",
        name: "Google Fonts",
        url: "https://fonts.google.com/",
        desc: "免费开源字体库，可直接引用",
        recommended: true,
      },
      {
        id: "fa",
        name: "Font Awesome 免费版",
        url: "https://fontawesome.com/",
        desc: "最常用的免费图标集",
      },
      {
        id: "coolors",
        name: "Coolors",
        url: "https://coolors.co/",
        desc: "配色方案生成器，可查对比度",
      }
    ],
  },
  {
    id: "learn",
    title: "免费学习 & 路线",
    icon: "📚",
    items: [
      {
        id: "fcc",
        name: "freeCodeCamp",
        url: "https://www.freecodecamp.org/",
        desc: "免费全栈课程 + 证书，公认良心",
        recommended: true,
      },
      {
        id: "odin",
        name: "The Odin Project",
        url: "https://www.theodinproject.com/",
        desc: "开源全栈学习路线，项目驱动",
      },
      {
        id: "roadmap",
        name: "Roadmap.sh",
        url: "https://roadmap.sh/",
        desc: "各岗位技能路线图，方向感神器",
        recommended: true,
      },
      {
        id: "liaoxuefeng",
        name: "廖雪峰的官方网站",
        url: "https://www.liaoxuefeng.com/",
        desc: "中文教程，Java/Python/JS 都讲得清楚",
        recommended: true,
      },
      {
        id: "runoob",
        name: "菜鸟教程",
        url: "https://www.runoob.com/",
        desc: "中文速查，随用随翻",
      },
      {
        id: "mitocw",
        name: "MIT OpenCourseWare",
        url: "https://ocw.mit.edu/",
        desc: "MIT 全部课程免费开放",
      }
    ],
  },
  {
    id: "monitor",
    title: "免费监控 & 分析",
    icon: "📊",
    items: [
      {
        id: "uptimerobot",
        name: "UptimeRobot",
        url: "https://uptimerobot.com/",
        desc: "免费 50 个网站可用性监控",
        recommended: true,
      },
      {
        id: "cf-analytics",
        name: "Cloudflare Web Analytics",
        url: "https://www.cloudflare.com/web-analytics/",
        desc: "免费、轻量、不侵隐私的站点统计",
        recommended: true,
      },
      {
        id: "umami",
        name: "Umami",
        url: "https://umami.is/",
        desc: "开源统计，可自部署，界面干净",
        recommended: true,
      },
      {
        id: "sentry",
        name: "Sentry",
        url: "https://sentry.io/",
        desc: "错误监控，免费额度够小项目用",
        recommended: true,
      },
      {
        id: "betterstack",
        name: "Better Stack Uptime",
        url: "https://betterstack.com/uptime",
        desc: "监控 + 状态页，免费档可用",
      },
      {
        id: "ga",
        name: "Google Analytics",
        url: "https://analytics.google.com/",
        desc: "功能最全的免费网站分析",
      }
    ],
  },
  {
    id: "domain2",
    title: "更多免费域名",
    icon: "🎁",
    items: [
      {
        id: "euorg",
        name: "eu.org",
        url: "http://www.eu.org/",
        desc: "历史最久的免费域名，审核慢但永久",
        recommended: true,
      },
      {
        id: "duckdns",
        name: "DuckDNS",
        url: "https://www.duckdns.org/",
        desc: "免费动态 DNS 子域名，适合家里 NAS",
        recommended: true,
      },
      {
        id: "desec",
        name: "deSEC",
        url: "https://desec.io/",
        desc: "免费 DNS 托管，原生支持 DNSSEC",
        recommended: true,
      },
      {
        id: "freedns",
        name: "FreeDNS (afraid.org)",
        url: "https://freedns.afraid.org/",
        desc: "老牌免费域名与 DNS 服务",
      },
      {
        id: "noip",
        name: "No-IP",
        url: "https://www.noip.com/",
        desc: "动态 DNS 老牌子，免费需定期确认",
      }
    ],
  },
  {
    id: "deploy2",
    title: "更多免费部署",
    icon: "📃",
    items: [
      {
        id: "netlify",
        name: "Netlify",
        url: "https://www.netlify.com/",
        desc: "静态站托管，表单/函数都免费额度",
        recommended: true,
      },
      {
        id: "render",
        name: "Render",
        url: "https://render.com/",
        desc: "静态站与 Web 服务，免费档会休眠",
      },
      {
        id: "surge",
        name: "Surge",
        url: "https://surge.sh/",
        desc: "一条命令发布静态站，CLI 党最爱",
      },
      {
        id: "everland",
        name: "4EVERLAND",
        url: "https://www.4everland.org/",
        desc: "Web3 风格托管，支持 IPFS 与免费额度",
        recommended: true,
      }
    ],
  },
  {
    id: "host2",
    title: "更多免费主机",
    icon: "🖥️",
    items: [
      {
        id: "awardspace",
        name: "AwardSpace",
        url: "https://www.awardspace.com/",
        desc: "1GB 存储 / 5GB 月流量的免费 PHP 主机",
      },
      {
        id: "freehostia",
        name: "Freehostia",
        url: "https://www.freehostia.com/",
        desc: "250MB 存储，小站点够用",
      }
    ],
  },
  {
    id: "ai2",
    title: "更多免费 AI 额度",
    icon: "🧰",
    items: [
      {
        id: "groq",
        name: "Groq",
        url: "https://groq.com/",
        desc: "推理速度极快，免费 API 额度大方",
        recommended: true,
      },
      {
        id: "openrouter",
        name: "OpenRouter",
        url: "https://openrouter.ai/",
        desc: "一个 Key 调多家模型，有 :free 后缀免费模型",
        recommended: true,
      },
      {
        id: "cf-ai",
        name: "Cloudflare Workers AI",
        url: "https://developers.cloudflare.com/workers-ai/",
        desc: "边缘推理，每天免费额度",
        recommended: true,
      }
    ],
  }
];

