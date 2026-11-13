import { useEffect } from "react";

/**
 * Esc closes an open popup wherever focus happens to be.
 *
 * AntD's dropdowns close on Esc only while focus is on their trigger or inside
 * their menu; a live toast, a tooltip or a click on the panel's own padding
 * moves it, and the bell and the profile menu then stayed open until clicked
 * away (audit A). One window listener while open, and only then.
 */
export function useEscapeToClose(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
}
