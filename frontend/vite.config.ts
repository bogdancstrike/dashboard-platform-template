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
    // The budget that matters is the gzipped size, and the vendor chunk is
    // around 300KB gzipped. Rollup's default warning counts uncompressed bytes,
    // which flags a bundle that is fine over the wire.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        /**
         * Split the heavy, rarely-changing libraries out of the app chunk, so a
         * one-line change does not invalidate a megabyte of vendor code in
         * every reader's cache.
         *
         * Decided by module path rather than by a list of package names: a list
         * emits empty chunks for anything not imported yet, and silently stops
         * splitting a library the day it moves behind a re-export.
         */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("echarts")) return "charts";
          if (id.includes("@react-awesome-query-builder")) return "querybuilder";
          if (id.includes("cmdk")) return "palette";
          if (id.includes("/antd/") || id.includes("@ant-design") || id.includes("/rc-")) {
            return "antd";
          }
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) {
            return "react";
          }
          return "vendor";
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
