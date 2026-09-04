/**
 * Lint rules, kept to the ones that catch real defects.
 *
 * TypeScript already enforces the shape of the code — `strict`,
 * `noUnusedLocals`, `noUncheckedIndexedAccess` — so nothing here repeats it.
 * What is left is the class of mistake a type checker cannot see: a hook whose
 * dependency list has drifted from its body, a promise nobody awaited, a
 * comparison that is always true. Those are the rules worth failing a build on.
 *
 * Deliberately absent: stylistic rules. Formatting is not a defect, and a lint
 * run that spends its output on quote characters trains people to skim it.
 *
 * Errors fail the run; warnings are advice and do not. The distinction is the
 * point: `no-unnecessary-condition` is usually right and occasionally wrong —
 * the DOM types promise `window.matchMedia` always exists, and jsdom disagrees
 * — so it advises rather than blocks, and the places it is wrong carry a
 * comment saying why rather than a silent exemption.
 */

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import typescript from "typescript-eslint";

export default typescript.config(
  { ignores: ["dist", "coverage", "playwright-report", "test-results", ".auth"] },

  js.configs.recommended,
  // Type-aware: the rules that matter most — floating promises, unnecessary
  // conditions — need the type checker, not just the syntax tree.
  ...typescript.configs.recommendedTypeChecked,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // An unawaited promise is how an error becomes an unhandled rejection
      // nobody sees, and how a test passes before its assertion runs.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        // `onClick={() => void save()}` is idiomatic and not a mistake.
        { checksVoidReturn: { attributes: false } },
      ],

      // `any` defeats the type checker silently; an explicit cast at least
      // says where somebody decided to stop being sure.
      "@typescript-eslint/no-explicit-any": "error",

      // TypeScript reports unused values already, and its version understands
      // declaration merging and overloads, so the lint copy only duplicates it.
      "@typescript-eslint/no-unused-vars": "off",

      // Reads as pedantic until it catches `if (response.ok === true)` on a
      // value that is never anything else — a condition that was meant to test
      // something and no longer does.
      "@typescript-eslint/no-unnecessary-condition": "warn",
    },
  },

  {
    // Tests describe behaviour that is deliberately wrong-shaped: a malformed
    // payload, a value the API should reject. Asserting on those needs casts.
    files: ["**/*.test.{ts,tsx}", "src/test/**", "e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
);
