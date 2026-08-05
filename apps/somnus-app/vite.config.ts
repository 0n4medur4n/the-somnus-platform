import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The SPA is a static bundle deployed to Firebase Hosting; it talks only
// to somnus-edge-api (build plan §5.2). Dev/preview ports match the
// origins edge-api's CORS allow-list already trusts (5173 / 4173).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: "dist", sourcemap: true },
});
