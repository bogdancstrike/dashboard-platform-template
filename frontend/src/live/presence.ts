/**
 * Presence (§47): away when the tab is hidden or nobody has touched it for a
 * while, online again at the next sign of life. Sent on the socket — the one
 * frame besides the heartbeat the server accepts — and only on a change, so
 * moving the mouse is not a message per pixel.
 */

import type { MutableRefObject } from "react";

/** How long without a key, a click or a scroll before somebody is "away". */
const IDLE_MS = 5 * 60_000;

const ACTIVITY = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

export function createPresence(socketRef: MutableRefObject<WebSocket | null>) {
  let reported: "online" | "away" = "online";
  let idleTimer: number | undefined;
  const report = (status: "online" | "away") => {
    if (status === reported) return;
    reported = status;
    try {
      if (socketRef.current?.readyState === 1) {
        socketRef.current.send(JSON.stringify({ type: "presence", status }));
      }
    } catch {
      /* closing; the server will mark this socket gone on its own */
    }
  };
  const active = () => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => report("away"), IDLE_MS);
    if (!document.hidden) report("online");
  };
  const visibility = () => (document.hidden ? report("away") : active());
  return {
    start() {
      document.addEventListener("visibilitychange", visibility);
      for (const name of ACTIVITY) window.addEventListener(name, active, { passive: true });
      active();
    },
    /**
     * The server marks a new socket online; a tab opened (or reconnected) in
     * the background says at once that nobody is looking at it.
     */
    opened() {
      reported = "online";
      if (document.hidden) report("away");
    },
    stop() {
      document.removeEventListener("visibilitychange", visibility);
      for (const name of ACTIVITY) window.removeEventListener(name, active);
      window.clearTimeout(idleTimer);
    },
  };
}
