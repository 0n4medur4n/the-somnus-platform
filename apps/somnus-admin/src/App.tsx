import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AdminAuthProvider } from "./auth/AdminAuthProvider.js";
import { useAdminAuth } from "./auth/useAdminAuth.js";
import { FullPageStatus } from "./components/FullPageStatus.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { ConsoleHome } from "./routes/ConsoleHome.js";
import { Denied } from "./routes/Denied.js";
import { Login } from "./routes/Login.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/**
 * The gate, at the root of the app (Addendum A Checkpoint 15.1).
 *
 * There is no route table of admin screens to protect one by one, and that is
 * deliberate: the console renders exactly one of four things, chosen by what
 * the server said. A screen cannot be reached by typing its URL, because until
 * `/admin/v1/me` succeeds there are no screens to reach.
 */
export function Gate() {
  const { t } = useTranslation();
  const { state } = useAdminAuth();

  if (state.status === "loading") return <FullPageStatus message={t("common.loading")} />;
  if (state.status === "unauthenticated") return <Login />;
  if (state.status === "denied") return <Denied />;
  return <ConsoleHome me={state.me} />;
}

const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallback /> },
  { path: "/", element: <Gate /> },
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
