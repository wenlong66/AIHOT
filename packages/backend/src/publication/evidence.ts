// A bounded batch of public titles and summaries for site modules, or a fresh check of their citations.
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { API_ITEM_FROM } from "./items.ts";
import { publicSourceName } from "./rules.ts";
import { listedCondition } from "./scope.ts";

export async function listedEvidence(now: Date, select: { since: Date; limit: number } | { ids: string[] }) {
  if ("ids" in select && !select.ids.length) return [];
  const filter = "ids" in select
    ? sql`AND p.article_id = ANY(${select.ids}::text[])`
    : sql`AND p.timeline_at >= ${select.since}`;
  const rows = await sql`
    SELECT p.article_id, p.title, p.original_title, p.summary, s.name, p.url,
           p.published_at
    ${API_ITEM_FROM} WHERE ${listedCondition(now)} AND p.published_at IS NOT NULL AND p.published_at <= ${now} AND p.timeline_at <= ${now} ${filter}
    ORDER BY p.timeline_at DESC, p.article_id DESC
    ${"limit" in select ? sql`LIMIT ${select.limit}` : sql``}`;
  return rows.flatMap((row) => {
    if (!URL.canParse(row.url)) return [];
    const url = new URL(row.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return [];
    const title = String(row.original_title || row.title).slice(0, 500);
    const summary = [row.title !== title ? row.title : "", row.summary].filter(Boolean).join("\n").slice(0, 1600);
    const item = { id: String(row.article_id), title, summary, source: publicSourceName(row.name),
      url: String(row.url), publishedAt: row.published_at.toISOString() as string };
    return [{ ...item, revision: sha256(JSON.stringify(item)) }];
  });
}

/** Public source/link pairs that can substantiate a module's observations right now. */
export async function listedEvidenceLinks(now: Date, sourceIds: string[], urls: string[]) {
  return sql<{ source_id: string; url: string }[]>`
    SELECT p.source_id, p.url FROM publications p WHERE ${listedCondition(now)}
    AND p.timeline_at <= ${now} AND p.url=ANY(${urls}::text[]) AND p.source_id=ANY(${sourceIds}::text[])`;
}
