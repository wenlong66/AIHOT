import { readFile } from "node:fs/promises";
import { closeDb } from "@aihot/backend/db";
import { installModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { evidenceBatch, scan } from "../backend/scan.ts";
import { saveSnapshot, snapshot } from "../backend/report.ts";

installModules(SERVER_MODULES);
try {
  const [action = "scan", file, ...extra] = process.argv.slice(2);
  if (action === "scan" && !file) console.log(await scan());
  else if (action === "export" && !file) console.log(JSON.stringify(await evidenceBatch()));
  else if (action === "import" && file && !extra.length) {
    const report = snapshot.parse(JSON.parse(await readFile(file, "utf8")));
    if (Date.parse(report.observedAt) > Date.now()) throw new Error("Snapshot observation is in the future");
    await saveSnapshot(report);
    console.log({ observedAt: report.observedAt, terms: report.terms.length });
  } else throw new Error("Usage: npm run radar:scan -- [scan | export | import FILE]");
} finally {
  await closeDb();
}
