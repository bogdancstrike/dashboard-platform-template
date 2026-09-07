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
      // `ws` so the live notification channel (§17) survives the dev proxy as
      // well as nginx — without it the socket only works in the built image,
      // which is the worst place to discover it is broken.
      "/platform": { target: "http://localhost:5101", changeOrigin: true, ws: true },
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
    // jsdom, minus the AbortController it would otherwise shadow Node's with.
    // See src/test/environment.ts for why that one substitution matters.
    environment: "./src/test/environment.ts",
    setupFiles: ["./src/test/setup.ts"],
    alias: {
      // jsdom has no canvas, and a real chart throws inside zrender on dispose.
      // The card around it is what these tests are about.
      // The more specific entry first: Vite matches an alias by prefix, so
      // `echarts-for-react` would otherwise swallow `.../lib/core` and rewrite
      // it to a path inside the stub file.
      //
      // The map page imports the *core* build so its chunk carries only the
      // chart types it draws. Same stub, because jsdom's lack of a canvas is
      // the same problem whichever build asked for one.
      "echarts-for-react/lib/core": fileURLToPath(
        new URL("./src/test/stubs/echarts-for-react.tsx", import.meta.url),
      ),
      "echarts-for-react": fileURLToPath(
        new URL("./src/test/stubs/echarts-for-react.tsx", import.meta.url),
      ),
    },
    // `e2e/` belongs to Playwright. Vitest picking it up loads Playwright's
    // `test.describe` outside a Playwright runner, which fails in a way that
    // reads like a dependency conflict rather than a misrouted file.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
    // The API is mocked at the network boundary (MSW), so a component test
    // exercises the real fetch path rather than a hand-stubbed module.
    restoreMocks: true,
    // Vitest's 5s default is a budget for one interaction, and these tests
    // render whole pages against a mocked network while several other files
    // do the same on other workers. Every test that has hit it passed in
    // isolation seconds later, which makes it a measure of how loaded the
    // machine is rather than of anything the component did — and a suite that
    // fails differently depending on the machine is a suite nobody trusts.
    testTimeout: 20_000,
  },
});
