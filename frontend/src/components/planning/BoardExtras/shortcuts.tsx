import { Modal } from "antd";
import { useEffect } from "react";

/**
 * The board's keys: `c` adds a card, `j`/`k` walk the cards, `/` searches,
 * `?` lists them. Ignored while typing, and while a modal is open.
 */
export function useBoardShortcuts({ onCreate, onHelp }: { onCreate: () => void; onHelp: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=true], .ant-modal, .ant-select")) return;
      if (document.querySelector(".ant-modal-wrap:not([style*='display: none'])")) return;
      const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-board-card]"));
      const at = cards.findIndex((card) => card === document.activeElement);
      if (event.key === "c") {
        event.preventDefault();
        onCreate();
      } else if (event.key === "j" || event.key === "k") {
        if (cards.length === 0) return;
        event.preventDefault();
        const next = event.key === "j" ? Math.min(cards.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1);
        cards[next]?.focus();
        cards[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else if (event.key === "/") {
        const search = document.querySelector<HTMLInputElement>("[data-board-search] input, input[data-board-search]");
        if (search) {
          event.preventDefault();
          search.focus();
        }
      } else if (event.key === "?") {
        event.preventDefault();
        onHelp();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCreate, onHelp]);
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ["c", "Add a task"],
    ["j / k", "Next / previous card"],
    ["Enter", "Open the focused card"],
    ["Space, ← → ↑ ↓, Space", "Pick a card up, move it, drop it"],
    ["/", "Search the board"],
    ["?", "This list"],
  ];
  return (
    <Modal open={open} title="Keyboard shortcuts" footer={null} onCancel={onClose}>
      <dl className="nx-pl-shortcuts" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", margin: 0 }}>
        {rows.map(([keys, what]) => (
          <div key={keys} style={{ display: "contents" }}>
            <dt>
              {keys.split(" ").map((part, index) => (part.length <= 5 && part !== "/" && part !== "," ? <kbd key={index}>{part}</kbd> : <span key={index}> {part} </span>))}
            </dt>
            <dd style={{ margin: 0 }}>{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
