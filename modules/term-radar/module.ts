import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "term-radar",
  pages: [{ path: "radar", file: "web/radar.tsx" }],
  apiPaths: [/^\/api\/v1\/term-radar(?:\/github)?$/],
});
