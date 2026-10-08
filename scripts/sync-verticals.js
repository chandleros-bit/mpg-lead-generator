// Regenerates public/verticals.json, the static list the dashboard picker
// reads. Run after adding or renaming a vertical pack: npm run sync-verticals
// test/verticals.test.js fails until this file matches the registry.
import { writeFileSync } from "node:fs";
import { listVerticals } from "../lib/verticals/index.js";

const out = new URL("../public/verticals.json", import.meta.url);
writeFileSync(out, JSON.stringify(listVerticals(), null, 2) + "\n");
console.log(`wrote ${listVerticals().length} verticals to public/verticals.json`);
