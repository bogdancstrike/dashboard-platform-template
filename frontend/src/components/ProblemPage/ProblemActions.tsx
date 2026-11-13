import { Button, Tooltip } from "antd";

import { AskForAccess } from "@/components/decisions/AskForAccess";

import { HomeButton } from "./parts";
import { PROBLEMS, type ProblemKind } from "./problems";

interface ProblemActionsProps {
  kind: ProblemKind;
  missing: string[];
  standalone: boolean;
  onRetry?: () => void;
  onSignIn?: () => void;
}

/** Try again when it could help, always a way home, and the kind's own way forward. */
export function ProblemActions({ kind, missing, standalone, onRetry, onSignIn }: ProblemActionsProps) {
  const problem = PROBLEMS[kind];
  return (
    <div className="nx-fd-problem-actions">
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
      {/* Time & decisions: a refusal you can answer — the request goes to
          the approvals inbox of the people who grant permissions. */}
      {kind === "forbidden" && !standalone && missing.length > 0 && <AskForAccess missing={missing} />}
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
    </div>
  );
}
