import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ApiError } from "@workspace/api-client-react";
import * as api from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { Button } from "../components/Button";

export function LoginPage() {
  const { setUser } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await api.login({ email, password });
      setUser(user);
      navigate("/projects");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Error desconocido",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold">Asset Manager</h1>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        Entra con tu cuenta
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input
            type="password"
            required
            minLength={10}
            className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={loading}>
          {loading ? "Entrando…" : "Entrar"}
        </Button>

        <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="underline">
            Regístrate
          </Link>
        </p>
      </form>
    </div>
  );
}
