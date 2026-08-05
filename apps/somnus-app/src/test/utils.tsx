import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthContextValue } from "../auth/AuthContext.js";
import i18n from "../i18n/index.js";
import { OrgProvider } from "../org/OrgContext.js";

const noopAuth: AuthContextValue = {
  state: { status: "unauthenticated" },
  refresh: async () => {},
  logout: async () => {},
};

/** Renders a component inside the app's providers (query, i18n, auth, org, router). */
export function renderWithProviders(
  ui: ReactElement,
  options: { auth?: AuthContextValue; route?: string } = {},
): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = options.auth ?? noopAuth;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AuthContext.Provider value={auth}>
            <OrgProvider>
              <MemoryRouter initialEntries={[options.route ?? "/"]}>{children}</MemoryRouter>
            </OrgProvider>
          </AuthContext.Provider>
        </I18nextProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

export { i18n };
