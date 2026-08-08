// @ts-check
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

const SITE_URL = "https://the-somnuss.web.app";

export default defineConfig({
  site: SITE_URL,
  output: "static",
  integrations: [react()],
  i18n: {
    defaultLocale: "es",
    locales: ["es", "en", "ca", "fr"],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  vite: {
    optimizeDeps: {
      include: [
        "clsx",
        "gsap",
        "gsap/ScrollTrigger",
        "motion/react",
        "ogl",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "react/jsx-runtime",
        "tailwind-merge",
      ],
    },
    plugins: [tailwindcss()],
  },
});
