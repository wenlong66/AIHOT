import { useState } from "react";
import { useLoaderData } from "react-router";
import { PhoneBar } from "@aihot/web/components/shell/PhoneBar";
import { EmptyState } from "@aihot/web/components/ui/Page";
import { apiGet, cachedPage, loadOr404 } from "@aihot/web/lib/api.server";
import { pageReuse } from "@aihot/web/lib/page-reuse";
import { pageMeta } from "@aihot/web/lib/seo";
import type { githubBreakouts } from "../backend/github";
import type { latestReport } from "../backend/report";

type Report = Awaited<ReturnType<typeof latestReport>>;
type Term = Report["terms"][number];
type GitHubReport = Awaited<ReturnType<typeof githubBreakouts>>;
const kinds = { model: "模型", product: "产品", tool: "工具", repository: "代码仓库", concept: "概念", other: "其他" };
const reviews = { pending: "观察中", follow_up: "已有后续报道", no_follow_up: "未观察到后续报道", insufficient_data: "观察天数不足" };
const intro = "从本站收录的报道中发现新词，观察接下来两周里还有谁在跟进。";

export const handle = { tab: "radar", home: "radar", name: "新词雷达" };
export { pageHeaders as headers } from "@aihot/web/lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: { request: Request }) {
  const upstream = new Headers();
  const [report, github] = await Promise.all([
    loadOr404<Report>("/api/v1/term-radar", { signal: request.signal, responseHeaders: upstream }),
    apiGet<GitHubReport>("/api/v1/term-radar/github", {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(2000)]),
    }).catch(() => ({ items: [] })),
  ]);
  return cachedPage(60, { report, github: github.items }, upstream);
}

export function meta() {
  return pageMeta({ title: "新词雷达", description: intro, path: "/radar" });
}

function Trend({ days }: { days: Term["trend"] }) {
  const peak = Math.max(1, ...days.map(({ count }) => count ?? 0));
  return (
    <figure className="mt-4 rounded-panel bg-well px-4 py-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-ink-2">近 14 天新增报道</span>
        <span className="text-[11.5px] text-ink-3">按雷达首次观察日 · UTC</span>
      </figcaption>
      <ol className="mt-2 flex gap-1">
        {days.map(({ day, count }) => (
          <li key={day} className="flex min-w-0 flex-1 flex-col items-center" title={day + " · " + (count === null ? "无观察" : count + " 篇")}>
            <span className="sr-only">{day}，{count === null ? "无观察" : count + " 篇"}</span>
            <span aria-hidden="true" className="flex h-8 w-full items-end justify-center">
              {count === null ? (
                <span className="w-full border-b border-dashed border-ink-4" />
              ) : (
                <span className="w-full bg-accent" style={{ height: count === 0 ? "2px" : (count / peak) * 100 + "%" }} />
              )}
            </span>
            <span aria-hidden="true" className="num mt-1 text-[11px] text-ink-3">{count ?? "–"}</span>
          </li>
        ))}
      </ol>
      <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-ink-4">
        <span>{days[0]?.day.slice(5)}</span><span>{days.at(-1)?.day.slice(5)}</span>
      </div>
      <p className="mt-1 text-[11.5px] text-ink-3">按卡片保留的原文统计，最多 20 篇。0 表示当天扫描未新增，– 表示无观察记录。</p>
    </figure>
  );
}

