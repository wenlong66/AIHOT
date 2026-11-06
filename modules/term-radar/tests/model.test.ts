import { after, test } from "node:test";
import assert from "node:assert/strict";
import { stub } from "../../../tests/setup.ts";
import { closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import radar from "../server.ts";
import { radarCandidates } from "../backend/model.ts";

installModules([radar]);
after(closeDb);

test("a custom endpoint judges the newest items, grounds citations and reuses unchanged answers", async (t) => {
  const requests: { model: string; authorization: string | undefined; path: string }[] = [];
  const server = await stub((_hit, req) => {
    const { model, messages } = JSON.parse(req.body);
    const { title } = JSON.parse(messages.at(-1).content);
    requests.push({ model, authorization: req.headers.authorization, path: req.url });
    const make = (term: string) => ({ term, kind: "tool", summary: "发布了新工具", opportunity: null });
    const content = JSON.stringify({ candidates: [make(title), make("AbsentTool")] });
    return { choices: [{ message: { content } }] };
  });
  t.after(server.close);
  Object.assign(process.env, { TERM_RADAR_MODEL: "default", LLM_MODEL: "my-local-model",
    LLM_API_KEY: "", LLM_BASE_URL: `${server.url}/v1`, LLM_ALLOW_KEYLESS: "false" });
  const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `NewKit${i}`, summary: "发布了新工具" }));
  assert.deepEqual((await radarCandidates(items)).judgedIds, []);
  assert.equal(server.hits(), 0);
  process.env.LLM_ALLOW_KEYLESS = "true";
  const first = await radarCandidates(items);
  assert.deepEqual(first.judgedIds, items.slice(0, 8).map(item => item.id));
  assert.deepEqual(first.candidates.map(c => [c.term, c.evidenceIds]), items.slice(0, 8).map(item => [item.title, [item.id]]));
  assert.equal(server.hits(), 8);
  assert.ok(requests.every(r => r.model === "my-local-model" && r.authorization === undefined && r.path === "/v1/chat/completions"));
  assert.deepEqual(await radarCandidates(items), first);
  assert.equal(server.hits(), 8);
  process.env.LLM_API_KEY = "local-stub-key";
  await radarCandidates([{ ...items[0], summary: "增加一个部署选项" }, ...items.slice(1)]);
  assert.equal(server.hits(), 9);
  assert.equal(requests.at(-1)?.authorization, "Bearer local-stub-key");
});
