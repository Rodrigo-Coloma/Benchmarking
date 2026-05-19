import type { ReactNode } from "react";

type Role = "owner" | "editor" | "viewer";

interface Props {
  allow: Role[];
  current: Role | undefined;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Oculta sus children si el rol del usuario en el proyecto actual no está
 * en `allow`. Si se quiere renderizar algo alternativo (p.ej. botón deshabilitado),
 * usar `fallback`.
 */
export function RoleGate({ allow, current, children, fallback = null }: Props) {
  if (current && allow.includes(current)) return <>{children}</>;
  return <>{fallback}</>;
}
