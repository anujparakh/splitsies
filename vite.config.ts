import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The client builds into dist/client, which wrangler.jsonc serves as the
// Worker's static assets. The Worker itself is bundled by wrangler, not Vite.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` serves the SPA; API calls go to a separately running
    // `wrangler dev`. See CLAUDE.md for the two-terminal dev loop.
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
