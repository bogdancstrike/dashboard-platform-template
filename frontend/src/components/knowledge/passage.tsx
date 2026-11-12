import type { ReactNode } from "react";

/**
 * A text file's body with the cited passage marked (§44).
 *
 * The passage is the converter's text, which can differ from the file in
 * whitespace (a Markdown heading lost its `#`, a paragraph's line breaks were
 * joined), so it is found by its words rather than byte for byte: the longest
 * leading run of the passage that appears, whitespace-insensitively.
 */
export function findPassage(text: string, quote: string): [number, number] | null {
  const words = quote.split(/\s+/).filter(Boolean);
  for (let take = Math.min(words.length, 40); take >= 3; take = Math.floor(take / 2)) {
    const pattern = words
      .slice(0, take)
      .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");
    const match = new RegExp(pattern).exec(text);
    if (match) {
      // Extend to the end of the passage when the whole of it is there.
      const whole = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")).exec(
        text.slice(match.index),
      );
      const length = whole && whole.index === 0 ? whole[0].length : match[0].length;
      return [match.index, match.index + length];
    }
  }
  return null;
}

export function MarkedText({ text, quote }: { text: string; quote: string }): ReactNode {
  const found = findPassage(text, quote);
  if (!found) return text;
  const [start, end] = found;
  return (
    <>
      {text.slice(0, start)}
      <mark
        className="nx-kn-text-mark"
        data-testid="citation-text-mark"
        ref={(node) => {
          if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "center" });
        }}
      >
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}
