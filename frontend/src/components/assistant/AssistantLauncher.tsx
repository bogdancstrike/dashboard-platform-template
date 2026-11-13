/**
 * The assistant, one press away on every page (§41): a floating button and
 * ⌘J / Ctrl-J open a side panel holding the same chat as `/assistant`.
 *
 * The panel keeps the conversation it last showed for this tab (session
 * storage, a convenience — the conversation itself is on the server), opens
 * in Data mode because a question asked from inside the product is usually
 * about what is on screen, and closes itself when a cited record is followed.
 * Not drawn on `/assistant` itself, where it would be a second copy of the page.
 */

import { useEffect, useState } from "react";
import { Button, Drawer, Tooltip } from "antd";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "@/auth/AuthProvider";
import { usePageCommands } from "@/commands/CommandContext";

import { AssistantChat } from "./AssistantChat";
import { AstIcon } from "./AstIcon";

const KEY = "nucleus.assistant.panel";

function remembered(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the panel simply starts a new conversation.
  }
}

export function AssistantLauncher() {
  const { can } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(remembered);
  const allowed = can("ai.use");
  // Pages that are themselves a conversation keep the corner for their own
  // composer: on /ai/documents the round button sat on the send button
  // (audit A). Ctrl+J and the palette still open the panel there.
  const onPage = ["/assistant", "/ai/documents", "/chat"].some((path) => location.pathname.startsWith(path));

  useEffect(() => {
    if (!allowed) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "j" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed]);

  usePageCommands("assistant-launcher", allowed ? [
    { id: "assistant.panel", label: "Ask the assistant", keywords: "ai chat question help data", shortcut: "⌘J", run: () => setOpen(true) },
  ] : []);

  if (!allowed) return null;

  const choose = (id: string | null) => {
    setConversationId(id);
    remember(id);
  };

  return (
    <>
      {!onPage && !open && (
        <Tooltip title="Ask the assistant (⌘J)" placement="left">
          <button type="button" className="nx-ai-fab" aria-label="Ask the assistant" data-testid="assistant-launcher" onClick={() => setOpen(true)}>
            <AstIcon name="spark" size={22} />
          </button>
        </Tooltip>
      )}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width="min(460px, 100vw)"
        rootClassName="nx-ai-panel"
        destroyOnHidden={false}
        title={
          <div className="nx-ai-panel-head">
            <span className="nx-ai-panel-title"><AstIcon name="spark" size={16} /> Assistant</span>
            <span className="nx-ai-panel-tools">
              <Tooltip title="New conversation">
                <Button shape="circle" aria-label="New conversation" icon={<AstIcon name="plus" />} onClick={() => choose(null)} />
              </Tooltip>
              <Tooltip title="Open the full page">
                <Link to={conversationId ? `/assistant/${conversationId}` : "/assistant"} onClick={() => setOpen(false)} aria-label="Open the full page" className="nx-ai-iconbtn">
                  <AstIcon name="expand" size={14} />
                </Link>
              </Tooltip>
            </span>
          </div>
        }
      >
        {open && (
          <AssistantChat
            key={conversationId ?? "new"}
            compact
            initialMode="data"
            conversationId={conversationId}
            onConversationChange={choose}
            onNavigate={() => setOpen(false)}
          />
        )}
      </Drawer>
    </>
  );
}
