import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import { FailureAlert, failureKind, retryHelps } from "@/components/FailureAlert";
import { renderWithProviders } from "@/test/render";

/**
 * The failure contract every data view now shares (§34, §76).
 *
 * Six views had written this alert for themselves — the entity chrome, the
 * detail hook, the generic record page, the record preview, the edit drawer,
 * the dashboard — and the copies had drifted exactly where it costs something:
 * two printed the correlation id without making it copyable, one omitted it
 * altogether, and three offered a "Retry" on a 404. These are pure rules, so
 * they are asserted as rules rather than through six pages.
 */

const body = (details: Record<string, unknown> = {}) => ({
  error: "refused",
  message: "The server's own sentence.",
  details,
});

describe("which failure this is", () => {
  it.each([
    { status: 404, kind: "not_found" },
    { status: 403, kind: "forbidden" },
    { status: 409, kind: "conflict" },
    { status: 500, kind: "failed" },
    { status: 502, kind: "failed" },
    { status: 422, kind: "failed" },
  ])("reads a $status as $kind", ({ status, kind }) => {
    expect(failureKind(new ApiError(status, body(), "trace"))).toBe(kind);
  });

  it("treats anything that is not an API answer as a fault", () => {
    // A dropped connection, a parse fault, a thrown string: something broke,
    // and trying again is the reasonable response to all three.
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("failed");
    expect(failureKind("boom")).toBe("failed");
    expect(failureKind(undefined)).toBe("failed");
  });

  /**
   * The same rule the error pages hold to (`PROBLEMS.not_found.retryable`).
   * A retry on a 404 promises the address will resolve on the second press,
   * and on a refusal that the reader's role changed while they were reading.
   */
  it("offers a retry only where trying again could work", () => {
    expect(retryHelps("failed")).toBe(true);
    expect(retryHelps("conflict")).toBe(true);
    expect(retryHelps("not_found")).toBe(false);
    expect(retryHelps("forbidden")).toBe(false);
  });
});

describe("what a failed view shows", () => {
  it("carries the correlation id, and makes it copyable", () => {
    renderWithProviders(<FailureAlert error={new ApiError(500, body(), "trace-42")} />);

    const failure = screen.getByTestId("failure-alert");
    expect(failure).toHaveTextContent("trace-42");
    // The one thing a reader can hand to somebody who could actually help, so
    // it must not have to be transcribed off the screen by eye. Asserted
    // structurally: the clipboard itself is not reachable from jsdom, where
    // AntD's copy falls back to `document.execCommand`.
    const copyable = failure.querySelector(".ant-typography-copy");
    expect(copyable).toBeInTheDocument();
    expect(copyable?.closest(".ant-typography")).toHaveTextContent("trace-42");
  });

  it("names a missing permission in the sentence the disabled controls use", () => {
    renderWithProviders(
      <FailureAlert error={new ApiError(403, body({ missing: ["records.update"] }), "t")} />,
    );

    // A greyed-out menu item says "Edit — needs records.update" and its
    // tooltip says "Your role does not include records.update"; the refusal
    // behind it must not invent a third dialect.
    expect(screen.getByTestId("failure-alert")).toHaveTextContent(
      "Your role does not include records.update",
    );
  });

  it("says what happened and, for a record that is gone, what to do", () => {
    renderWithProviders(<FailureAlert error={new ApiError(404, body(), "t")} />);

    const failure = screen.getByTestId("failure-alert");
    expect(failure).toHaveTextContent("The server's own sentence.");
    expect(failure).toHaveTextContent("It may have been deleted, or the link may be wrong.");
  });

  it("lets the view supply its own sentence instead", () => {
    renderWithProviders(
      <FailureAlert
        error={new ApiError(404, body(), "t")}
        titles={{ not_found: "That dashboard has been deleted" }}
        hints={{ not_found: "Somebody removed it while you had the link open." }}
      />,
    );

    const failure = screen.getByTestId("failure-alert");
    expect(failure).toHaveTextContent("That dashboard has been deleted");
    expect(failure).toHaveTextContent("Somebody removed it while you had the link open.");
    // One sentence, not two contradicting each other.
    expect(failure).not.toHaveTextContent("It may have been deleted");
  });

  it("is a warning for an answer and an error for a fault", () => {
    const { container, unmount } = renderWithProviders(
      <FailureAlert error={new ApiError(403, body(), "t")} />,
    );
    // A refusal is a correct answer to a reasonable request, and colouring it
    // the same red as a broken server teaches a reader to ignore both.
    expect(container.querySelector(".ant-alert-warning")).toBeInTheDocument();
    unmount();

    const fault = renderWithProviders(<FailureAlert error={new ApiError(500, body(), "t")} />);
    expect(fault.container.querySelector(".ant-alert-error")).toBeInTheDocument();
  });

  it("still says something useful when the failure is not an API answer", () => {
    const retry = vi.fn();
    renderWithProviders(<FailureAlert error={new TypeError("Failed to fetch")} onRetry={retry} />);

    const failure = screen.getByTestId("failure-alert");
    expect(failure).toHaveTextContent("Failed to fetch");
    // No id to quote, because there was no round trip to correlate — and a
    // retry, because a dropped connection is the case where it works.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });
});
