# Cloudflare Pages CPU 优化验证

## 实现与边界

- `src/worker.ts` 在 Astro 路由匹配之前查询 `caches.default`。命中直接返回最终响应；未命中继续调用官方 Cloudflare `handle`，保留运行时绑定、静态资源处理和 Cookie 收尾。
- Cloudflare 入口使用 `new App(manifest, false)` 输出完整 HTML，避免流式片段处理。在本地 workerd 的 `2026-01-14` 兼容日期下，Astro 5 默认流式实现会把 Workers 的 Node 兼容环境识别成 Node，最终输出 `[object Object]`；非流式入口在该日期和 `2024-09-23` 下都通过验证。这会缓冲整页，推迟冷请求的首字节并增加峰值内存；它是当前兼容性折中，不是流式性能优化，也没有验证生产峰值内存始终低于 128 MB。
- 缓存键包含原始域名、路径、完整查询参数及每次构建生成的命名空间。频道、标签、搜索词和分页不会相互混用；新部署不会命中旧构建的 HTML。
- 仅已知的公开页面、RSS、manifest 和 sitemap 路由参与缓存。Cookie、Authorization、Range、强制重新验证等请求绕过缓存；非 200、Set-Cookie、Vary、private/no-store/no-cache 等响应不写入。
- 缓存写入通过 `waitUntil` 完成。Cache API 读取或写入失败不会让成功的渲染变成错误。首批并发请求可能重复渲染；Cache API 本身不提供跨 isolate 锁或跨数据中心共享。
- HTML 沿用 1,800 秒的共享缓存 TTL，RSS 沿用 3,600 秒。没有实现 Cache API 的后台过期刷新；HTTP `stale-while-revalidate` 不等于 Cache API 会自动执行刷新。
- 缓存填充时保留已有 ETag，否则读取正文并生成 SHA-256 弱 ETag。相同字节在驱逐、过期后的重新填充仍得到相同标记；内容变化时标记改变。仅未命中付出正文读取、缓冲和散列成本，命中直接比较已保存的标记。`If-None-Match` 按 RFC 9110 §13.1.2 使用弱比较，忽略两侧 `W/`；使用弱 ETag 允许边缘改变传输编码。
- Telegram 原始 HTML 只合并正在进行的相同请求。Cheerio 使用 htmlparser2 的 HTML 片段模式；源页面的解析结果供时间线、频道筛选、RSS、搜索和 sitemap 复用。htmlparser2 不提供完整 HTML5 树修复；回归测试覆盖实体、空元素、自定义标签、错误嵌套格式标签和缺失段落结束标签，但不能保证任意畸形上游文档都与原解析器一致，仍需上线观察真实返回内容。
- 解析结果、聚合页面和单篇数据共用一个 LRU，最多 256 项、约 8 MiB 估算预算，5 分钟新鲜期、24 小时错误回退保留期。对象冻结后共享，命中路径不再 `structuredClone`。空间估算遍历属性和字符串长度，不再 `JSON.stringify` 或 UTF-8 编码记账。预算不是总堆内存上限。共享域类型标记为只读；新渲染分支若确需修改数据，应先构造自己的对象，不能修改缓存 props。运行时冻结有助于暴露误写，但未覆盖的误写分支仍可能抛出 TypeError。
- 源页面刷新失败会向上层传播，上层可返回旧的聚合结果；不会把底层旧数据包装成新的 5 分钟新鲜结果。
- 代码高亮移到浏览器 Web Worker：接近视口时才加载，逐块处理，已处理节点不重复执行。优先使用 Telegram 的语言标注，无标注时用 flourite 识别，再按需加载 Prism 语法。服务端只输出经过转义的文本、缩进、换行和语言提示，浏览器主线程仅提交文本并插入 Prism 产生的 token；正文与订阅仍执行安全清洗。禁用 JS、Worker 出错/超时、未知语言或超过 100,000 字符时保留纯文本。没有代码的页面不创建高亮 Worker。日期格式器按语言和时区复用，并设条目上限。

## 测量方法与结果

