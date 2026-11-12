/**
 * A very small TSX highlighter (§60).
 *
 * The documentation shows its own demo files as code, and a code sample in one
 * colour is hard to scan. A real highlighter (Prism, Shiki) is a dependency
 * measured in hundreds of kilobytes for what this page needs: comments,
 * strings, keywords, JSX tag names, attributes and numbers. One regular
 * expression with named alternatives does that, and the colours come from the
 * theme's own tokens, so the sample follows light and dark like everything else.
 */
import type { ReactNode } from "react";

const KEYWORDS = new Set(
  "import export from default function return const let var if else for of in while new typeof as type interface extends true false null undefined async await".split(
    " ",
  ),
);

/** The token kinds, in the order the expression tries them. */
const PATTERN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(<\/?)([A-Za-z][\w.]*)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(?==)|\b([A-Za-z_$][\w$]*)\b/g;

export type TokenKind = "comment" | "string" | "punct" | "tag" | "component" | "number" | "attr" | "keyword" | "plain";

/** The source as `[kind, text]` pairs — exported so the rule can be tested without a DOM. */
export function tokenize(source: string): [TokenKind, string][] {
  const out: [TokenKind, string][] = [];
  let last = 0;
  for (const match of source.matchAll(PATTERN)) {
    const index = match.index;
    if (index > last) out.push(["plain", source.slice(last, index)]);
    const [whole, comment, string, open, tag, number, attr, word] = match;
    if (comment) out.push(["comment", comment]);
    else if (string) out.push(["string", string]);
    else if (open && tag) {
      out.push(["punct", open]);
      out.push([/^[A-Z]/.test(tag) ? "component" : "tag", tag]);
    } else if (number) out.push(["number", number]);
    else if (attr) out.push(["attr", attr]);
    else if (word) out.push([KEYWORDS.has(word) ? "keyword" : "plain", word]);
    else out.push(["plain", whole]);
    last = index + whole.length;
  }
  if (last < source.length) out.push(["plain", source.slice(last)]);
  return out;
}

export function highlight(source: string): ReactNode[] {
  return tokenize(source).map(([kind, text], index) =>
    kind === "plain" ? text : (
      <span key={index} className={`nx-tok nx-tok--${kind}`}>
        {text}
      </span>
    ),
  );
}
