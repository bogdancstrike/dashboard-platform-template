import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";
import { errorText } from "@/lib/errors";

/**
 * One failure, one sentence.
 *
 * This module exists because three pages had each written their own version
 * and the versions had drifted — one said "Unknown error", one named the
 * missing permission, one appended the correlation id. The tests pin the two
 * halves that were being lost: a refusal has to name what to ask for, and
 * everything else has to carry the id a support ticket needs.
 */
const refusal = (details: Record<string, unknown>) =>
  new ApiError(403, { error: "forbidden", message: "no", details }, "corr-1");

describe("what a reader is told", () => {
  it("names the missing privilege on a refusal", () => {
    // Without it somebody has to guess whether to ask for access or stop
    // asking.
    expect(errorText(refusal({ missing_labels: ["Export records"] }))).toContain(
      "Export records",
    );
  });

  it("names the action, so a reader knows which attempt was refused", () => {
    expect(errorText(refusal({}), { action: "export" })).toBe(
      "You do not have permission to export.",
    );
    expect(errorText(refusal({}))).toBe("You do not have permission to do that.");
  });

  it("carries the correlation id on everything else", () => {
    const failure = new ApiError(
      500,
      { error: "internal_error", message: "it broke" },
      "corr-9",
    );
    // A screenshot with the id is a failure somebody can find in the log.
    expect(errorText(failure)).toBe("it broke · corr-9");
  });

  it("falls back rather than showing a stack-trace message", () => {
    expect(errorText(new TypeError(""), { fallback: "The export failed." })).toBe(
      "The export failed.",
    );
    expect(errorText(undefined)).toBe("Something went wrong.");
  });

  it("passes an ordinary Error's own message through", () => {
    expect(errorText(new Error("the query could not be run"))).toBe(
      "the query could not be run",
    );
  });
});
