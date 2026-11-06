# 配置新词雷达的信源

雷达复用站内已经公开的标题、摘要和原文地址。新增信源继续经过站内的采集、去重、分析和发布流程。打开后台的「信源 → 新建」，选择对应类型，粘贴下面的配置，先预览再启用。选择参与编辑流程的来源，开启采集后，雷达下一次扫描即可读到进入公开资料池的内容。

## 已有订阅

示范站已配好 Hugging Face Blog、GitHub Blog 的 AI 与机器学习频道，以及 OpenAI、DeepMind 等机构的 RSS。已接入的 X 账号同样可以提供公开线索。雷达直接复用这些材料，无需再买一次 X 数据。可以在「RSS」类型中增加厂商博客或所关注仓库的发布订阅，如 `https://github.com/OWNER/REPO/releases.atom`。

## GitHub 新仓库

在「JSON 列表」中使用如下配置。它按创建时间倒序读取发布组织最新的 30 个公开仓库，用仓库描述和创建日期提供线索。把 URL 中的 `huggingface` 换成你关注的 GitHub 组织。建议每小时扫描一次。需要提高 GitHub 请求配额时，把 `GITHUB_TOKEN` 放在服务端环境中。

```json
{
  "url": "https://api.github.com/orgs/huggingface/repos?type=public&sort=created&direction=desc&per_page=30",
  "titlePaths": ["full_name"],
  "captureGithubStars": true,
  "fetchPublicContent": true,
  "summaryPaths": ["description"],
  "authorPaths": ["owner.login"],
  "publishedAtPath": "created_at",
  "urlTemplate": "{raw:html_url}",
  "allowUrlPrefixes": ["https://github.com/"],
  "_aihot": {"initialBackfillLimit": 4, "initialBackfillMonths": 1}
}
```

首次导入限制为最近一个月最多四项。后续的历史准入遵循站内规则。雷达页面的证据分衡量公开报道的覆盖情况。若跟踪具体仓库的版本发布，可使用上面的 Releases Atom。接口参数见 [GitHub 官方文档](https://docs.github.com/en/rest/repos/repos#list-organization-repositories)。

开启 `captureGithubStars` 后，原有采集请求每天第一次成功时会保存当时的星数。每个信源只保留最近两个采样日，各最多 100 个公开仓库。爆发榜列出创建在 14 天内且已进入本站公开资料池的仓库。满足以下任一条件即可入榜。

- 从创建至采样时平均每天达到 200 星，仓库年龄不足一天时按一天计算。
- 相比前一个 UTC 日的实际样本，净增至少 400 星。两次采样须相隔 18–30 小时，且 GitHub 仓库 ID 相同。初次采样、缺日或样本不可比时，日增量留空。

查看 `GET /api/v1/term-radar/github` 可获取仓库原址、实测星数、采样时间、日增量和平均增速。结果限最近 24 小时的采样。暂停信源、关闭星数采样或撤回对应公开资料后，该来源的数据会退出公开榜。

## Hugging Face 模型列表

选择「JSON 列表」。此示例读取 Hub 热门模型中的前 30 项，详情页提供进一步的模型卡材料。可以给 URL 增加 `author` 查询参数来跟踪指定机构。示例按模型创建日期进入站内时间线。

```json
{
  "url": "https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=30&expand=createdAt",
  "titlePaths": ["id"],
  "publishedAtPath": "createdAt",
  "urlTemplate": "https://huggingface.co/{id}",
  "allowUrlPrefixes": ["https://huggingface.co/"],
  "fetchPublicContent": true,
  "_aihot": {"initialBackfillLimit": 4, "initialBackfillMonths": 1}
}
```

从热门榜发现的旧模型沿用本身的创建日期。此配置没有保存榜单名次、下载量或星数的逐日变化。字段说明见 [Hugging Face 官方文档](https://huggingface.co/docs/huggingface_hub/main/package_reference/hf_api#huggingface_hub.HfApi.list_models)。

## 产品目录的 Sitemap

选择「网页列表」，把示例域名替换为要跟踪的网站。使用包含具体页面的 XML 文件（根节点 `urlset`，最多 5,000 项）。网站提供 `sitemapindex` 时，选其中与目标栏目对应的子文件。把 `allowUrlPrefixes` 设到产品或文章目录。

```json
{
  "url": "https://example.org/tools-sitemap.xml",
  "parseMode": "sitemap",
  "allowUrlPrefixes": ["https://example.org/tools/"],
  "detail": {"maxFetches": 5, "titleSelector": "h1", "titleAuthoritative": true}
}
```

第一次成功采集只记住已有 URL。从第二次起，初始清单以外的同源页面按站内常规规则读取和去重。替换 Sitemap 地址会建立新的基线。预览可检查解析出来的地址和标题，预览不会推进基线。

新闻 Sitemap 的 `news:title` 和 `news:publication_date` 可直接提供文章标题、发布日期；常规 Sitemap 的 `lastmod` 只记为页面更新时间。没有标题时先取 URL 末段，配置了上述详情规则后尝试读取页面的真实标题和发布日期。未提供可靠日期的页面沿用站内的未知时间处理规则。
