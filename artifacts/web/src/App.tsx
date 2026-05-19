import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Router as WouterRouter, Route, Switch, Redirect } from "wouter";
import { Toaster } from "sonner";

import { AuthProvider, useAuth } from "./hooks/useAuth";
import { LoginPage } from "./pages/Login";
import { SignupPage } from "./pages/Signup";
import { ProjectsPage } from "./pages/Projects";
import { NewProjectPage } from "./pages/NewProject";
import { ProjectOverviewPage } from "./pages/ProjectOverview";
import { KpiImportPage } from "./pages/KpiImport";
import { KpiImportPreviewPage } from "./pages/KpiImportPreview";
import { NotFoundPage } from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const wouterBase = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthedRoutes() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/projects" />} />
      <Route path="/projects" component={ProjectsPage} />
      <Route path="/projects/new" component={NewProjectPage} />
      <Route path="/projects/:id" component={ProjectOverviewPage} />
      <Route path="/projects/:id/kpis/import" component={KpiImportPage} />
      <Route
        path="/projects/:id/kpis/import/:runId"
        component={KpiImportPreviewPage}
      />
      <Route component={NotFoundPage} />
    </Switch>
  );
}

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route component={() => <Redirect to="/login" />} />
    </Switch>
  );
}

function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Cargando…
        </p>
      </div>
    );
  }

  return user ? <AuthedRoutes /> : <PublicRoutes />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={wouterBase}>
          <Gate />
          <Toaster position="bottom-right" richColors />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
