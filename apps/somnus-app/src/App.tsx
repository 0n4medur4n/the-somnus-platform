import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AuthProvider } from "./auth/AuthProvider.js";
import { RequireAuth } from "./auth/RequireAuth.js";
import { OrgProvider } from "./org/OrgContext.js";
import { AppHome } from "./routes/AppHome.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { Login } from "./routes/Login.js";
import { NotFound } from "./routes/NotFound.js";
import { Organization } from "./routes/Organization.js";
import { OrganizationInvitations } from "./routes/OrganizationInvitations.js";
import { OrganizationMembers } from "./routes/OrganizationMembers.js";
import { Profile } from "./routes/Profile.js";
import { Professional, ProfessionalProfile, Security } from "./routes/ScaffoldPage.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/auth/callback", element: <AuthCallback /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/app", element: <AppHome /> },
      { path: "/app/profile", element: <Profile /> },
      { path: "/app/security", element: <Security /> },
      { path: "/professional", element: <Professional /> },
      { path: "/professional/profile", element: <ProfessionalProfile /> },
      { path: "/organization", element: <Organization /> },
      { path: "/organization/members", element: <OrganizationMembers /> },
      { path: "/organization/invitations", element: <OrganizationInvitations /> },
    ],
  },
  { path: "/", element: <Navigate to="/app" replace /> },
  { path: "*", element: <NotFound /> },
]);

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OrgProvider>{children}</OrgProvider>
      </AuthProvider>
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
