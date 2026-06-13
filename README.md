# 广播频道

**将你的 Telegram Channel 转为微博客。**

---

## ✨ 特性

- **将 Telegram Channel 转为微博客**
- **SEO 友好** `/sitemap.xml`
- **浏览器端 0 JS**
- **提供 RSS 和 RSS JSON** `/rss.xml` `/rss.json`

## 🪧 演示

### 真实用户

- [面条实验室](https://memo.miantiao.me/)
- [Find Blog👁发现博客](https://broadcastchannel.pages.dev/)
- [Memos 广场 🎪](https://now.memobbs.app/)
- [APPDO 数字生活指南](https://mini.appdo.xyz/)
- [85.60×53.98卡粉订阅/提醒](https://tg.docofcard.com/)
- [新闻在花频道](https://tg.istore.app/)
- [ALL About RSS](https://blog.rss.tips/)
- [Charles Chin's Whisper](https://memo.eallion.com/)
- [PlayStation 新闻转发](https://playstationnews.pages.dev)
- [Yu's Life](https://daily.pseudoyu.com/)
- [Leslie 和朋友们](https://tg.imlg.co/)
- [OKHK 分享](https://tg.okhk.net/)
- [gledos 的微型博客](https://microblogging.gledos.science)
- [Steve Studio](https://tgc.surgeee.me/)
- [LiFePO4:沙雕吐槽](https://lifepo4.top)
- [Hotspot Hourly](https://hourly.top/)
- [大河马中文财经新闻分享](https://a.xiaomi318.com/)
- [\_My. Tricks 🎩 Collection](https://channel.mykeyvans.com)
- [小报童专栏精选](https://xiaobaotong.genaiprism.site/)
- [Fake news](https://fake-news.csgo.ovh/)
- [miyi23's Geekhub资源分享](https://gh.miyi23.top/)
- [Magazine｜期刊杂志｜财新周刊](https://themagazine.top)
- [Remote Jobs & Cooperation](https://share-remote-jobs.vercel.app/)
- [甬哥侃侃侃--频道发布](https://ygkkktg.pages.dev)
- [Fugoou.log](https://fugoou.xyz)
- [Bboysoul的博客](https://tg.bboy.app/)
- [MakerHunter](https://share.makerhunter.com/)
- [ChatGPT/AI新闻聚合](https://g4f.icu/)
- [Abner's memos](https://memos.abnerz6.top/)
- [小众软件的发现](https://talk.appinn.net/)
- [小报童优惠与排行榜](https://youhui.xiaobaoto.com/)
- [热干面拌 10 号土豆泥](https://memo.moran.im/)
- [万事屋工程部](https://t.wanshiwu.fyi/)

### 平台

1. [Cloudflare](https://broadcast-channel.pages.dev/)
2. [Netlify](https://broadcast-channel.netlify.app/)
3. [Vercel](https://broadcast-channel.vercel.app/)

广播频道支持部署在 Cloudflare Pages、Netlify、Vercel 等支持 Node.js SSR 的无服务器平台或者 VPS。
具体教程见[部署你的 Astro 站点](https://docs.astro.build/zh-cn/guides/deploy/)。

## 🧱 技术栈

- 框架：[Astro](https://astro.build/)
- 内容管理系统：[Telegram Channels](https://telegram.org/tour/channels)
- 模板: [Sepia](https://github.com/Planetable/SiteTemplateSepia)

## 🏗️ 部署

### Docker

1. `docker pull ghcr.io/miantiao-me/broadcastchannel:main`
2. `docker run -d --name broadcastchannel -p 4321:4321 -e CHANNEL=miantiao_me ghcr.io/miantiao-me/broadcastchannel:main`

### Serverless

1. [Fork](https://github.com/miantiao-me/BroadcastChannel/fork) 此项目到你 GitHub
2. 在 Cloudflare Pages/Netlify/Vercel 创建项目
3. 选择 `BroadcastChannel` 项目和 `Astro` 框架
4. 配置环境变量 `CHANNEL` 为你的频道名称。此为最小化配置，更多配置见下面的配置项
5. 保存并部署
6. 绑定域名（可选）。
7. 更新代码，参考 GitHub 官方文档 [从 Web UI 同步分叉分支](https://docs.github.com/zh/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork#syncing-a-fork-branch-from-the-web-ui)。

### Cloudflare Pages

Cloudflare Pages 部署使用 Astro 5 和 `@astrojs/cloudflare` v12 的 Pages SSR 适配器。构建命令填写 `pnpm build`，构建输出目录填写 `dist`，并在 Pages 环境变量中配置 `CHANNEL` 等变量。

## ⚒️ 配置

```env
## Telegram 频道用户名，必须配置。 t.me/ 后面那串字符
## 支持配置多个频道，使用英文逗号分割，例如：channel1,channel2
## 注意：配置在第一个位置的是“主频道”，主频道发布的内容 URL 和 RSS 不会带频道前缀（如 /posts/123），以保证老链接向下兼容
## 后续的其他频道会带上频道前缀（如 /posts/channel2-123）
CHANNEL=miantiao_me

## 语言和时区设置，使用 Intl/BCP 47 语言代码，例如 zh-CN 或 en
LOCALE=zh-CN
TIMEZONE=Asia/Shanghai

## 站点品牌信息，留空时使用 Telegram 频道信息
SITE_NAME=茉灵智库
SITE_LOGO=https://example.com/logo.png
SITE_DESCRIPTION=聚合 Telegram 频道内容的微型知识库

## 社交媒体用户名
TELEGRAM=miantiao-me
TWITTER=miantiao-me
GITHUB=miantiao-me
MASTODON=mastodon.social/@Mastodon
BLUESKY=bsky.app

## 下面两个社交媒体需要为 URL
DISCORD=https://DISCORD.com
PODCAST=https://PODCAST.com
## 兼容旧变量名 PODCASRT，建议新部署使用 PODCAST
PODCASRT=https://PODCAST.com

## 头部尾部代码注入，支持 HTML
FOOTER_INJECT=FOOTER_INJECT
HEADER_INJECT=HEADER_INJECT

## 顶部公告横幅
SHOW_BANNER=true
BANNER_TEXT=请确保网络环境可正常访问订阅链接。部分链接需代理环境下导入，请自行筛选可用节点，可以点击评论区查看其中分享的节点是否可用！请勿相信网站中的任何广告！

## SEO 配置项，可不让搜索引擎索引内容
NOFOLLOW=false
NOINDEX=false

## 隐藏 Telegram 频道简介
HIDE_DESCRIPTION=false

## Telegram 主机名称和静态资源代理，不建议修改
TELEGRAM_HOST=telegram.dog
STATIC_PROXY=

## 启用谷歌站内搜索
GOOGLE_SEARCH_SITE=memo.miantiao.me

## 启用标签页, 标签使用英文逗号分割
TAGS=标签A,标签B,标签C

## 展示评论
COMMENTS=true

## 展示 Reactions
REACTIONS=true

## 链接页面中的超链接, 使用英文逗号和分号分割
LINKS=Title1,URL1;Title2,URL3;Title3,URL3;

## 侧边栏导航项, 使用英文逗号和分号分割
NAVS=Title1,URL1;Title2,URL3;Title3,URL3;

## 启用 RSS 美化
RSS_BEAUTIFY=true

## 过滤所有包含图片的帖子（常用于过滤广告）
FILTER_IMAGES=true

## 过滤 Telegram 文件消息
FILTER_FILES=true

## 过滤包含特定关键词的帖子，使用英文逗号分割
AD_KEYWORDS=广告,推广,赞助
```

## 品牌自定义

默认情况下，站点标题和 logo 会从 Telegram 主频道读取。如果你不想使用频道名称和频道头像，可以配置站点品牌信息：

```env
SITE_NAME=茉灵智库
SITE_LOGO=https://example.com/logo.png
SITE_DESCRIPTION=聚合 Telegram 频道内容的微型知识库
```

- `SITE_NAME` 会覆盖导航标题、SEO 标题、RSS 标题和 manifest 名称。
- `SITE_LOGO` 会覆盖导航 logo、单篇页 breadcrumb logo、分享图和 manifest 图标。支持完整 URL，也支持站内路径，例如 `/logo.png`。
- `SITE_DESCRIPTION` 会覆盖 SEO 描述和 RSS 描述。
- `HIDE_DESCRIPTION` 保持原行为，只控制是否展示 Telegram 频道简介；它不会被 `SITE_DESCRIPTION` 替代。

## 🙋🏻 常问问题

1. 为什么部署后内容为空？
   - 检查频道是否是公开的，必须是公开的
   - 频道用户名是字符串，不是数字
   - 关闭频道 Restricting Saving Content 设置项
   - 修改完环境变量后需要重新部署
   - Telegram 会屏蔽一些敏感频道的公开展示， 可以通过访问 `https://t.me/s/频道用户名` 确认
