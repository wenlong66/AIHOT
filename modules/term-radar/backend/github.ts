import { sql } from "@aihot/backend/db";
import { listedEvidenceLinks } from "@aihot/backend/publication/evidence";
import type { GithubHistory } from "@aihot/backend/sources/github-stars";

const DAY = 86_400_000;

export function breakoutRows(history: GithubHistory, now: Date) {
  const { current, previous } = history;
  const observed = Date.parse(current.at);
  if (observed > now.getTime() || now.getTime() - observed > DAY) return [];
  const interval = previous ? (observed - Date.parse(previous.at)) / DAY : 0;
  const consecutive = new Date(observed - DAY).toISOString().slice(0, 10) === previous?.at.slice(0, 10);
  const prior = new Map((consecutive && interval >= 0.75 && interval <= 1.25 ? previous!.repos : []).map(r => [r.id, r.stars]));
  return current.repos.flatMap(r => {
    const age = (observed - Date.parse(r.createdAt)) / DAY;
    if (age < 0 || age > 14) return [];
    const earlier = prior.get(r.id);
    const dayDelta = earlier === undefined ? null : r.stars - earlier;
    const average = r.stars / Math.max(1, age);
    if (average < 200 && (dayDelta ?? 0) < 400) return [];
    return [{ repo: r.repo, url: `https://github.com/${r.repo}`, stars: r.stars, dayDelta,
      starsPerDay: Math.round(average), observedAt: current.at, createdAt: r.createdAt }];
  });
}

export async function githubBreakouts(now = new Date()) {
  const sources = await sql<{ id: string; history: GithubHistory }[]>`
    SELECT id, cursor->'githubStars' AS history FROM sources
    WHERE enabled AND kind='json_list' AND config->'captureGithubStars'='true'::jsonb
    AND config->>'url'=cursor->'githubStars'->>'url'`;
  const found = sources.flatMap(s => breakoutRows(s.history, now).map(row => ({ ...row, source: s.id })));
  if (!found.length) return { items: [] };
  const visible = await listedEvidenceLinks(now, sources.map(s => s.id), found.map(r => r.url));
  const allowed = new Set(visible.map(r => r.source_id + "|" + r.url));
  type Breakout = ReturnType<typeof breakoutRows>[number];
  const byRepo = new Map<string, Breakout>();
  for (const { source, ...row } of found) {
    if (!allowed.has(source + "|" + row.url)) continue;
    const old = byRepo.get(row.url);
    if (!old || old.observedAt < row.observedAt) byRepo.set(row.url, row);
  }
  const rank = (r: Breakout) => Math.max(r.starsPerDay, r.dayDelta ?? 0);
  return { items: [...byRepo.values()].sort((a, b) => rank(b) - rank(a) || a.repo.localeCompare(b.repo)).slice(0, 20) };
}
