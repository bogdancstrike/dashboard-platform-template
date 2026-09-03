import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The dev server proxies the API rather than talking to it cross-origin.
 *
 * Same-origin in development means the app exercises the same request path it
 * will use in production behind a reverse proxy — no CORS preflight that only
 * exists on a developer's machine, and no `VITE_API_URL` baked into the bundle.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/platform": { target: "http://localhost:5101", changeOrigin: true },
      "/swagger.json": { target: "http://localhost:5101", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app chunk so a
        // code change does not invalidate 900KB of vendor bundle in every cache.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          antd: ["antd", "@ant-design/icons"],
          charts: ["echarts", "echarts-for-react"],
          query: ["@react-awesome-query-builder/antd"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // The API is mocked at the network boundary (MSW), so a component test
    // exercises the real fetch path rather than a hand-stubbed module.
    restoreMocks: true,
  },
});
