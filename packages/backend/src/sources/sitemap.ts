// A single publisher's leaf sitemap. Its lastmod is an edit date, never the release date.
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { shortHash } from "../lib/ids.ts";
import { languageHeaders, requireOk } from "../lib/http-fetch.ts";
import { normalizeUrl } from "../lib/url.ts";
import { readPublicationDate } from "./dates.ts";
import { fetchListing } from "./listing-fetch.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

const parser = new XMLParser({ parseTagValue: false, removeNSPrefix: true,
  isArray: (_name, path) => path === "urlset.url" });

export async function fetchSitemap(source: SourceRow): Promise<Candidate[]> {
  const url = String(source.config.url ?? "");
  const res = requireOk(await fetchListing(url, { redirectPolicy: "same-origin", timeoutMs: 25_000,
    headers: { accept: "application/xml,text/xml;q=0.9", ...languageHeaders(source.config.acceptLanguage) } }));
  const xml = res.text();
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) throw new FetchError("expected sitemap XML without a DTD");
  const rows = parser.parse(xml)?.urlset?.url;
  if (!Array.isArray(rows) || rows.length > 5000) throw new FetchError("choose a leaf sitemap containing 1–5000 URLs");
  const origin = new URL(url).origin;
  const posts = new Map<string, Candidate>();
  for (const row of rows) {
    if (typeof row?.loc !== "string") continue;
    let link: URL;
    let slug: string;
    try {
      link = new URL(row.loc);
      if (link.origin !== origin || link.username || link.password) continue;
      slug = decodeURIComponent(link.pathname.split("/").filter(Boolean).at(-1) ?? "").replace(/[-_]+/g, " ");
    } catch { continue; }
    const canonical = normalizeUrl(link.href);
    if (!canonical || !slug || posts.has(canonical)) continue;
    const news = row.news;
    posts.set(canonical, {
      url: link.href, title: typeof news?.title === "string" && news.title.trim() ? news.title.trim() : slug,
      ...readPublicationDate(typeof news?.publication_date === "string" ? news.publication_date : null, source.config.publishedAtUtcOffset),
      sourceUpdatedAt: readPublicationDate(typeof row.lastmod === "string" ? row.lastmod : null, source.config.publishedAtUtcOffset).publishedAt,
    });
  }
  if (!posts.size) throw new FetchError("sitemap has no same-origin page URLs");
  return [...posts.values()];
}

// A newly configured sitemap establishes a baseline. Later entries keep passing through normal
// collection, whose stored identities and enrichment retries decide whether they need any work.
export function sitemapAdditions(source: SourceRow, entries: Candidate[]) {
  const url = String(source.config.url);
  const prior = source.cursor?.sitemapBaseline;
  if (prior?.url !== url || !Array.isArray(prior.hashes)) {
    return { baseline: { url, hashes: entries.map(e => shortHash(normalizeUrl(e.url) ?? e.url)) }, entries: [] as Candidate[] };
  }
  const hashes = new Set<string>(prior.hashes);
  return { baseline: prior, entries: entries.filter(e => !hashes.has(shortHash(normalizeUrl(e.url) ?? e.url))) };
}
