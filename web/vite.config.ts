import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as { appVersion: string };

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.appVersion),
  },
  build: {
    outDir: "site",
    emptyOutDir: true,
    target: "es2022",
  },
});
