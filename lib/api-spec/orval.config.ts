import { defineConfig } from "orval";

/**
 * Genera dos outputs a partir de openapi.yaml:
 *
 *   1. lib/api-client-react   — hooks de @tanstack/react-query
 *   2. lib/api-zod            — schemas Zod de cada operación
 *
 * Tras correr `orval`, `scripts/patch-api-zod.mjs` parchea el index.ts
 * del paquete api-zod para reexportar limpiamente el bundle generado.
 */
export default defineConfig({
  reactClient: {
    input: {
      target: "./openapi.yaml",
    },
    output: {
      mode: "tags-split",
      target: "../api-client-react/src/generated/api.ts",
      schemas: "../api-client-react/src/generated/schemas",
      client: "react-query",
      httpClient: "fetch",
      override: {
        mutator: {
          path: "../api-client-react/src/custom-fetch.ts",
          name: "customFetch",
        },
        query: {
          useQuery: true,
          useMutation: true,
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
    },
    output: {
      mode: "single",
      target: "../api-zod/src/generated/api.ts",
      client: "zod",
    },
  },
});
