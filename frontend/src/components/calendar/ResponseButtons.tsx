/**
 * Answering an invitation (§19, §64).
 *
 * Three buttons, and deliberately not a `Segmented`. The first version was one,
 * with `value={undefined}` for an unanswered invitation — and AntD's Segmented
 * has no unselected state: given no value it highlights the *first* option. So
 * every invitation nobody had answered rendered as **Going**, telling the
 * reader they had accepted something they had never looked at, directly beside
 * the sentence "You have not answered yet."
 *
 * A control that cannot say "no answer" is the wrong control for a question
 * whose commonest answer is silence. Three buttons can: none of them is
 * primary until one is chosen, and the chosen one says so in its shape as well
 * as its colour.
 *
 * Shared by the agenda row and the drawer, because it is the same question in
 * both — and because a second copy is how one of them ends up with the bug
 * this component exists to have fixed.
 */

import { Button, Space, Tooltip } from "antd";

import type { EventResponse } from "@/api/calendar";

/** What each answer commits the reader to, said in the control itself. */
export const ANSWERS: ReadonlyArray<{ value: EventResponse; label: string; hint: string }> = [
  { value: "ACCEPTED", label: "Going", hint: "You will be there." },
  { value: "TENTATIVE", label: "Maybe", hint: "You might be there — the organiser sees this." },
  { value: "DECLINED", label: "No", hint: "You will not be there." },
];

export function ResponseButtons({
  value,
  onChange,
  disabled,
  size = "small",
  label,
}: {
  /** The reader's own answer. `NEEDS_ACTION` renders as *nothing* chosen. */
  value: EventResponse | null;
  onChange: (response: EventResponse) => void;
  disabled?: boolean;
  size?: "small" | "middle";
  /** What the group is for, for a reader who cannot see the row it is in. */
  label: string;
}) {
  return (
    <Space.Compact size={size} aria-label={label} data-testid="response-buttons">
      {ANSWERS.map((answer) => {
        const chosen = value === answer.value;
        return (
          <Tooltip key={answer.value} title={answer.hint}>
            <Button
              size={size}
              // Solid when chosen and outlined when not, so "which one did I
              // pick" survives a screenshot and a reader who cannot separate
              // the accent from the border (§64).
              type={chosen ? "primary" : "default"}
              disabled={disabled}
              aria-pressed={chosen}
              onClick={() => onChange(answer.value)}
            >
              {answer.label}
            </Button>
          </Tooltip>
        );
      })}
    </Space.Compact>
  );
}
