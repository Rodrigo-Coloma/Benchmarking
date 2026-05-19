import { Link } from "wouter";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        Esta ruta no existe.
      </p>
      <Link href="/" className="mt-6 text-sm underline">
        Volver al inicio
      </Link>
    </div>
  );
}