function TermCard({ item, rank }: { item: Term; rank: number }) {
  return (
    <article className="card min-w-0 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mono pt-1 text-[13px] font-semibold text-accent">{String(rank).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-[19px] font-bold leading-tight text-ink">{item.term}</h2>
          <p className="mt-1 text-[12px] text-ink-3">{kinds[item.kind]} · {item.sourceCount} 个来源 · {item.evidenceCount} 篇报道</p>
        </div>
        <div className="text-right">
          <div className="mono text-[22px] font-semibold leading-none text-accent">{item.score}</div>
          <div className="mt-1 text-[11px] text-ink-3">证据分</div>
        </div>
      </div>
      {item.summary && <p className="mt-3 text-[14px] leading-relaxed text-ink-2"><strong>关键词分析</strong>　{item.summary}</p>}
      {item.opportunity && <p className="mt-3 rounded-panel bg-accent-softer px-3 py-2 text-[13px] leading-relaxed text-ink-2"><strong className="text-accent">APP 机会 · AI 假设</strong>　{item.opportunity}</p>}
      <Trend days={item.trend} />
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">本站首见 {item.firstSeen} · 最近新增 {item.lastSeen}<br />14 天复盘 · {reviews[item.review.status]} · 到期日 {item.review.dueOn}</p>
      <details className="mt-3 border-t border-line-soft pt-2">
        <summary className="cursor-pointer py-1 text-[13px] font-semibold text-accent">查看原文（{item.evidence.length}）</summary>
        <ul className="divide-y divide-line-soft">
          {item.evidence.map(e => (
            <li key={e.id} className="py-2">
              <a href={e.url} className="break-words text-[14px] text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent">{e.title}</a>
              <p className="mt-0.5 text-[12px] text-ink-3">{e.source} · {e.publishedAt.slice(0, 10)}</p>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function GitHubPanel({ items }: { items: GitHubReport["items"] }) {
  return (
    <details className="card mt-5 p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold text-ink">GitHub 仓库观察（{items.length}）</summary>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-3">收录创建 14 天内的仓库，创建至今日均至少 200 星，或较昨日新增至少 400 星。日均按至少一天计算。</p>
      <ul className="mt-2 divide-y divide-line-soft">
        {items.map(item => (
          <li key={item.repo} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
            <div className="min-w-0">
              <a className="break-all font-semibold text-accent hover:underline" href={item.url}>{item.repo}</a>
              <p className="text-[12px] text-ink-3">{item.createdAt.slice(0, 10)} 创建 · {item.observedAt.slice(0, 10)} 观察</p>
            </div>
            <div className="text-[13px] text-ink-2">{item.stars} 星 · 日均 {item.starsPerDay} 星 · 较昨日 {item.dayDelta === null ? "暂无对照" : (item.dayDelta > 0 ? "+" : "") + item.dayDelta}</div>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function Radar() {
  const { report, github } = useLoaderData<typeof loader>();
  const [opportunities, setOpportunities] = useState(false);
  const withOpportunities = report.terms.filter(t => t.opportunity);
  const visible = opportunities ? withOpportunities : report.terms;
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-12">
      <PhoneBar title="新词雷达" large sub={intro} />
      <header className="hidden pb-4 lg:block">
        <h1 className="text-[26px] font-bold text-ink">新词雷达</h1>
        <p className="mt-1 text-[14px] text-ink-3">{intro}</p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-line-soft py-2">
        <div className="flex gap-1" role="group" aria-label="榜单筛选">
          {[{ label: "新词榜", on: false, count: report.terms.length }, { label: "APP 机会", on: true, count: withOpportunities.length }].map(f => (
            <button type="button" key={f.label} aria-pressed={opportunities === f.on} onClick={() => setOpportunities(f.on)}
              className={`min-h-11 rounded-panel px-3 text-[13px] font-semibold ${opportunities === f.on ? "bg-accent-soft text-accent" : "text-ink-3 hover:text-ink"}`}>
              {f.label} <span className="num">{f.count}</span>
            </button>
          ))}
        </div>
        {report.observedAt && <p className="text-[12px] text-ink-3">最近扫描 <time dateTime={report.observedAt}>{report.observedAt.slice(0, 16).replace("T", " ")} UTC</time></p>}
      </div>
      <p className="my-3 text-[12px] leading-relaxed text-ink-3">
        {opportunities ? "APP 机会来自 AI 对报道的推测，实际需求仍待验证。" : "按证据分排序，计入本站观察到的来源数、报道数和最近新增报道的时间。"}
      </p>
      {visible.length ? (
        <ol className="grid items-start gap-3 xl:grid-cols-2">
          {visible.map((item, i) => <li key={item.key} className="min-w-0"><TermCard item={item} rank={i + 1} /></li>)}
        </ol>
      ) : (
        <div className="card">
          {opportunities && report.terms.length ? (
            <EmptyState title="暂无 APP 机会" action={<button className="text-accent" onClick={() => setOpportunities(false)}>返回新词榜</button>}>当前词条还没有可供验证的应用场景。</EmptyState>
          ) : report.observedAt ? (
            <EmptyState title="本次没有可展示的新词">后续扫描发现带有公开原文的新词后，将在这里更新。</EmptyState>
          ) : (
            <EmptyState title="等待首次扫描">首份观察报告生成后，这里会显示词条、趋势和原文。</EmptyState>
          )}
        </div>
      )}
      {github.length > 0 && <GitHubPanel items={github} />}
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <div className="card">
      <EmptyState title="新词雷达暂时无法读取" action={<a href="/radar" className="text-accent underline">重新加载</a>}>请稍后重试，查看最近一次扫描结果。</EmptyState>
    </div>
  );
}
