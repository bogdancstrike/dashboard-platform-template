import type { ReactNode } from "react";
import { Button, Result, Space, Tooltip, Typography } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";

/**
 * One surface for every way the platform can fail to show a page (§34).
 *
 * There were three before this, each written where somebody happened to need
 * it: a bare `404` in the router, a `403` in the shell, and "Could not sign you
 * in" at boot. Three tones, three shapes, and none of them carrying the
 * correlation id — so the one thing a reader can hand to somebody who could
 * actually help was the one thing missing. A fourth was absent entirely: a
 * component that threw took the whole application down to a white page.
 *
 * The declaration is the point. Each kind says **what happened** and **what to
 * do next**, in that order, because a page that only names the status code has
 * told the reader nothing they can act on; and whether a retry could plausibly
 * help, which is what decides the primary button. A wrong address does not get
 * a "Try again" that will fail identically, and a server fault does not get a
 * link to the noticeboard.
 *
 * Deliberately not an `EmptyState`: an empty list is a normal answer to a
 * reasonable question, and dressing a failure as one teaches a reader to
 * ignore both.
 */

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

/**
 * The correlation id, rendered so it can leave the screen.
 *
 * Selectable text *and* a copy button: the id is thirty-two characters of hex
 * and reading it off a screen into a chat window is how it arrives wrong.
 */
function Reference({ correlationId }: { correlationId: string }) {
  return (
    <div className="nu-problem-ref" data-testid="problem-reference">
      <Typography.Text type="secondary">Reference</Typography.Text>
      <Typography.Text code copyable={{ icon: <CopyOutlined />, tooltips: false }}>
        {correlationId}
      </Typography.Text>
    </div>
  );
}

/** "Back to home", routed inside the shell and a real navigation outside it. */
function HomeButton({
  standalone,
  type,
}: {
  standalone: boolean;
  type: "default" | "primary";
}) {
  const button = <Button type={type}>Back to home</Button>;
  if (standalone) return <a href="/">{button}</a>;
  return <Link to="/">{button}</Link>;
}

export function ProblemPage({
  kind,
  correlationId,
  missing = [],
  detail,
  onRetry,
  onSignIn,
  standalone = false,
}: {
  kind: ProblemKind;
  /** From the failed request, when there was one. */
  correlationId?: string;
  /** The permissions the server named, for `forbidden`. */
  missing?: string[];
  /** Anything the caller knows that the declaration cannot. */
  detail?: ReactNode;
  /** Supplied when the caller can actually retry; the button is hidden otherwise. */
  onRetry?: () => void;
  /**
   * What "Sign in again" does.
   *
   * Supplied by the route, because the correct action is not a reload: a
   * revoked session is keyed on the identity provider's session id, and a
   * browser holding the SSO cookie reloads straight back into the same one.
   * See `keycloak.signInAgain`.
   */
  onSignIn?: () => void;
  /** Outside the shell — at boot, before there is a sidebar to sit next to. */
  standalone?: boolean;
}) {
  const problem = PROBLEMS[kind];
  // The marker is on a wrapper rather than on `Result`: AntD does not forward
  // unknown props to its root, so a `data-testid` handed to it disappears.
  const body = (
    <div className="nu-problem-wrap" data-testid={`problem-${kind}`}>
    <Result
      className="nu-problem"
      status={problem.status}
      title={problem.title}
      subTitle={
        <div className="nu-problem-text">
          <p>{problem.happened}</p>
          <p>{problem.next}</p>
          {missing.length > 0 && (
            // The same sentence every disabled control in the product uses,
            // word for word. A refusal phrased one way in a tooltip and
            // another on a page reads as two different rules.
            <p data-testid="problem-missing">
              Your role does not include {missing.join(" and ")}.
            </p>
          )}
          {detail && <div className="nu-problem-detail">{detail}</div>}
          {correlationId && <Reference correlationId={correlationId} />}
        </div>
      }
      extra={
        <Space wrap>
          {problem.retryable && onRetry && (
            <Button type="primary" onClick={onRetry} data-testid="problem-retry">
              Try again
            </Button>
          )}
          {/* Always a way out that does not depend on whatever just failed —
              and a plain anchor when standalone, because the boot screen
              renders *outside* the router and a `Link` there throws while
              trying to explain why something else threw. */}
          <HomeButton
            standalone={standalone}
            type={problem.retryable && onRetry ? "default" : "primary"}
          />
          {(kind === "session_expired" || kind === "unauthorized") && (
            <Tooltip title="Asks the sign-in page for your details again">
              <Button
                onClick={() => (onSignIn ? onSignIn() : window.location.reload())}
                data-testid="problem-signin"
              >
                Sign in again
              </Button>
            </Tooltip>
          )}
        </Space>
      }
    />
    </div>
  );

  return standalone ? <div className="nu-boot nu-boot--problem">{body}</div> : body;
}