测量日期：2026-10-29。改造前后使用同一台 Windows 主机、Node v25.1.0，以及同一份合成 Telegram 页面：24 条帖子，每条含 80 个三行 YAML 配置项，原始 HTML 为 132,958 字节。这里没有使用生产频道快照，也没有包含 Telegram 网络时间。

`benchmarks/cpu.bench.ts` 使用 `process.cpuUsage()` 测批次 CPU，再取五批的中位数。Windows 进程 CPU 计数较粗，极短操作可能读为零；脚本也输出 Vitest 的本地 wall-time 分布。两者均不是 Cloudflare 的请求 CPU 计费指标，也不是网站整体 p50。

| 阶段（每页 24 条）       | 改造前本地 CPU | 改造后本地 CPU |
| ------------------------ | -------------: | -------------: |
| Cheerio 建树             |       约 11 ms |      约 1.5 ms |
| 建树、提取与内容转换     |      约 473 ms |    约 11–13 ms |
| 页面内容安全清洗         |      约 149 ms |  约 2.0–2.4 ms |
| 较旧帖子日期格式化       |      约 5.5 ms |    约 0.125 ms |
| JSON 序列化与 UTF-8 记账 |     约 3.15 ms | 生产缓存已移除 |
| 解析结果深拷贝           |      约 0.8 ms | 生产缓存已移除 |

“建树、提取与内容转换”包含 Cheerio 建树，表中各行不能直接相加。单独拆分旧实现时，flourite 的 24 次识别约占 195 ms，Prism YAML 高亮约占 27 ms；高亮后大量 token span 的构建和再解析也会增加成本。约 473 ms → 11–13 ms 的变化包含把语言识别和高亮移出服务端的收益，不能全部归因于解析算法优化。浏览器仍然承担识别、分词和 token DOM 成本，以下服务端基准没有计入这些工作。

解析结果 JSON 大小从 1,111,189 字节降至 270,229 字节，约减少 76%。这是当时仅输出服务端代码文本的对照数据，不含浏览器高亮后生成的 token DOM；这也解释了服务端安全清洗大幅变快。当时响应缓存命中包装逻辑在**模拟 Cache API**下约为 0.033 ms CPU；该值不含 Cloudflare Cache API 和平台调度，不能作为线上低于 3 ms 的证明。

后续使用 Node v22.23.4 增加了代码换行表示的对照：同样 24 条代码帖，普通换行的冷解析约 12.5 ms，而用 `<br>` 表示换行时约 48.4 ms。改为直接读取代码节点中的换行，并让 URL/样式处理只选择相关属性节点后，`<br>` 样本降至约 17.2 ms（减少约 64%），普通换行样本约 10.9 ms。这个对照使用同一 Node 22 进程环境，不能与上表的 Node 25 数值直接混算；仍未计入 Astro 渲染和平台成本。

客户端高亮恢复后，用 Node v22.23.4 再次运行完整基准：普通换行的解析/转换批次 CPU 中位数为 20.300 ms，`<br>` 样本为 35.150 ms；Vitest 同次 wall-time 均值分别为 11.215 ms 和 26.922 ms。正文读取加 SHA-256 为 1.397 ms CPU、0.790 ms wall time，模拟响应缓存命中包装为 0.111 ms CPU、0.031 ms wall time。不同轮次存在明显波动，应保留测量口径及原始输出；不能选择较小的一轮推断线上 p50。特别是内容 ETag 确实增加了冷请求成本。

浏览器测试使用 24 个短代码块，覆盖明确标注的 JSON/YAML/Python 和未标注 YAML。一次无头 Chromium 本地运行中，初次 JSON 任务约 69 ms，首次加载自动识别约 39 ms，库已加载后的短块多在 0.1–3.1 ms。这是发送消息到收到结果的 wall time，包含下载/加载和消息传递，不是纯分词 CPU，不包含 token DOM 插入，也不是移动设备或生产网络性能保证。识别与分词运行在浏览器 Worker；主线程仍需插入和绘制 token。

完整功能门禁使用 Node v22.23.4，24 个测试文件中的 222 项测试和 TypeScript 检查通过。本地 workerd 验证使用适配器自带的 Miniflare/workerd 和固定 Telegram 数据，覆盖以下路径：

