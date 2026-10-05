import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { AuthProvider } from "./auth/AuthProvider.js";
import { RequireAuth } from "./auth/RequireAuth.js";
import { OrgProvider } from "./org/OrgContext.js";
import { AppHome } from "./routes/AppHome.js";
import { AssessmentRoute } from "./routes/Assessment.js";
import { AssessmentDetail } from "./routes/AssessmentDetail.js";
import { AuthCallback } from "./routes/AuthCallback.js";
import { InvitationAccept } from "./routes/InvitationAccept.js";
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
  // Public: the anonymous assessment flow needs no session (build plan §14).
  // Signed-in Morpheo users take it inside their own space (AssessmentRoute).
  { path: "/assessment", element: <AssessmentRoute /> },
  // Public: the invitation accept flow is reached from the invitation email,
  // before the invited person has any session (Addendum A Checkpoint 14.2).
  // This is the ONLY entry point into a Nox organization -- there is no Nox
  // signup route here or anywhere else in the table.
  { path: "/invitation/accept", element: <InvitationAccept /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/app", element: <AppHome /> },
      { path: "/app/profile", element: <Profile /> },
      { path: "/app/assessments/:sessionId", element: <AssessmentDetail /> },
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
