import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AdminAuthProvider } from "./auth/AdminAuthProvider.js";
import { useAdminAuth } from "./auth/useAdminAuth.js";
import { FullPageStatus } from "./components/FullPageStatus.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { ConsoleHome } from "./routes/ConsoleHome.js";
import { Denied } from "./routes/Denied.js";
import { Invited } from "./routes/Invited.js";
import { Login } from "./routes/Login.js";

// The Drive tab carries the editor and the converters; the console never loads them.
const DriveApp = lazy(() => import("./routes/DriveApp.js").then((m) => ({ default: m.DriveApp })));

function DriveRoute() {
  return (
    <Suspense fallback={<FullPageStatusLoading />}>
      <DriveApp />
    </Suspense>
  );
}

function FullPageStatusLoading() {
  const { t } = useTranslation();
  return <FullPageStatus message={t("common.loading")} />;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/**
 * The gate, at the root of the app (Addendum A Checkpoint 15.1).
 *
 * There is no route table of admin screens to protect one by one, and that is
 * deliberate: the console renders exactly one of four things, chosen by what
 * the server said (or, for an invited person, the invitation to accept). A screen cannot be reached by typing its URL, because until
 * `/admin/v1/me` succeeds there are no screens to reach.
 */
export function Gate() {
  const { t } = useTranslation();
  const { state } = useAdminAuth();

  if (state.status === "loading") return <FullPageStatus message={t("common.loading")} />;
  if (state.status === "unauthenticated") return <Login />;
  if (state.status === "denied") return <Denied />;
  if (state.status === "invited") return <Invited invitation={state.invitation} />;
  return <ConsoleHome me={state.me} />;
}

const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallback /> },
  { path: "/", element: <Gate /> },
  // The staff Drive in its own tab (owner decision 2026-10-19), behind the same gate.
  { path: "/drive", element: <DriveRoute /> },
  // Everything else is the gate too: an unknown path must not leak the shape of
  // the console to someone who has no access to it.
  { path: "*", element: <Navigate to="/" replace /> },
]);

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>{children}</AdminAuthProvider>
    </QueryClientProvider>
  );
}

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
