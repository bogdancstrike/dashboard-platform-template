/**
 * The Markdown the assistant writes, as React elements.
 *
 * Deliberately small and deliberately *not* HTML: the text comes from a model,
 * so nothing it writes is ever handed to `innerHTML`. What it can say is what
 * an answer needs — paragraphs, headings, lists, tables, code, emphasis and
 * links. A link to a path inside the app (`/tickets/…`) is a router link, so
 * a cited record opens in place rather than reloading the product.
 */

import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function inline(text: string, onNavigate?: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index;
    if (index > last) out.push(text.slice(last, index));
    const token = match[0];
    if (match[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key++}>{inline(token.slice(2, -2), onNavigate)}</strong>);
    else if (match[3]) {
      const [, label = "", href = ""] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      if (href.startsWith("/")) {
        out.push(
          <Link key={key++} to={href} onClick={onNavigate} className="nx-ai-link">
            {label}
          </Link>,
        );
      } else if (/^https?:\/\//.test(href)) {
        out.push(
          <a key={key++} href={href} target="_blank" rel="noreferrer noopener" className="nx-ai-link">
            {label}
          </a>,
        );
      } else {
        out.push(label);
      }
    } else out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

export function Markdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={key++}>{inline(para.join(" "), onNavigate)}</p>);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) code.push(lines[i++] ?? "");
      i += 1;
      blocks.push(
        <pre key={key++} className="nx-ai-code">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = Math.min(4, (heading[1] ?? "#").length + 2);
      const Tag = `h${level}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={key++}>{inline(heading[2] ?? "", onNavigate)}</Tag>);
      i += 1;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? "")) body.push(cells(lines[i++] ?? ""));
      blocks.push(
        <div key={key++} className="nx-ai-tablewrap">
          <table className="nx-ai-table">
            <thead>
              <tr>{head.map((cell, c) => <th key={c}>{inline(cell, onNavigate)}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell, onNavigate)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*([-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      const same = (next: string) => bullet.test(next) && /^\s*\d/.test(next) === ordered;
      while (i < lines.length && same(lines[i] ?? "")) items.push((lines[i++] ?? "").replace(bullet, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++}>
          {items.map((item, n) => (
            <li key={n}>{inline(item, onNavigate)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line.trim());
    i += 1;
  }
  flush();
  return <Fragment>{blocks}</Fragment>;
}
