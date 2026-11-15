import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

// For `vite dev`: make the wasm-pack output reachable as /wasm/*.
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
cpSync(here("../core/pkg"), here("./public/wasm"), { recursive: true });
console.log("copied core/pkg -> public/wasm");
