import type { ReactNode } from "react";

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

import { ProblemActions } from "./ProblemActions";
import { ProblemMark, Reference, emphasiseLast } from "./parts";
import { ERROR_SLUGS, PROBLEMS, type ProblemKind } from "./problems";

export { ERROR_SLUGS, PROBLEMS, PROBLEM_KINDS, problemFor, type ProblemKind } from "./problems";

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
    <div className="nu-problem-wrap nx-fd-problem-wrap" data-testid={`problem-${kind}`}>
      <section className="nu-problem nx-fd-problem nx-glass nx-glass--strong" aria-labelledby="nx-fd-problem-title">
        <ProblemMark code={ERROR_SLUGS[kind]} />
        <h1 id="nx-fd-problem-title" className="nx-fd-problem-title">
          {emphasiseLast(problem.title)}
        </h1>
        <div className="nu-problem-text nx-fd-problem-text">
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
        </div>
        <ProblemActions kind={kind} missing={missing} standalone={standalone} onRetry={onRetry} onSignIn={onSignIn} />
        {correlationId ? (
          <Reference correlationId={correlationId} />
        ) : (
          <span className="nx-fd-problem-where">
            {typeof window !== "undefined" ? window.location.pathname : ""} · {ERROR_SLUGS[kind]}
          </span>
        )}
      </section>
    </div>
  );

  return standalone ? <div className="nu-boot nu-boot--problem">{body}</div> : body;
}
