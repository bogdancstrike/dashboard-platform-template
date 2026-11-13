/**
 * The message box (§47): markdown-lite, @mentions from the directory, emoji,
 * and files.
 *
 * * **A mention is picked, not guessed.** Typing `@` and a few letters opens
 *   the directory; choosing somebody writes `@Their Name` and remembers their
 *   id, which goes to the server with the text. The server still checks the
 *   name is in the body — a mention deleted before sending is not one.
 * * **Enter sends; Shift+Enter is a new line.** What every chat tool does.
 * * **Files upload before the message is sent**, straight to storage, and the
 *   message carries their ids. A message whose file is still on its way is a
 *   message the reader cannot open.
 */

import { useQuery } from "@tanstack/react-query";
import { App as AntApp, Button, Input, Popover, Progress, Tooltip } from "antd";
import { PaperClipOutlined, SendOutlined, SmileOutlined, CloseOutlined } from "@ant-design/icons";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { directoryApi, type Person } from "@/api/directory";
import { filesApi, putBytes, readableSize } from "@/api/files";
import type { Attachment } from "@/api/comments";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PersonAvatar } from "@/components/PersonAvatar";
import { STALE, queryKeys } from "@/lib/queryKeys";

const EMOJI = [
  "😀", "😄", "😂", "🙂", "😉", "😍", "🤔", "😮", "😢", "😅", "🙏", "👍",
  "👎", "👏", "🙌", "💪", "🎉", "🚀", "🔥", "✅", "❌", "⚠️", "💡", "👀",
  "❤️", "⭐", "📌", "📎", "☕", "🍕",
];

export interface ComposerSend {
  body: string;
  mention_ids: string[];
  attachment_ids: string[];
}

interface Pending {
  key: string;
  name: string;
  size: number;
  progress: number;
  file?: Attachment;
  error?: string;
}

/**
 * The directory matches anywhere in a name; a mention picker should offer the
 * people whose name *starts* with what was typed first — "@Mar" is Mara before
 * it is Adrian from Marketing.
 */
