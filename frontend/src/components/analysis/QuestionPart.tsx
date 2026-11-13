import { Space, Tooltip, Typography } from "antd";

const { Text } = Typography;

/** What each control is *for*, said on hover rather than permanently. */
export const GUIDANCE = {
  resource: "Which records the question is asked of.",
  group: "The first axis. A date is read in the bucket beside it.",
  stack: "A second grouping — a stack, a nest, a heatmap's columns.",
  measure: "What is counted or added up for each group.",
  measure2: "A second measure. A scatter reads it as the vertical axis.",
  period: "How far back to look. Filters the rows, not the groups.",
} as const;

/**
 * One clause of the sentence: the word, then the control.
 *
 * The word is a `label` for what follows rather than a heading above it, which
 * is what makes the bar one row tall instead of three. The hint is the label's
 * tooltip, so it is available and costs nothing when it is not wanted.
 */
export function Part({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nu-question-part">
      <Tooltip title={hint}>
        <Text type="secondary" className="nu-question-label">
          {label}
        </Text>
      </Tooltip>
      <Space.Compact>{children}</Space.Compact>
    </div>
  );
}
