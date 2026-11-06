# 新词雷达

在 `/radar` 看本站最近观察到的产品名、工具名和技术词。每个词都有可打开的原文、本站首次观察日期、证据分和 14 天复盘。APP 机会是模型从材料提出的待验证假设。市场搜索量、平台总讨论量、收入和下载量都需要各自的数据源。

## 启用

部署所用的分支应包含 `modules/term-radar`。在仓库根目录编辑服务端 `.env`。下面的地址和模型名请换成你的实际值。模型接口须支持 `POST /chat/completions`，Docker 中的地址须能从 worker 容器访问。

```dotenv
TERM_RADAR_ENABLED=true
LLM_BASE_URL=https://your-model.example/v1
LLM_MODEL=your-model-id
LLM_API_KEY=your-provider-key
LLM_EXTRA_JSON={}
MODEL_CALLS_ENABLED=true
```

`LLM_*` 是全站的默认模型配置，适用于新词识别、分类和机会分析，也适用于现有编辑流程中使用默认模型的步骤。模型服务不支持 `response_format` 时设置 `LLM_JSON_MODE=false`。如果已有可用的模型配置，通常只需打开 `TERM_RADAR_ENABLED`。要让雷达单独选用一个已注册的模型预设，可设 `TERM_RADAR_MODEL` 或在后台「模型与评测」选择新词分析步骤。自建接口允许免认证时，显式设置 `LLM_ALLOW_KEYLESS=true` 并将 `LLM_API_KEY` 留空，默认模型就会省略认证请求头。

```bash
docker compose up -d --build
docker compose exec worker npm run radar:scan
```

首次部署的 setup 容器会完成迁移。已有站点可用 `docker compose run --rm setup` 更新数据库。访问 `/radar` 看结果，或请求 `GET /api/v1/term-radar`。后台「运行」记录定时任务 `term-radar.scan`。在宿主机运行需要 Node.js 24、Python 3.11 或更新版及 PostgreSQL；执行 `npm ci`、`npm run db:migrate` 后运行 `npm run radar:scan`。

默认关闭定时扫描。启用后每天北京时间 08:15 运行一次；手动命令立即扫描。每次读取过去 48 小时内最新的 200 篇符合公开条件且有发布日期的资料。每轮最多将其中最新的 8 篇交给模型，每篇最多提取 3 个词；其余资料按发布标题规则识别。重复扫描同一模型和相同输入时复用调用回执。结果反映这批材料的覆盖范围。空站点先到信源后台启用采集，等待资料进入公开池。已收录的 X 来源可直接复用，GitHub、Hugging Face、RSS、Sitemap 的设置见[雷达信源](radar-sources.md)。

## 看懂结果

- **新词**指本站首次观察到的词。模型须给出包含该词的证据；相同词名跨报道归并，同一报道重复扫描只计一次。
- **证据分**根据卡片中的独立来源、报道数量和最近新增证据日期计算。每个词最多保留 20 条卡片引文，榜单最多显示 50 个近 30 天仍有新证据的词。
- **趋势**按 UTC 日历日显示近 14 天卡片证据的新增篇数。0 表示当天有可用扫描但没有新增引文，空缺表示没有可用观察或早于该词首次发现。
- **14 天复盘**检查从发现日到第 14 天是否有后续发布、且在该期间被本站观察到的新报道。观察不足会单独标记。用户可用证据链接自行核查。
- **GitHub 增长**可在 GitHub JSON 信源上单独开启。雷达复用采集响应中的真实星数，显示达到条件的新仓库；相邻两天没有可比观测时，日增量留空。独立接口为 `GET /api/v1/term-radar/github`，设置及门槛见[雷达信源](radar-sources.md)。
- **APP 机会**由模型描述具体需求或使用场景。没有支持材料时留空。雷达不会用模型填补搜索量、GitHub 星数增速、付费意愿等缺失指标。

## 实现和备份

热点采集、付费请求回执和预算控制使用原有后端。定时任务把公开标题和摘要整理成版本化 JSON，Python 子进程负责去重、历史观察和复盘，再把 JSON 快照交回 PostgreSQL。访问网页和公开接口只读最新快照。证据撤回或更正后，依赖旧证据的条目在读取时被过滤。

PostgreSQL 的 `term_radar_snapshots` 按 UTC 日保存快照，同日重跑更新该日结果。Python 的增量观察状态保存在 `AIHOT_DATA_DIR/term-radar/history.sqlite`，Docker 对应 `/data/term-radar/history.sqlite`。迁移服务器时备份数据库和数据卷；复制 SQLite 文件前先停 worker，或使用 SQLite 在线备份。

要将计算与站点分开运行，可将 JSON 交给另一台机器的 Python，再把结果带回站点。导入命令仅供管理员在本机执行。应只导入本站可信 worker 生成的结果，使用同一份持久化历史，避免两台机器各自重新计算首见时间。

```bash
npm run --silent radar:scan -- export > evidence.json
python3 workers/term-radar/run.py --state .data/term-radar/history.sqlite < evidence.json > snapshot.json
npm run radar:scan -- import snapshot.json
```

上述独立 Python 命令运行离线规则；需要调用站点配置的模型时使用普通的 `npm run radar:scan`。

关闭 `MODEL_CALLS_ENABLED` 后可对已公开资料做规则扫描，识别明确的中英文发布标题，仍会记录证据与复盘。该开关也影响全站其他模型步骤。离线检验 Python 流程可运行：

```bash
python3 -m unittest discover -s workers/term-radar
```

参考项目为 [new-term-radar](https://github.com/zhuyansen/new-term-radar)。本模块将其新词发现、快照与复盘思路适配到本站的证据和任务系统。AIsa、GoAnyAPI 均无需配置。TikTok、Reddit、Google Trends 和商业 SEO 服务的专用采集器可在取得相应数据访问条件后接入。
