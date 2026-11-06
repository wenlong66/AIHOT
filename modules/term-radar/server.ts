import { defineServerModule } from "@aihot/backend/modules";
import { publicHandler, sendV1 } from "@aihot/api/routes/v1";
import { strictQuery } from "@aihot/api/http/respond";
import { githubBreakouts } from "./backend/github.ts";
import { latestReport } from "./backend/report.ts";
import { scan } from "./backend/scan.ts";

export default defineServerModule({
  name: "term-radar",
  models: { termRadar: { label: "新词雷达（识别新名称及相关需求）", env: "TERM_RADAR_MODEL", purposes: ["term_radar_extract"] } },
  http(app) {
    app.get("/api/v1/term-radar", publicHandler(async (req, reply) => {
      strictQuery(req, []);
      return sendV1(req, reply, await latestReport(), { etagPrefix: "radar-v1", cacheControl: "public, no-cache" });
    }));
    app.get("/api/v1/term-radar/github", publicHandler(async (req, reply) => {
      strictQuery(req, []);
      return sendV1(req, reply, await githubBreakouts(), { etagPrefix: "radar-github", cacheControl: "public, no-cache" });
    }));
  },
  schedules: [{ name: "term-radar.scan", cron: "15 8 * * *", missed: "once",
    when: () => process.env.TERM_RADAR_ENABLED === "true", run: scan }],
  llms: () => ({ api: ["- /api/v1/term-radar：本站新词、证据链接与 14 天复盘"], pages: ["- /radar：新词雷达"] }),
});
