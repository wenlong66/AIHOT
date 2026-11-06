import { defineWebModule } from "@aihot/web/modules";
import { IconChart } from "@aihot/web/components/icons";

const entry = { to: "/radar", label: "新词雷达", icon: IconChart };

export default defineWebModule({
  name: "term-radar",
  sidebar: { section: "内容", items: [entry] },
  tabs: [{ ...entry, key: "radar", label: "雷达" }],
});
