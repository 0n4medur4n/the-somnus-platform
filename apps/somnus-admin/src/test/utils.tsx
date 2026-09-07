import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { AdminAuthContext, type AdminAuthContextValue } from "../auth/AdminAuthContext.js";
import i18n from "../i18n/index.js";

const loadingAuth: AdminAuthContextValue = {
  state: { status: "loading" },
  refresh: async () => {},
  logout: async () => {},
};

/** Renders a component inside the console's providers (query, i18n, gate, router). */
export function renderWithProviders(
  ui: ReactElement,
  options: { auth?: AdminAuthContextValue; route?: string } = {},
): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = options.auth ?? loadingAuth;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <AdminAuthContext.Provider value={auth}>
            <MemoryRouter initialEntries={[options.route ?? "/"]}>{children}</MemoryRouter>
          </AdminAuthContext.Provider>
        </I18nextProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}

export { i18n };
