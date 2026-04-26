import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Sentio",
  version: "1.0.0",
  description: "Sentio viewer dashboard with inline viewer count access.",
  permissions: ["storage", "tabs"],
  host_permissions: ["*://*.twitch.tv/*"],
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  action: {
    default_title: "Open Sentio dashboard",
  },
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  content_scripts: [
    {
      matches: ["*://*.twitch.tv/*"],
      js: ["src/content/index.tsx"],
      run_at: "document_idle",
    },
  ],
});
