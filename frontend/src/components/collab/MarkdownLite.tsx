/**
 * Markdown-lite (§47): what people actually type in a chat box, and no more.
 *
 * `**bold**`, `*italic*` or `_italic_`, `` `code` ``, `~~struck~~`,
 * `[label](https://…)`, bare links, `@Mentions`, fenced ``` code blocks,
 * `- ` bullets, `1. ` numbers and `> ` quotes. Built as React nodes rather than
 * HTML, so nothing anybody types can become markup — there is no
 * `dangerouslySetInnerHTML` anywhere on this path.
 */

import type { ReactNode } from "react";

/** One inline token, in the order they are tried. */
const INLINE =
  /(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(`[^`\n]+`)|(\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\))|((?:https?:\/\/)[^\s<]+[^\s<.,;:!?)\]'"])|(\*[^*\n]+\*)|(\b_[^_\n]+_\b)|(@[A-Z][\w'’.-]*(?:\s[A-Z][\w'’.-]*)?)/g;

function safeHref(raw: string): string | null {
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Inline marks within one line of text. */
export function renderInline(text: string, keyPrefix = "i", mentionNames: string[] = []): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  const known = new Set(mentionNames.map((name) => name.toLowerCase()));
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}-${index++}`;
    if (match[1]) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key, mentionNames)}</strong>);
    } else if (match[2]) {
      out.push(<s key={key}>{token.slice(2, -2)}</s>);
    } else if (match[3]) {
      out.push(<code key={key} className="nx-co-code">{token.slice(1, -1)}</code>);
    } else if (match[4]) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      out.push(
        href ? (
          <a key={key} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else if (match[5]) {
      const href = safeHref(token);
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {token}
          </a>
        ) : (
          token
        ),
      );
    } else if (match[6] || match[7]) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      // A mention: highlighted when it names somebody the server resolved, or
      // when nothing was said about who was resolved (a preview).
      const name = token.slice(1);
      const resolved = known.size === 0 || known.has(name.toLowerCase());
      out.push(
        <span key={key} className={resolved ? "nx-co-mention" : undefined}>
          {token}
        </span>,
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Chunk =
  | { kind: "p"; lines: string[] }
  | { kind: "code"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "quote"; lines: string[] };

export function chunks(text: string): Chunk[] {
  const out: Chunk[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      out.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    const previous = out[out.length - 1];
    if (bullet) {
      if (previous?.kind === "ul") previous.items.push(bullet[1] ?? "");
      else out.push({ kind: "ul", items: [bullet[1] ?? ""] });
    } else if (number) {
      if (previous?.kind === "ol") previous.items.push(number[1] ?? "");
      else out.push({ kind: "ol", items: [number[1] ?? ""] });
    } else if (quote) {
      if (previous?.kind === "quote") previous.lines.push(quote[1] ?? "");
      else out.push({ kind: "quote", lines: [quote[1] ?? ""] });
    } else if (line.trim() === "") {
      out.push({ kind: "p", lines: [] });
    } else if (previous?.kind === "p" && previous.lines.length > 0) {
      previous.lines.push(line);
    } else {
      out.push({ kind: "p", lines: [line] });
    }
    i += 1;
  }
  return out.filter((chunk) => chunk.kind !== "p" || chunk.lines.length > 0);
}

function lines(items: string[], key: string, mentions: string[]): ReactNode[] {
  return items.flatMap((line, index) => [
    ...(index > 0 ? [<br key={`${key}-br-${index}`} />] : []),
    ...renderInline(line, `${key}-${index}`, mentions),
  ]);
}

export function MarkdownLite({
  text,
  mentions = [],
  className,
}: {
  text: string;
  /** Names the server resolved, so only real people are highlighted. */
  mentions?: string[];
  className?: string;
}) {
  return (
    <div className={className ? `nx-co-md ${className}` : "nx-co-md"}>
      {chunks(text).map((chunk, index) => {
        const key = `c${index}`;
        switch (chunk.kind) {
          case "code":
            return (
              <pre key={key} className="nx-co-pre">
                <code>{chunk.text}</code>
              </pre>
            );
          case "ul":
            return (
              <ul key={key}>
                {chunk.items.map((item, at) => (
                  <li key={at}>{renderInline(item, `${key}-${at}`, mentions)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key}>
                {chunk.items.map((item, at) => (
                  <li key={at}>{renderInline(item, `${key}-${at}`, mentions)}</li>
                ))}
              </ol>
            );
          case "quote":
            return <blockquote key={key}>{lines(chunk.lines, key, mentions)}</blockquote>;
          default:
            return <p key={key}>{lines(chunk.lines, key, mentions)}</p>;
        }
      })}
    </div>
  );
}