- 首页、单频道首页、单篇帖子、带频道的单篇/标签/链接页面、前后翻页、RSS XML/JSON、sitemap、带频道的标签搜索：`MISS → HIT → 304`。
- 命中期间无新增 Telegram 请求，HEAD 无响应正文。
- Cookie / Authorization 绕过缓存，未知频道返回 404，非法分页游标重定向到选定频道首页。
- `/static/https://telegram.me/fixture.png` 仍返回媒体响应并保留 `nosniff` 和沙箱 CSP。
- 无头 Chromium：桌面与 390px 手机视口、24 个代码块、频道筛选、单篇页面；无横向溢出或页面脚本错误。所有代码块滚动到视口后有 token span 和不同颜色，文本与禁用 JS 时逐字相同；初次只处理视口附近的 3 个代码块，重复 `astro:page-load` 不重复处理；无代码页不创建 Worker，Worker 不可用时保留文本。

## 本地复现

使用 Node 22 和仓库指定的 pnpm。先执行正常门禁：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm bench:cpu
```

PowerShell 中构建并验证 Cloudflare 产物：

```powershell
$env:SERVER_ADAPTER = 'cloudflare_pages'
pnpm build
pnpm verify:cloudflare
```

验证脚本只使用本地固定数据，不请求真实 Telegram。`node scripts/verify-cloudflare.mjs --serve` 会保留本地预览服务并打印地址。`CF_TEST_COMPATIBILITY_DATE` 可覆盖测试的兼容日期；`CF_TEST_SITE` 应与当前构建的 `site` 一致，默认使用 main 分支的正式站点地址。它们仅影响验证脚本。

浏览器回归脚本需要 Python Playwright 和 Chromium。预览服务启动后，使用打印的地址运行 `python scripts/verify-highlighting.py http://127.0.0.1:PORT`。脚本检查客户端高亮、无 JS 文本和 Worker 失败回退，截图保存在被 Git 忽略的 `.workbuddy/`。Python 浏览器检查目前是本地手动门禁，未加入 GitHub CI。

GitHub CI 在原有 Node 构建之后，额外执行 Cloudflare 构建和 workerd 检查。CI 用 `--site https://cloudflare-test.example` 指定测试域名，并将相同值传给验证脚本；不会修改三个部署分支各自的正式 `site`，也不会发布该测试产物。

基准中的旧 JSON 和深拷贝项目保留为对照操作；它们不再属于生产请求路径。合成样本比较偏向代码密集情况，不能代表所有频道或实际缓存命中率。

## 部署后的验收

本次改动没有部署或修改 Cloudflare 账户，目标“p50 CPU < 3 ms、24 小时错误 < 50 次”尚未得到线上确认。

1. 部署后，在同一域名和网络位置重复 GET 相同 URL，确认最终出现 `X-Response-Cache: HIT`。不要用 HEAD 做缓存预热；HEAD 未命中时不会写入缓存。使用浏览器强制刷新或携带 Cookie 的请求也可能绕过缓存。
2. 用 HIT 响应的 ETag 发 `If-None-Match` 请求，确认 304；分别检查 `?channel=`、标签、RSS 与分页地址。检查无 Cookie 的普通请求，避免把有登录态的请求误算为缓存未生效。
3. 从部署完成后的完整 24 小时窗口读取 Cloudflare CPU p50/p99、请求数、错误数和 CPU 超限事件，单独比较缓存命中、未命中及绕过请求。平台 HTTP 缓存状态不一定反映自定义 Cache API 路径，应以应用的响应头作为辅助诊断。
4. 目标验收使用线上数值：p50 < 3,000µs，24 小时错误 < 50。若尚未达到，优先统计高基数 URL、不同数据中心、Cookie 绕过及冷渲染比例，再根据证据处理剩余成本。

这份代码密集合成样本即使优化后，冷解析仍可能超过 10 ms；Astro 渲染也需要额外 CPU。最终响应缓存大幅降低重复请求成本，但不能保证任何内容、任何冷请求都满足免费套餐限制，错误数目标需要上述线上窗口确认。
