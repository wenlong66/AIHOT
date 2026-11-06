import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { githubRepoStars, observeGithubStars } from "@aihot/backend/sources/github-stars";
import { breakoutRows, githubBreakouts } from "../backend/github.ts";

const feed = "https://api.github.com/orgs/lab/repos";
const repo = "lab/weaver";
const url = "https://github.com/" + repo;
const at = new Date();
const day = 86_400_000;
const createdAt = new Date(+at - 8 * day).toISOString();
const observation = { repo, id: 7, createdAt, stars: 1000 };
const first = observeGithubStars(undefined, feed, [{ ...observation, stars: 590 }], new Date(+at - day));

after(closeDb);

test("day deltas use two measured samples; missing days and incomparable intervals stay unknown", () => {
  const current = observeGithubStars(first, feed, [observation], at);
  const [hit] = breakoutRows(current, at);
  assert.equal(hit?.dayDelta, 410);
  assert.equal(hit?.starsPerDay, 125);
  assert.equal(observeGithubStars(current, feed, [], at), current);
  const big = { ...observation, stars: 2000 };
  const stale = observeGithubStars(undefined, feed, [{ ...big, stars: 20 }], new Date(+at - 3 * day));
  assert.equal(breakoutRows(observeGithubStars(stale, feed, [big], at), at)[0]?.dayDelta, null);
  const reset = observeGithubStars(first, feed + "?page=2", [observation], at);
  assert.deepEqual(breakoutRows(reset, at), []);
  assert.deepEqual(breakoutRows(current, new Date(+at + 2 * day)), []);
});

test("only the official repo list and a genuine public GitHub object can supply starred evidence", () => {
  const payload = { id: 7, full_name: repo, html_url: url, created_at: createdAt, stargazers_count: 1000, private: false };
  assert.deepEqual(githubRepoStars(payload, url), observation);
  assert.equal(githubRepoStars({ ...payload, private: true }, url), null);
  assert.equal(githubRepoStars(payload, "https://example.org/mirror"), null);
  assert.deepEqual(unsupportedConfig("json_list", { url: feed, captureGithubStars: true }), []);
  assert.deepEqual(unsupportedConfig("json_list", { url: "https://api.github.com.evil.example/orgs/lab/repos", captureGithubStars: true }), ["captureGithubStars"]);
});

test("public breakouts require both opt-in and a still-listed source publication", async () => {
  const history = observeGithubStars(first, feed, [observation], at);
  const config = { url: feed, captureGithubStars: false };
  await sql`INSERT INTO sources (id,name,kind,tier,config,cursor) VALUES
    ('radar-gh','GitHub lab','json_list','T1',${sql.json(config)},${sql.json({ githubStars: history } as never)})`;
  const { articleId } = await upsertMaterial({ sourceId: "radar-gh", url, title: "Weaver", via: "fetch",
    publishedAt: new Date(createdAt), discoveredAt: new Date(createdAt) });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,title_zh,summary_zh,category,score)
    VALUES (${articleId},1,'rule','pass','新工具 Weaver','工具说明','ai-models',90)`;
  await publishArticle(articleId, { releasedAt: new Date(createdAt) });
  assert.deepEqual(await githubBreakouts(at), { items: [] });
  await sql`UPDATE sources SET config=${sql.json({ ...config, captureGithubStars: true })} WHERE id='radar-gh'`;
  assert.equal((await githubBreakouts(at)).items[0]?.dayDelta, 410);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${articleId}`;
  assert.deepEqual(await githubBreakouts(at), { items: [] });
});
