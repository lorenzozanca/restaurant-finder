// Copies the map page and its static files from ../ui, so the laptop server and the
// online app serve the same page. Runs before `next dev` and `next build`; the
// copies are gitignored.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ui = resolve(web, "..", "ui");
mkdirSync(join(web, "generated"), { recursive: true });
mkdirSync(join(web, "public"), { recursive: true });
cpSync(join(ui, "map.html"), join(web, "generated", "map.html"));
cpSync(join(ui, "vendor"), join(web, "public", "vendor"), { recursive: true });
cpSync(join(ui, "italian-municipalities.json"), join(web, "public", "italian-municipalities.json"));
console.log("copied ui/map.html, ui/vendor and ui/italian-municipalities.json");
