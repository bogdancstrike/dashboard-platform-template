import type { ReactNode } from "react";
import { Button, Popconfirm, Tooltip } from "antd";

import type { Job } from "@/api/jobs";

import { whyNot } from "./jobFormat";

/**
 * One control, disabled with its reason rather than hidden.
 *
 * The reason comes from `whyNot`, so the tooltip always says something an
 * operator can act on — "not while it is running" and "all three attempts have
 * been used" are different problems with different fixes, and a shared "not
 * allowed" would have told them neither.
 */
export function JobAction({
  job,
  action,
  icon,
  busy,
  onConfirm,
}: {
  job: Job;
  action: "retry" | "cancel";
  icon: ReactNode;
  busy: boolean;
  onConfirm: () => void;
}) {
  const reason = whyNot(job, action);
  const label = action === "retry" ? "Retry" : "Cancel";
  // What the *confirmation* button says, which is not the same word as the
  // control. AntD's Popconfirm dismisses itself with a button labelled
  // "Cancel", so an action also called "Cancel" produced a dialog offering
  // "Cancel" and "Cancel" — found by a test that could not tell them apart,
  // which is exactly the trouble a reader would have had.
  const confirmLabel = action === "retry" ? "Retry" : "Stop the job";
  const allowed = reason === null;

  const button = (
    <Button
      type="text"
      icon={icon}
      disabled={!allowed || busy}
      aria-label={`${label} ${job.reference}`}
      data-testid={`${action}-${job.reference}`}
      onClick={(event) => event.stopPropagation()}
    />
  );

  // The tooltip belongs to the *disabled* case and only to it. That is where
  // it carries information — which of the two refusals this is — and the
  // enabled path already says the same word three times over: the button's
  // own accessible name, the confirmation's title, and its Ok label. Worse
  // than redundant, in fact: a Tooltip nested inside a Popconfirm renders a
  // second popover over the first, and the hint ended up covering the button
  // it was describing, which is how this was found.
  if (!allowed) {
    return <Tooltip title={reason}>{button}</Tooltip>;
  }

  return (
    <Popconfirm
      title={action === "retry" ? `Run ${job.reference} again?` : `Stop ${job.reference}?`}
      description={
        action === "retry"
          ? `This will be attempt ${job.attempt + 1} of ${job.max_attempts}, on the same job.`
          : "The job stays in the queue, marked cancelled."
      }
      okText={confirmLabel}
      onConfirm={onConfirm}
      onPopupClick={(event) => event.stopPropagation()}
    >
      {button}
    </Popconfirm>
  );
}
