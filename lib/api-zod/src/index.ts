// Este index lo reescribe `lib/api-spec/scripts/patch-api-zod.mjs` tras correr
// `pnpm codegen`. Antes de la primera ejecución de codegen, el archivo
// `./generated/api.ts` no existe; lo importamos con un fallback para no romper
// el typecheck del resto del workspace en arranques limpios.
//
// Tras la primera vez que se corre `pnpm --filter @workspace/api-spec run codegen`,
// este archivo se reescribe con `export * from "./generated/api.js";`
export * from "./generated/api.js";
