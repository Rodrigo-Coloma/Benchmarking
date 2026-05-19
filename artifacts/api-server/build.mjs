import { build } from "esbuild";
import { rmSync } from "node:fs";

rmSync("./dist", { recursive: true, force: true });

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  packages: "external",
  logLevel: "info",
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.mjs",
  }),
  build({
    ...common,
    entryPoints: ["src/migrate.ts"],
    outfile: "dist/migrate.mjs",
  }),
]);

console.log("✓ api-server built → dist/index.mjs + dist/migrate.mjs");
