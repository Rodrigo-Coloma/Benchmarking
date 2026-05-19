// PLACEHOLDER — este archivo lo regenera Orval (ver lib/api-spec/orval.config.ts).
// Hasta que corras `pnpm --filter @workspace/api-spec run codegen` no habrá
// schemas reales. Exportamos un sentinel para que el typecheck no rompa.
//
// Para regenerar:
//   pnpm install
//   pnpm --filter @workspace/api-spec run codegen
import { z } from "zod";

export const _placeholder = z.object({
  __codegen_pending: z.literal(true),
});

export type CodegenPending = z.infer<typeof _placeholder>;
