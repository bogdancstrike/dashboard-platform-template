import { Tag } from "antd";

/**
 * A chip whose colour is *data*, drawn so the label stays readable (§55).
 *
 * `<Tag color={someHex}>` fills the tag and puts white on it, and AntD picks
 * that white without measuring: white on this platform's green is 3.29:1, on
 * its teal 3.74:1 and on its cyan 3.68:1. Every role tag in the directory and
 * every widget-kind chip in the dashboard gallery was below the bar for text
 * of any size.
 *
 * `StatusTag` solved that for the *vocabulary* colours by moving the colour to
 * a rule down the leading edge, and a source-level test has kept status tags
 * honest since. But the same defect had two other shapes — a role's colour and
 * a widget kind's colour, both chosen by data rather than by a vocabulary
 * helper — and the test could not see them because they name no helper. So the
 * rendering is a component both can use, rather than a rule each page
 * remembers.
 *
 * Nothing is lost: the hue is the same and the eye still finds a column of
 * roles by colour. What changes is that the word beside the colour can be
 * read.
 */
export function EdgeTag({
  color,
  bordered = true,
  children,
  ...rest
}: {
  /** The colour this chip means — a hex from the API, or a token. */
  color: string | null | undefined;
  bordered?: boolean;
  children: React.ReactNode;
  "data-testid"?: string;
  style?: React.CSSProperties;
}) {
  const { style, ...attributes } = rest;
  return (
    <Tag
      {...attributes}
      bordered={bordered}
      className="nu-status-tag"
      style={{
        // The neutral border when there is no colour, so a thing nobody has
        // assigned a colour to looks unassigned rather than borrowing one.
        borderInlineStartColor: color || "var(--nu-border-strong)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
