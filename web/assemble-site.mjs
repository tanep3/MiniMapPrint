import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const pkg = JSON.parse(readFileSync(here("./package.json"), "utf-8"));
const version = pkg.appVersion;
if (!version) throw new Error("package.json appVersion is missing");

// WASM core (built from ../core with wasm-pack) -> site/wasm/
cpSync(here("../core/pkg"), here("./site/wasm"), { recursive: true });

// Stamp the service worker with the app version.
const swPath = here("./site/sw.js");
const sw = readFileSync(swPath, "utf-8");
if (!sw.includes("__APP_VERSION__")) {
  throw new Error("sw.js version placeholder missing; refusing to ship an unstamped worker");
}
writeFileSync(swPath, sw.replaceAll("__APP_VERSION__", version));

// version.json is the update probe target for the running app.
writeFileSync(here("./site/version.json"), JSON.stringify({ version }) + "\n");

console.log(`MiniMapPrint site assembled (v${version})`);
