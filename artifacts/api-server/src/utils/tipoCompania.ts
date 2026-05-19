/**
 * Clasificación heurística heredada de V1. En V2/V3 esto pasará a ser
 * configurable por proyecto (en `projects.framework_context`). De momento
 * lo dejamos como utilidad neutra que sólo etiqueta empresas reconocidas
 * del grupo ILUNION/ONCE; cualquier otra empresa cae en "Externa".
 */
export function classifyTipoCompania(name: string): string {
  const n = (name ?? "").toLowerCase();
  if (/\bilunion\b/.test(n)) return "ILUNION";
  if (
    /\bonce\b/.test(n) ||
    /\bfundosa\b/.test(n) ||
    /grupo social once/.test(n) ||
    /fundacion once/.test(n) ||
    /fundación once/.test(n)
  ) {
    return "ONCE";
  }
  return "Externa";
}
