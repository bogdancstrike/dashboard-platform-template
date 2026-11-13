import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vite.config";

/**
 * `npm run test:coverage` — the whole suite, measured, with a floor.
 *
 * Kept beside `vite.config.ts` rather than inside it so `npm test` stays the
 * fast run: instrumenting every module costs a third again on a full run.
 *
 * The floor is on the *total*, not on new code: the number answers "how much
 * of what we ship has a test that runs it", and a per-file floor would push
 * people to test the easy files twice rather than the hard ones once.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      // Instrumented, and on a machine running the whole suite at once, the
      // page-sized tests take up to twice their usual time; the default 20s
      // budget then measures the machine rather than the code.
      testTimeout: 45_000,
      coverage: {
        enabled: true,
        provider: "v8",
        reportOnFailure: true,
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/*.test.{ts,tsx}",
          // The fixtures, msw handlers and stubs the tests run against.
          "src/test/**",
          "src/**/*.d.ts",
          // The bootstrap: mounts the app into the real document and starts
          // Keycloak, which is what the e2e suite exercises.
          "src/main.tsx",
        ],
        reporter: ["text-summary", "json-summary", "json", "html"],
        reportsDirectory: "coverage",
        thresholds: { lines: 95 },
      },
    },
  }),
);
