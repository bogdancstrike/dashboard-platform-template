import { Fragment, type ReactNode } from "react";

/**
 * The small Markdown a model writes — paragraphs, bullet and numbered lists,
 * headings, **bold**, _italic_ and `code` — rendered as React elements (§43, §44).
 *
 * Never as HTML: a model's output is untrusted text, and `innerHTML` would let
 * a document that says "<img onerror=…>" run script in the app. Anything not
 * understood stays literal text.
 *
 * `cite` turns `[n]` markers into whatever the caller draws for a citation.
 */
export function MiniMarkdown({
  text,
  cite,
  className,
}: {
  text: string;
  cite?: (n: number) => ReactNode;
  className?: string;
}) {
  const blocks = toBlocks(text);
  return (
    <div className={["nx-md", className].filter(Boolean).join(" ")}>
      {blocks.map((block, index) => {
        if (block.kind === "ul" || block.kind === "ol") {
          const List = block.kind;
          return (
            <List key={index}>
              {block.lines.map((line, i) => (
                <li key={i}>{inline(line, cite)}</li>
              ))}
            </List>
          );
        }
        if (block.kind === "h") {
          return (
            <p key={index} className="nx-md-h">
              {inline(block.lines[0] ?? "", cite)}
            </p>
          );
        }
        return <p key={index}>{inline(block.lines.join(" "), cite)}</p>;
      })}
    </div>
  );
}

interface Block {
  kind: "p" | "ul" | "ol" | "h";
  lines: string[];
}

export function toBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of (text || "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
    } else if (heading) {
      blocks.push({ kind: "h", lines: [heading[1] ?? ""] });
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const content = (bullet ?? numbered)?.[1] ?? "";
      if (last?.kind === kind) last.lines.push(content);
      else blocks.push({ kind, lines: [content] });
    } else if (last?.kind === "p") {
      last.lines.push(line.trim());
    } else {
      blocks.push({ kind: "p", lines: [line.trim()] });
    }
  }
  return blocks.filter((block) => block.lines.length);
}

const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[\d{1,2}\])/g;

export function inline(text: string, cite?: (n: number) => ReactNode): ReactNode[] {
  return text.split(TOKEN).map((part, index) => {
    if (!part) return null;
    if (/^\[\d{1,2}\]$/.test(part)) {
      const n = Number(part.slice(1, -1));
      return <Fragment key={index}>{cite ? cite(n) : part}</Fragment>;
    }
    if (/^(\*\*|__).+(\*\*|__)$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`.+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^[*_].+[*_]$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
