import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import manifest from "./src/manifest";

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(process.cwd(), "dashboard.html"),
      },
    },
  },
});
