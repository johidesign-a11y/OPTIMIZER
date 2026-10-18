import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "development-csp",
      apply: "serve",
      transformIndexHtml(html) {
        // Vite injects its React refresh preamble during development only.
        return html.replace(
          /\s*<meta http-equiv="Content-Security-Policy"[^>]*\/>/,
          "",
        );
      },
    },
  ],
  base: "./",
  build: { outDir: "dist", sourcemap: true },
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
