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

    // No `manualChunks`. Splitting vendor code by module path looked like free
    // cache efficiency and shipped a broken bundle: `rc-resize-observer` landed
    // in one chunk and the `resize-observer-polyfill` it constructs in another,
    // and the resulting cross-chunk cycle left the constructor undefined at the
    // moment it was called — "kp is not a constructor", thrown from
    // observerUtil.js on first render, with the page blank.
    //
    // Rollup's default chunking derives the graph from the imports themselves
    // and cannot produce that. Route-level `import()` is the way to split this
    // app; hand-partitioning somebody else's dependency graph is not.
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
