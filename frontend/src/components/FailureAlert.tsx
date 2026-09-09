import type { ReactNode } from "react";
import { Alert, Button, Space, Typography } from "antd";

import { ApiError } from "@/api/client";

const { Text } = Typography;

/**
 * The failure state, once, for every data view that has one (§34, §76).
 *
 * There were four of these — one in the entity chrome, one in the detail-page
 * hook, one beside the record preview, one inside the edit drawer — each
 * written where somebody happened to need it, and the chart card was about to
 * become a fifth. Four copies of "what failed, what is missing, the id to
 * quote, and a retry" is four chances to leave one of the four out, and the
 * copies had already drifted: two said `Correlation ID: …`, two said the id
 * alone, and only two of the four made it copyable — the one thing a reader
 * can hand to somebody who could actually help.
 *
 * What must agree is the *contract*: a refusal is a warning and a fault is an
 * error, a missing permission is named in words, the correlation id is always
 * there and always copyable, and a retry is offered only when trying again
 * could plausibly work. What must not agree is the wording: "Task not found"
 * and "Your role does not include this dataset" lead somewhere different, and
 * only the page knows which noun it is talking about. So the kinds and the
 * furniture live here and the sentences stay at the call site.
 *
 * Deliberately not an `EmptyState`: an empty list is a normal answer to a
 * reasonable question, and dressing a failure as one teaches a reader to
 * ignore both. Deliberately not a `ProblemPage` either — that one owns the
 * whole window, and a panel that failed inside a working page should not
 * blank the page around it.
 */

/** Why a view has no data, in the four flavours that lead somewhere different. */
export type FailureKind = "not_found" | "forbidden" | "conflict" | "failed";

/**
 * Which of the four this error is.
 *
 * A non-`ApiError` — a network drop, a parse fault, a thrown string — is
 * `failed`: something broke and trying again may well work.
 */
export function failureKind(error: unknown): FailureKind {
  if (!(error instanceof ApiError)) return "failed";
  if (error.isNotFound) return "not_found";
  if (error.isForbidden) return "forbidden";
  if (error.status === 409) return "conflict";
  return "failed";
}

/**
 * Whether pressing the same button again could plausibly help.
 *
 * A retry on a 404 promises the address will resolve on the second press, and
 * a retry on a refusal promises the reader's role might change in between.
 * Both teach the reader that this platform's buttons do not mean anything.
 */
export function retryHelps(kind: FailureKind): boolean {
  return kind === "failed" || kind === "conflict";
}

/** What to do next, where the kind implies an answer a status code does not. */
const ADVICE: Partial<Record<FailureKind, string>> = {
  not_found: "It may have been deleted, or the link may be wrong.",
};

const GENERIC: Record<FailureKind, string> = {
  not_found: "Not found",
  forbidden: "Your role does not include this",
  conflict: "Somebody else changed this first",
  failed: "That could not be loaded",
};

export function FailureAlert({
  error,
  titles,
  hints,
  onRetry,
  className,
  action,
}: {
  error: unknown;
  /**
   * The headline, in the page's own words, per kind.
   *
   * Partial on purpose: a card that can only ever fail one way should not have
   * to invent sentences for the other three.
   */
  titles?: Partial<Record<FailureKind, ReactNode>>;
  /**
   * The sentence under the headline, replacing the default.
   *
   * The default is the server's own message, which for a refusal or a fault is
   * more specific than anything the browser could guess — plus, for a record
   * that is not there, what to do about it. Those are two different sentences
   * ("what happened" and "what now") and a view that drops the second leaves
   * the reader holding a status code.
   */
  hints?: Partial<Record<FailureKind, ReactNode>>;
  /** Refetch whatever failed. Ignored for the kinds a retry cannot fix. */
  onRetry?: () => void;
  className?: string;
  /** Somewhere else to go, when retrying is not the way out. */
  action?: ReactNode;
}) {
  const kind = failureKind(error);
  const api = error instanceof ApiError ? error : null;
  const said = api?.message ?? (error instanceof Error ? error.message : undefined);
  const hint = hints?.[kind] ?? said;
  // What to do about it, where the kind implies something. Suppressed when the
  // caller wrote their own sentence, so the two do not contradict each other.
  const advice = hints?.[kind] === undefined ? ADVICE[kind] : undefined;

  return (
    <Alert
      className={className}
      // A refusal and a stale write are answers; only a fault is a fault.
      type={kind === "failed" ? "error" : "warning"}
      showIcon
      // One handle for a test that asks "is this view showing a failure",
      // whichever of the four it is.
      data-testid="failure-alert"
      data-failure={kind}
      message={titles?.[kind] ?? GENERIC[kind]}
      description={
        <Space direction="vertical" size={4}>
          {hint && <Text type="secondary">{hint}</Text>}
          {advice && <Text type="secondary">{advice}</Text>}
          {api && api.missingPermissions.length > 0 && (
            // The same sentence every disabled control in the product uses
            // (§34, §76): a reader who sees "Your role does not include
            // records.update" on a greyed-out menu item should read the same
            // words when the request behind it is refused, and "Missing:
            // records.update" is a third dialect of the same fact.
            <Text type="secondary">
              Your role does not include {api.missingPermissions.join(", ")}
            </Text>
          )}
          {api && (
            <Text code copyable={{ text: api.correlationId }}>
              {api.correlationId}
            </Text>
          )}
        </Space>
      }
      action={
        action ??
        (onRetry && retryHelps(kind) ? (
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined)
      }
    />
  );
}
