import { useTranslation } from "react-i18next";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { NoxAuthProvider } from "./auth/NoxAuthProvider.js";
import { useNoxAuth } from "./auth/useNoxAuth.js";
import { FullPageStatus } from "./components/FullPageStatus.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Denied } from "./routes/Denied.js";
import { Login } from "./routes/Login.js";

export function Gate() {
  const { t } = useTranslation();
  const { state } = useNoxAuth();
  if (state.status === "loading") return <FullPageStatus message={t("common.loading")} />;
  if (state.status === "unauthenticated") return <Login />;
  if (state.status === "granted") return <Dashboard />;
  return <Denied />;
}

const router = createBrowserRouter([
  { path: "/auth/callback", element: <AuthCallback /> },
  { path: "/", element: <Gate /> },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <NoxAuthProvider>
      <RouterProvider router={router} />
    </NoxAuthProvider>
  );
}
