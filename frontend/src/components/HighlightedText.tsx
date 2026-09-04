/**
 * Marks where a search term occurs in a value (§6).
 *
 * Only ever applied to the fields the server actually searched, so a highlight
 * is evidence of a match rather than a coincidence: a term appearing in a
 * column the query never looked at would tell the reader the row matched for a
 * reason that is not true.
 *
 * `<mark>` rather than a styled span, because that is what it means, and it is
 * what a screen reader and a browser's find-in-page both understand.
 */

import { Fragment, useMemo } from "react";

export interface HighlightedTextProps {
  text: string;
  /** The term that was executed. Empty means render the text unchanged. */
  term: string;
}

export function HighlightedText({ text, term }: HighlightedTextProps) {
  const parts = useMemo(() => split(text, term), [text, term]);
  // One part can still *be* the match — a reference searched for in full is
  // the whole value — so the test is whether anything matched, not how many
  // pieces the value came apart into.
  if (!parts.some((part) => part.match)) return <>{text}</>;

  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={index} className="nu-mark">{part.text}</mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}

interface Part {
  text: string;
  match: boolean;
}

/**
 * Cut `text` around every case-insensitive occurrence of `term`.
 *
 * Scanned with `indexOf` rather than a built regular expression: the term comes
 * from a text box, and `(` or `*` in it would otherwise be a syntax error or,
 * worse, a pattern that matches something else entirely.
 */
export function split(text: string, term: string): Part[] {
  const needle = term.trim().toLowerCase();
  if (!needle || !text) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const parts: Part[] = [];
  let cursor = 0;

  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, cursor)) {
    if (at > cursor) parts.push({ text: text.slice(cursor, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  if (parts.length === 0) return [{ text, match: false }];
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
