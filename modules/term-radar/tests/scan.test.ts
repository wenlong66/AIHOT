import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { config } from "@aihot/backend/config";
import { installModules } from "@aihot/backend/modules";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { buildApp } from "../../../apps/api/src/app.ts";
import radar from "../server.ts";
import { scan } from "../backend/scan.ts";

installModules([radar]);
const app = await buildApp();
after(async () => { await app.close(); await stopBoss(); await closeDb(); });

test("publications reach the radar through the worker; a correction or withdrawal suppresses old inferences", async () => {
  const path = "/api/v1/term-radar";
  config.modelCallsEnabled = false;
  assert.deepEqual((await app.inject(path)).json(), { version: 1, observedAt: null, terms: [] });
  const now = new Date(Date.now() - 60_000);
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES ('radar-qa', 'Lab（私有备注）', 'rss', 'T1')`;
  const { articleId } = await upsertMaterial({ sourceId: "radar-qa", title: "Introducing LoomKit: local builds",
    url: "https://example.org/loomkit", publishedAt: now, discoveredAt: now, via: "fetch" });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, summary_zh, category, score)
    VALUES (${articleId}, 1, 'rule', 'pass', '推出「LoomKit」', '本地构建工具', 'ai-models', 90)`;
  await publishArticle(articleId, { releasedAt: now });
  assert.equal((await scan()).terms, 1);
  await scan();
  assert.equal((await sql`SELECT count(*) AS n FROM term_radar_snapshots`)[0].n, 1);
  const res = await app.inject(path);
  assert.equal(res.statusCode, 200);
  const [term] = res.json().terms;
  assert.equal(term.term, "LoomKit");
  assert.equal(term.evidenceCount, 1);
  assert.deepEqual(term.evidence.map((e: {id: string; source: string}) => [e.id, e.source]), [[articleId, "Lab"]]);
  assert.equal(term.review.status, "pending");
  assert.equal((await app.inject({ url: path, headers: { "if-none-match": res.headers.etag as string } })).statusCode, 304);
  await sql`UPDATE publications SET summary='已纠正' WHERE article_id = ${articleId}`;
  assert.deepEqual((await app.inject(path)).json().terms, []);
  await sql`UPDATE publications SET visibility='withdrawn', summary='本地构建工具' WHERE article_id = ${articleId}`;
  assert.deepEqual((await app.inject(path)).json().terms, []);

  const { articleId: replacement } = await upsertMaterial({ sourceId: "radar-qa", title: "Introducing LoomKit: new release",
    url: "https://example.org/loomkit-release", publishedAt: now, discoveredAt: now, via: "fetch" });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, title_zh, summary_zh, category, score)
    VALUES (${replacement}, 1, 'rule', 'pass', '推出「LoomKit」新版本', '公开新资料', 'ai-models', 90)`;
  await publishArticle(replacement, { releasedAt: now });
  await scan();
  const [rediscovered] = (await app.inject(path)).json().terms;
  assert.equal(rediscovered.term, "LoomKit");
  assert.equal(rediscovered.summary, "Introducing LoomKit: new release");
  assert.deepEqual(rediscovered.evidence.map((e: { id: string }) => e.id), [replacement]);
});
