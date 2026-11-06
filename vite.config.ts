import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves the app from /<repo>/; Firebase Hosting and `npm run dev` from /.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Brain Dump — To-Do",
        short_name: "Brain Dump",
        description: "Voice-first to-do list for work and personal life",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: { maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
    }),
  ],
  test: { environment: "node" },
});
