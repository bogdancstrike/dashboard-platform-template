import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  ERROR_SLUGS,
  PROBLEMS,
  PROBLEM_KINDS,
  ProblemPage,
  problemFor,
  type ProblemKind,
} from "@/components/ProblemPage";

/**
 * The problem surface (§34).
 *
 * Three properties, and each of them is a thing the three ad-hoc error screens
 * this replaced got wrong at least once:
 *
 * **Every kind says what happened and what to do.** Asserted over the whole
 * declaration rather than one example, because the failure mode is a kind
 * added later with a title and nothing else.
 *
 * **A retry appears only where a retry could work.** A "Try again" on a 404 is
 * a button that fails identically on the second press, and a reader who
 * presses one of those stops believing the rest.
 *
 * **The correlation id is shown when there is one.** It is the only thing on
 * the page somebody else can act on, and it was missing from all three
 * predecessors.
 */

const KINDS = Object.keys(PROBLEMS) as ProblemKind[];

function show(kind: ProblemKind, props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ProblemPage kind={kind} {...props} />
    </MemoryRouter>,
  );
}

describe("the declaration", () => {
  it.each(KINDS)("%s says what happened and what to do next", (kind) => {
    const problem = PROBLEMS[kind];
    // A status code is not an explanation. Both halves, and both as sentences
    // — the length check is crude but it catches the real failure, which is a
    // kind added with a title and a shrug.
    expect(problem.happened.length).toBeGreaterThan(30);
    expect(problem.next.length).toBeGreaterThan(20);
    expect(problem.title).not.toMatch(/^\d+$/);
  });

  it("marks only the recoverable kinds as retryable", () => {
    // The distinction the button depends on: asking again cannot fix a wrong
    // address or a role that lacks a permission.
    expect(PROBLEMS.server.retryable).toBe(true);
    expect(PROBLEMS.maintenance.retryable).toBe(true);
    expect(PROBLEMS.not_found.retryable).toBe(false);
    expect(PROBLEMS.forbidden.retryable).toBe(false);
    expect(PROBLEMS.unauthorized.retryable).toBe(false);
    expect(PROBLEMS.session_expired.retryable).toBe(false);
  });
});

describe("classifying a failure", () => {
  it("calls a connection that never answered maintenance, not a sign-in problem", () => {
    // The commonest boot failure in this stack, and the one the old screen got
    // wrong: `fetch` throws a `TypeError` when the API is not up, and "could
    // not sign you in" sends somebody to reset a password that was fine.
    expect(problemFor(new TypeError("Failed to fetch"))).toBe("maintenance");
    expect(problemFor(undefined)).toBe("maintenance");
  });

  it("maps each status to the page that explains it", () => {
    const at = (status: number) =>
      problemFor(new ApiError(status, { error: "e", message: "m" }, "cid"));
    expect(at(401)).toBe("unauthorized");
    expect(at(403)).toBe("forbidden");
    expect(at(404)).toBe("not_found");
    // A 5xx is the server being unable to answer, which reads to a waiting
    // reader as the platform being down — because for them it is.
    expect(at(500)).toBe("maintenance");
    expect(at(503)).toBe("maintenance");
    // Anything else that got a response is a fault, not an outage.
    expect(at(422)).toBe("server");
  });
});

describe("the addresses", () => {
  it("is served by the router for every kind", () => {
    // The slugs are declared here and written out literally in `App.tsx`,
    // because a template literal in the route table would be invisible to the
    // gallery's completeness test. Two places, so the correspondence is
    // asserted rather than assumed — a kind added here with no route is a link
    // in the showcase that 404s.
    const router = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const missing = PROBLEM_KINDS.filter(
      (kind) => !router.includes(`path="errors/${ERROR_SLUGS[kind]}"`),
    );
    expect(missing).toEqual([]);
  });

  it("covers every kind exactly once", () => {
    const slugs = Object.values(ERROR_SLUGS);
    expect(PROBLEM_KINDS).toHaveLength(Object.keys(PROBLEMS).length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("the page", () => {
  it.each(KINDS)("renders %s with a way out", (kind) => {
    show(kind);
    expect(screen.getByTestId(`problem-${kind}`)).toBeInTheDocument();
    expect(screen.getByText(PROBLEMS[kind].happened)).toBeInTheDocument();
    expect(screen.getByText(PROBLEMS[kind].next)).toBeInTheDocument();
    // Never a dead end: whatever failed, home does not depend on it.
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("offers a retry where one could work, and calls it", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    show("server", { onRetry: retry });

    await user.click(screen.getByTestId("problem-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offers no retry where retrying cannot help, even if handed one", () => {
    // The guard is in the declaration and not at the call site, so a caller
    // that passes `onRetry` to every kind — which is what a generic route
    // does — still cannot put a useless button on a 404.
    show("not_found", { onRetry: vi.fn() });
    expect(screen.queryByTestId("problem-retry")).not.toBeInTheDocument();
  });

  it("shows the correlation id when there is one", () => {
    const { unmount } = show("server", { correlationId: "abc123def456" });
    expect(screen.getByTestId("problem-reference")).toHaveTextContent("abc123def456");
    unmount();

    // And no empty "Reference" label when there is nothing to reference — a
    // heading over a blank space is worse than the absence of both.
    show("server");
    expect(screen.queryByTestId("problem-reference")).not.toBeInTheDocument();
  });

  it("names the missing permission rather than saying 'forbidden'", () => {
    show("forbidden", { missing: ["records.export", "reports.manage"] });
    // "You do not have permission" tells somebody nothing they can ask for —
    // and it is the same sentence every disabled control in the product uses,
    // because a refusal phrased two ways reads as two different rules.
    expect(screen.getByTestId("problem-missing")).toHaveTextContent(
      "Your role does not include records.export and reports.manage.",
    );
  });

  it("hands 'Sign in again' to the caller rather than reloading", async () => {
    /**
     * A reload is the wrong action and it took a lockout to find out.
     *
     * `UserSession` revocation is keyed on the identity provider's session id.
     * A browser that still holds the SSO cookie reloads straight back into the
     * same session, gets the same id, and is refused again — so the only
     * button on the page does nothing and the reader cannot get in without
     * clearing cookies. The route passes `keycloak.signInAgain`, which forces
     * a fresh authentication.
     */
    const user = userEvent.setup();
    const signIn = vi.fn();
    show("session_expired", { onSignIn: signIn });

    await user.click(screen.getByTestId("problem-signin"));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("uses a plain anchor when it renders outside the router", () => {
    // The boot screen renders before `BrowserRouter` exists, and a `Link`
    // there throws while trying to explain why something else threw.
    render(<ProblemPage kind="maintenance" standalone />);
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });
});
