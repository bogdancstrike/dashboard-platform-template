/**
 * "Ask about this page" — the adaptive half of the page tour (§46).
 *
 * Sends the server what the page offers: its tour stops, the commands it has
 * registered with the palette, and the controls visible right now (by
 * `data-testid`, the same handle the tour uses). The answer may point at one
 * control — it is scrolled to and outlined — and may propose one command,
 * which runs only after the reader confirms. The confirmation is recorded in
 * the audit log as an action the assistant proposed.
 */

import { useState } from "react";
import { Alert, App, Button, Input } from "antd";
import { useLocation } from "react-router-dom";

import { assistantApi, type PageHelpAnswer } from "@/api/assistant";
import { ApiError } from "@/api/client";
import type { TourStop } from "@/app/tours";
import { useCommands } from "@/commands/CommandContext";

import { AstIcon } from "./AstIcon";
import { Markdown } from "./Markdown";
import "@/styles/assistant.css";

const MAX_CONTROLS = 80;

/** The labelled controls on screen right now, by their test id. */
export function visibleControls(root: ParentNode = document): { id: string; label: string }[] {
  const seen = new Set<string>();
  const out: { id: string; label: string }[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-testid]"))) {
    const id = el.getAttribute("data-testid") ?? "";
    if (!id || seen.has(id) || el.closest(".nx-ai-pagehelp")) continue;
    if (el.closest("[hidden], [aria-hidden='true']")) continue;
    const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    seen.add(id);
    out.push({ id, label });
    if (out.length >= MAX_CONTROLS) break;
  }
  return out;
}

/** Bring a control into view and outline it for a moment. */
export function highlight(id: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(id)}"]`);
  if (!el) return false;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom has no scrollIntoView
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el.classList.add("nx-ai-highlight");
  window.setTimeout(() => el.classList.remove("nx-ai-highlight"), 3200);
  return true;
}

export function PageAsk({ stops, onDone }: { stops: TourStop[] | undefined; onDone?: () => void }) {
  const location = useLocation();
  const { commands } = useCommands();
  const { modal } = App.useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PageHelpAnswer | null>(null);

  const ask = async () => {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await assistantApi.pageHelp({
        path: location.pathname,
        question,
        stops: (stops ?? []).map((s) => ({ title: s.title, description: s.description, target: s.target })),
        controls: visibleControls(),
        commands: commands.map((c) => ({ id: c.id, label: c.label, keywords: c.keywords })),
      });
      setAnswer(result);
      if (result.highlight) highlight(result.highlight);
    } catch (failure) {
      setError(failure instanceof ApiError || failure instanceof Error ? failure.message : "Could not answer that.");
    } finally {
      setBusy(false);
    }
  };

  const propose = (action: { id: string; label: string }) => {
    const command = commands.find((c) => c.id === action.id);
    if (!command) return;
    modal.confirm({
      title: "Do this for you?",
      content: action.label,
      okText: "Yes, do it",
      cancelText: "Not now",
      onOk: async () => {
        command.run();
        onDone?.();
        try {
          await assistantApi.confirmAction({ command_id: action.id, label: action.label, path: location.pathname });
        } catch {
          // The action ran; failing to record it must not undo that.
        }
      },
    });
  };

  return (
    <div className="nx-ai-pagehelp" data-testid="page-ask">
      <label className="nx-ai-describe-label" htmlFor="nx-ai-pageask">
        <AstIcon name="spark" size={14} /> Ask about this page
      </label>
      <div className="nx-ai-describe-row">
        <Input
          id="nx-ai-pageask"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPressEnter={() => void ask()}
          placeholder="How do I…"
          maxLength={500}
          data-testid="page-ask-input"
        />
        <Button type="primary" loading={busy} disabled={!text.trim()} onClick={() => void ask()} data-testid="page-ask-go" aria-label="Ask">
          <AstIcon name="send" size={14} />
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      {answer && (
        <div className="nx-ai-pagehelp-answer" data-testid="page-ask-answer">
          <Markdown text={answer.answer} onNavigate={onDone} />
          <div className="nx-ai-pagehelp-actions">
            {answer.highlight && (
              <Button onClick={() => highlight(answer.highlight!)}>
                Show me
              </Button>
            )}
            {answer.action && (
              <Button type="primary" onClick={() => propose(answer.action!)} data-testid="page-ask-action">
                {answer.action.label}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
