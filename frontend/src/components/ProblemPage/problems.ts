/**
 * Every way a page can fail to appear, declared: what happened, what to do
 * next, and whether a retry could help. The page draws whichever it is given.
 */
import { ApiError } from "@/api/client";

/** Every way a page can fail to appear. */
export type ProblemKind =
  | "unauthorized"
  | "session_expired"
  | "forbidden"
  | "not_found"
  | "switched_off"
  | "server"
  | "maintenance";

interface Problem {
  /** AntD's own status, which supplies the illustration. */
  status: "403" | "404" | "500" | "error" | "warning" | "info";
  title: string;
  /** What happened, in the reader's terms. No blame, no stack. */
  happened: string;
  /** What to do about it — the half a status code cannot express. */
  next: string;
  /**
   * Whether trying the same thing again could plausibly work.
   *
   * This is not decoration: a retry button on a 404 is a promise the address
   * will resolve on the second press, and pressing it teaches the reader that
   * the platform's buttons do not mean anything.
   */
  retryable: boolean;
}

export const PROBLEMS: Record<ProblemKind, Problem> = {
  unauthorized: {
    status: "403",
    title: "You are not signed in",
    happened: "This page needs to know who you are, and no credential reached it.",
    next: "Sign in and the address you asked for will open.",
    retryable: false,
  },
  session_expired: {
    status: "warning",
    title: "Your session ended",
    happened:
      "The credential this tab was using is no longer valid — it expired, or the session was signed out from somewhere else.",
    // Named rather than done silently, because the silent version is a loop:
    // re-authenticating against a sign-in that is itself gone bounces the
    // reader between two pages forever with nothing ever shown.
    next: "Sign in again to carry on where you were.",
    retryable: false,
  },
  forbidden: {
    status: "403",
    title: "Permission required",
    happened: "Your role does not carry what this page needs.",
    next: "Ask an administrator for it, or go somewhere you can act.",
    retryable: false,
  },
  /**
   * A page whose *feature* is off, which is not the same as a page you may
   * not see (§27).
   *
   * Said differently from a permission refusal on purpose: a permission is a
   * fact about the reader, and telling somebody "your role does not include
   * this" when an administrator has switched the whole feature off is a lie
   * about them. The person most likely to arrive here by address is that
   * administrator, moments after doing it.
   */
  switched_off: {
    status: "info",
    title: "This feature is switched off",
    happened:
      "It is turned off for this platform, or not yet rolled out to you. Nothing about your role is the reason.",
    next: "An administrator can turn it on under Administration → Feature flags.",
    retryable: false,
  },
  not_found: {
    status: "404",
    title: "No page answers to that address",
    happened: "The address is not one this platform serves, or what it pointed at is gone.",
    next: "Check the address, or start again from a page you know.",
    retryable: false,
  },
  server: {
    status: "500",
    title: "Something broke on this page",
    happened: "The page failed while it was being drawn. Nothing you did caused it.",
    // Retryable and honest about *why*: a render fault is often a fault in one
    // response, and the same page drawn again from a fresh read frequently
    // works. When it does not, the id below is what makes it findable.
    next: "Try it again. If it happens twice, send somebody the reference below.",
    retryable: true,
  },
  maintenance: {
    status: "info",
    title: "The platform is not answering",
    happened:
      "The API could not be reached. It may be restarting, or being deployed.",
    next: "Wait a moment and try again — nothing you had saved is lost.",
    retryable: true,
  },
};

/**
 * The address each problem page answers to.
 *
 * The status code, because that is what somebody looking for the page will
 * type. Declared here and written out literally in `App.tsx` — a template
 * literal in the route table would be invisible to the gallery's completeness
 * test (§61), which reads concrete paths. That leaves the slugs in two places,
 * so `ProblemPage.test.tsx` asserts the router serves every one of them.
 */
export const ERROR_SLUGS: Record<ProblemKind, string> = {
  unauthorized: "401",
  forbidden: "403",
  not_found: "404",
  server: "500",
  maintenance: "maintenance",
  session_expired: "session-expired",
  // Reached by the shell rather than by address — a feature being off is a
  // fact about a *route*, not a status somebody navigates to — but it is in
  // the map so the gallery lists it and the router serves it.
  switched_off: "switched-off",
};

/** In the order a reader meets them, which is roughly least to most alarming. */
export const PROBLEM_KINDS = Object.keys(ERROR_SLUGS) as ProblemKind[];

/**
 * Which problem a failure actually is.
 *
 * "Could not sign you in" was the boot screen's answer to all of them, and it
 * was the wrong one most of the time: the commonest boot failure in this stack
 * is the API not being up yet, which is not a sign-in problem, is not the
 * reader's fault, and *is* worth waiting a moment for. Telling somebody their
 * credentials failed while a container restarts sends them to reset a password
 * that was never the problem.
 *
 * Lives here rather than at the call site so that every caller classifies the
 * same way, and so it can be tested — `main.tsx` renders on import.
 */
export function problemFor(error: unknown): ProblemKind {
  // Not an `ApiError` at all means no response came back: `fetch` throws a
  // `TypeError` when the connection is refused, which is the API being down.
  if (!(error instanceof ApiError)) return "maintenance";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not_found";
  if (error.status >= 500) return "maintenance";
  return "server";
}
