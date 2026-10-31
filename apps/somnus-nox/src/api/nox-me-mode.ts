/**
 * The local mock and the ?preview= bypass are opt-in.
 * Vite's development server and the test runner are the only modes that
 * may use them. Staging, production, a hosting build, and an unset mode
 * use the live GET /nox/v1/me.
 */
export function usesDevMock(mode: string | undefined): boolean {
  return mode === "development" || mode === "test";
}
