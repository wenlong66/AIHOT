import { execFile } from "node:child_process";
import path from "node:path";
import { config, REPO_ROOT } from "@aihot/backend/config";
import { listedEvidence } from "@aihot/backend/publication/evidence";
import { radarCandidates } from "./model.ts";
import { saveSnapshot, snapshot } from "./report.ts";

export async function evidenceBatch(now = new Date()) {
  const since = new Date(now.getTime() - 48 * 60 * 60_000);
  const rows = await listedEvidence(now, { since, limit: 200 });
  const urls = new Set<string>();
  const items = rows.filter(item => {
    if (urls.has(item.url)) return false;
    urls.add(item.url);
    return true;
  });
  return { version: 1, observedAt: now.toISOString(), items };
}

function runWorker(args: string[], input?: object) {
  const worker = path.join(REPO_ROOT, "workers/term-radar/run.py");
  const state = path.join(config.dataDir, "term-radar", "history.sqlite");
  return new Promise<string>((resolve, reject) => {
    const child = execFile("python3", [worker, "--state", state, ...args],
      { encoding: "utf8", timeout: 90_000, maxBuffer: 12 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    child.stdin!.on("error", reject);
    child.stdin!.end(input && JSON.stringify(input));
  });
}

// Older and withdrawn citations may never occur again in a 48-hour batch.
async function invalidatedEvidence(now: Date) {
  const saved: { id: string; revision: string }[] = JSON.parse(await runWorker(["--list-evidence", now.toISOString()]));
  const stale: typeof saved = [];
  for (let start = 0; start < saved.length; start += 500) {
    const group = saved.slice(start, start + 500);
    const current = await listedEvidence(now, { ids: group.map(e => e.id) });
    const byId = new Map(current.map(e => [e.id, e.revision]));
    stale.push(...group.filter(e => byId.get(e.id) !== e.revision));
  }
  return stale;
}

export async function scan(now = new Date()) {
  const invalidated = await invalidatedEvidence(now);
  const batch = await evidenceBatch(now);
  const items = batch.items;
  const judged = config.modelCallsEnabled && items.length ? await radarCandidates(items) : undefined;
  const output = await runWorker([], { ...batch, invalidated, candidates: judged?.candidates, judgedIds: judged?.judgedIds });
  const report = snapshot.parse(JSON.parse(output));
  await saveSnapshot(report, judged?.receiptIds);
  return { observedAt: report.observedAt, items: items.length, terms: report.terms.length };
}
