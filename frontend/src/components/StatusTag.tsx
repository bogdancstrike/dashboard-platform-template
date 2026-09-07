/**
 * A record's state, coloured in a way that can be read (§55, §59).
 *
 * The obvious rendering is `<Tag color={statusColour}>`, which fills the tag
 * with the status colour and puts white text on it. AntD picks that white
 * without measuring anything: white on the amber this platform uses for
 * "warning" is 2.9:1, and on the green it uses for "resolved" 3.3:1. Both are
 * below the bar for text of any size, and the labels most worth reading — a
 * breach, a failure — are the ones that fail worst.
 *
 * So the colour moves to a rule down the leading edge and the text keeps the
 * surface's own ink. Nothing is lost: the vocabulary is the same, the hue is
 * the same, and the eye still finds a row of statuses by colour. What changes
 * is that the word beside the colour can be read.
 *
 * It is a component rather than a style because the alternative — every page
 * remembering to write the same inline border — is exactly how six pages ended
 * up with three different status tags.
 */

import { Tag } from "antd";

import { knownStatusColor } from "@/theme/tokens";

export function StatusTag({
  status,
  bordered = true,
  ...rest
}: {
  /** The vocabulary value the API returned — `OPEN`, `AT_RISK`, `DELIVERED`. */
  status: string | null | undefined;
  bordered?: boolean;
  "data-testid"?: string;
}) {
  if (!status) return null;

  return (
    <Tag
      {...rest}
      bordered={bordered}
      className="nu-status-tag"
      style={{
        // A named colour when the vocabulary has one, and the neutral border
        // when it does not — a status nobody has assigned a meaning to should
        // look unassigned rather than borrow the last one's.
        borderInlineStartColor: knownStatusColor(status) ?? "var(--nu-border-strong)",
      }}
    >
      {/* The vocabulary verbatim, because it is what the API returns, what a
          filter URL carries and what a reader quotes in a ticket. The lists
          show the same string, and a tag that prettified it would be the one
          place the two disagreed. */}
      {status}
    </Tag>
  );
}
