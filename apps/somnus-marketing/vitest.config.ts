import { defineConfig } from "vitest/config";

// The marketing site runs its own suite (i18n completeness, component
// render tests, and the build-time link + hreflang/meta checks that read
// dist). The root runner excludes this app so its source is never touched
// by the shared gate; CI's somnus-marketing job runs `astro build` before
// this so the dist-reading tests have something to inspect.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
