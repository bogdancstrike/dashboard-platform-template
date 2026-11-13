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

import { Button, Input, Popover, Tooltip } from "antd";
import { PaperClipOutlined, SendOutlined, SmileOutlined } from "@ant-design/icons";
import { useRef, useState, type KeyboardEvent } from "react";

import { type Person } from "@/api/directory";

import { ComposerSend, EMOJI, mentionAt } from "./mentions";

import { MentionList, PendingFiles } from "./ComposerParts";
import { useAttachments } from "./useAttachments";
import { useMentionSuggestions } from "./useMentionSuggestions";

export { mentionAt, rankPeople, type ComposerSend } from "./mentions";

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
  const [text, setText] = useState(initial);
  const [mentioned, setMentioned] = useState<Person[]>([]);
  const { pending, setPending, upload, uploading, ready } = useAttachments();
  const [caret, setCaret] = useState(0);
  const [picked, setPicked] = useState(0);
  const area = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const active = mentionAt(text, caret);
  const suggestions = useMentionSuggestions(active);

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

  const insert = (value: string) => {
    const at = area.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}${value}${text.slice(at)}`;
    setText(next);
    setCaret(at + value.length);
  };

  return (
    <div className={`nx-co-composer${compact ? " is-compact" : ""}`}>
      <PendingFiles pending={pending} onRemove={(key) => setPending((current) => current.filter((other) => other.key !== key))} />
      <div className="nx-co-composer-box">
        <Popover
          open={suggestions.length > 0}
          placement="topLeft"
          arrow={false}
          overlayClassName="nx-co-mentions-pop"
          content={<MentionList people={suggestions} picked={picked} onChoose={choose} />}
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
