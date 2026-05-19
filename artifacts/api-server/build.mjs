import { build } from "esbuild";
import { rmSync, readFileSync } from "node:fs";

rmSync("./dist", { recursive: true, force: true });

// Lista de externals: todas las deps de npm (pg, express, drizzle, etc.)
// EXCEPTO los paquetes locales del workspace (@workspace/*), que SÍ queremos
// bundlear dentro del .mjs para que el runtime no necesite resolver módulos
// locales del monorepo.
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
].filter((d) => !d.startsWith("@workspace/"));

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external,
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
    entryPoints: ["src/cli/migrate.ts"],
    outfile: "dist/migrate.mjs",
  }),
]);

console.log("✓ api-server built → dist/index.mjs + dist/migrate.mjs");