export function rankPeople(people: Person[], query: string): Person[] {
  const term = query.trim().toLowerCase();
  const score = (person: Person) => {
    const name = person.name.toLowerCase();
    if (!term) return 2;
    if (name.startsWith(term)) return 0;
    if (name.split(/\s+/).some((word) => term.split(/\s+/).every((part) => word.startsWith(part)))) return 1;
    return 2;
  };
  return people
    .filter((person) => !person.is_me)
    .map((person, index) => ({ person, index, rank: score(person) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.person);
}

/** The `@word` being typed just before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\w'’.-]{0,30}(?:\s[\w'’.-]{0,30})?)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? "";
  if (query.includes(" ") && !/^\S+\s\S*$/.test(query)) return null;
  return { start: before.length - query.length - 1, query };
}

export function Composer({
  onSend,
  onTyping,
  placeholder = "Write a message — **bold**, *italic*, `code`, @name",
  label = "Message",
  sendLabel = "Send",
  sendTestId = "send-message",
  busy = false,
  disabled = false,
  allowFiles = true,
  autoFocus = false,
  initial = "",
  onCancel,
  compact = false,
}: {
  onSend: (message: ComposerSend) => Promise<unknown> | void;
  onTyping?: () => void;
  placeholder?: string;
  label?: string;
  sendLabel?: string;
  sendTestId?: string;
  busy?: boolean;
  disabled?: boolean;
  allowFiles?: boolean;
  autoFocus?: boolean;
  initial?: string;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const { message } = AntApp.useApp();
  const [text, setText] = useState(initial);
  const [mentioned, setMentioned] = useState<Person[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const active = mentionAt(text, caret);
  const term = useDebouncedValue(active?.query ?? "", 150);
  const people = useQuery({
    queryKey: queryKeys.directoryPeople(term, "mention"),
    // A wide net, ranked here: the directory sorts by name, so "@Mar" would
    // otherwise fill its first page with Amaras before reaching Mara.
    queryFn: ({ signal }) => directoryApi.people(term, signal, 50),
    enabled: active !== null,
    staleTime: STALE.minute,
  });
  const suggestions = useMemo(
    () => (active ? rankPeople(people.data?.items ?? [], active.query).slice(0, 6) : []),
    [active, people.data],
  );

  const uploading = pending.some((item) => !item.file && !item.error);
  const ready = pending.filter((item) => item.file).map((item) => item.file!.id);
  const canSend = !disabled && !busy && !uploading && (text.trim().length > 0 || ready.length > 0);

  const choose = (person: Person) => {
    if (!active) return;
    const before = text.slice(0, active.start);
    const after = text.slice(caret);
    const inserted = `@${person.name} `;
    const next = `${before}${inserted}${after}`;
    setText(next);
    setMentioned((current) => (current.some((item) => item.id === person.id) ? current : [...current, person]));
    const position = before.length + inserted.length;
    setCaret(position);
    window.requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(position, position);
    });
  };

  const submit = async () => {
    if (!canSend) return;
    const body = text.trim();
    const ids = mentioned.filter((person) => body.includes(`@${person.name}`)).map((person) => person.id);
    try {
      await onSend({ body, mention_ids: ids, attachment_ids: ready });
      setText("");
      setMentioned([]);
      setPending([]);
      setCaret(0);
    } catch {
      /* the caller says why; the draft stays so nothing typed is lost */
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setPicked((current) => (current + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(suggestions[Math.min(picked, suggestions.length - 1)]!);
        return;
      }
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const upload = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setPending((current) => [...current, { key, name: file.name, size: file.size, progress: 0 }]);
      try {
        const ticket = await filesApi.beginUpload({
          name: file.name,
          size_bytes: file.size,
          mime_type: file.type || undefined,
        });
        await putBytes(ticket, file, (fraction) =>
          setPending((current) =>
            current.map((item) => (item.key === key ? { ...item, progress: Math.round(fraction * 100) } : item)),
          ),
        );
        const stored = await filesApi.confirmUpload(ticket.file.id);
        setPending((current) =>
          current.map((item) =>
            item.key === key
              ? {
                  ...item,
                  progress: 100,
                  file: { id: stored.id, name: stored.name, size_bytes: file.size, mime_type: file.type || null },
                }
              : item,
          ),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "The file was not uploaded.";
        message.error(reason);
        setPending((current) => current.map((item) => (item.key === key ? { ...item, error: reason } : item)));
      }
    }
  };

  const insert = (value: string) => {
    const at = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}${value}${text.slice(at)}`;
    setText(next);
    setCaret(at + value.length);
  };

  return (
    <div className={`nx-co-composer${compact ? " is-compact" : ""}`}>
      {pending.length > 0 && (
        <ul className="nx-co-pending" aria-label="Files to send">
          {pending.map((item) => (
            <li key={item.key} className={item.error ? "is-bad" : undefined}>
              <PaperClipOutlined />
              <span className="nx-co-pending-name">{item.name}</span>
              <span className="nx-co-muted">{readableSize(item.size)}</span>
              {!item.file && !item.error && <Progress percent={item.progress} size="small" showInfo={false} aria-label={`Uploading ${item.name}`} />}
              <Button
                type="text"
                aria-label={`Remove ${item.name}`}
                icon={<CloseOutlined />}
                onClick={() => setPending((current) => current.filter((other) => other.key !== item.key))}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="nx-co-composer-box">
        <Popover
          open={suggestions.length > 0}
          placement="topLeft"
          arrow={false}
          overlayClassName="nx-co-mentions-pop"
          content={
            <ul className="nx-co-mentions" role="listbox" aria-label="People to mention">
              {suggestions.map((person, index) => (
                <li
                  key={person.id}
                  role="option"
                  aria-selected={index === picked}
                  className={index === picked ? "is-on" : undefined}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(person);
                  }}
                >
                  <PersonAvatar size={22} src={person.avatar_url} initials={person.initials} />
                  <span>{person.name}</span>
                  {person.job_title && <span className="nx-co-muted">{person.job_title}</span>}
                </li>
              ))}
            </ul>
          }
        >
          <Input.TextArea
            ref={(node) => {
              area.current = node?.resizableTextArea?.textArea ?? null;
            }}
            value={text}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-label={label}
            placeholder={placeholder}
            autoSize={{ minRows: compact ? 1 : 2, maxRows: 8 }}
            onChange={(event) => {
              setText(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
              setPicked(0);
              if (event.target.value.trim()) onTyping?.();
            }}
            onSelect={(event) => setCaret((event.target as HTMLTextAreaElement).selectionStart ?? 0)}
            onKeyDown={onKeyDown}
          />
        </Popover>
        <div className="nx-co-composer-tools">
          <Popover
            trigger="click"
            placement="topRight"
            content={
              <div className="nx-co-emoji" role="group" aria-label="Insert an emoji">
                {EMOJI.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => insert(emoji)} aria-label={`Insert ${emoji}`}>
                    {emoji}
                  </button>
                ))}
              </div>
            }
          >
            <Button type="text" icon={<SmileOutlined />} aria-label="Emoji" disabled={disabled} />
          </Popover>
          {allowFiles && (
            <>
              <Tooltip title="Attach files">
                <Button
                  type="text"
                  icon={<PaperClipOutlined />}
                  aria-label="Attach files"
                  disabled={disabled}
                  onClick={() => fileInput.current?.click()}
                />
              </Tooltip>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                data-testid="composer-files"
                onChange={(event) => {
                  void upload(event.target.files);
                  event.target.value = "";
                }}
              />
            </>
          )}
          {onCancel && (
            <Button onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="primary"
            icon={sendLabel === "Send" ? <SendOutlined /> : undefined}
            disabled={!canSend}
            loading={busy}
            onClick={() => void submit()}
            data-testid={sendTestId}
          >
            {sendLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
