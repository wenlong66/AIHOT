// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import termRadar from "@aihot/term-radar/web";

export const WEB_MODULES: readonly WebModule[] = [termRadar];
