import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { NavigationType, useLocation, useNavigate, useNavigationType } from "react-router-dom";

/**
 * "Back" that does what back means.
 *
 * Three behaviours, one file:
 *
 * * **A back button returns to where you were**, not to a hard-coded parent.
 *   If the previous entry belongs to this app, back is `history.back()` — the
 *   list comes back with its filters, its tab, its open item. Only a page that
 *   was opened directly (a pasted link, a new tab) falls back to its parent.
 * * **Browser back closes the overlay first.** Opening a modal, a drawer, the
 *   command palette or the phone's navigation sheet adds a history entry, so
 *   the back gesture on a phone — and the browser's button — dismisses it
 *   instead of leaving the page underneath.
 * * **Overlays that replace one another** (a drawer that opens another
 *   drawer) keep their state in the address and push it, so back walks back
 *   through them; such overlays carry `URL_OVERLAY` and are left to the router.
 * * **Scroll comes back too.** Returning to a long list lands on the row you
 *   left, not at the top.
 */

/** React Router keeps its own position in `history.state.idx`. */
function historyIndex(): number {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === "number" ? state.idx : 0;
}

/**
 * `back(fallback)`: go to the previous entry when there is one inside the app,
 * otherwise run `fallback` (or go to it, when it is an address, or go home).
 */
export function useSmartBack() {
  const navigate = useNavigate();
  return useCallback(
    (fallback?: (() => void) | string) => {
      if (historyIndex() > 0) {
        navigate(-1);
      } else if (typeof fallback === "function") {
        fallback();
      } else {
        navigate(fallback ?? "/home");
      }
    },
    [navigate],
  );
}

const OVERLAY_SELECTOR = [
  ".ant-modal-wrap",
  ".ant-drawer-open",
  ".nx-sheet-scrim",
  ".ant-image-preview-wrap",
].join(", ");

/**
 * Overlays whose open state lives in the address (`?panel=rules`) already
 * have a history entry of their own, pushed by the page; they opt out with
 * `rootClassName={URL_OVERLAY}` so back is not counted twice.
 */
export const URL_OVERLAY = "nu-url-overlay";

function openOverlays(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)).filter(
    (el) =>
      el.style.display !== "none" &&
      el.getClientRects().length > 0 &&
      !el.closest(`.${URL_OVERLAY}`) &&
      !el.classList.contains(URL_OVERLAY),
  );
}

/** Close the topmost overlay the way its own close control would. */
function closeTopOverlay(): void {
  const overlays = openOverlays();
  const top = overlays[overlays.length - 1];
  if (!top) return;
  const close = top.querySelector<HTMLElement>(
    ".ant-modal-close, .ant-drawer-close, .ant-image-preview-close, [aria-label='Close navigation']",
  );
  if (close) {
    close.click();
    return;
  }
  if (top.classList.contains("nx-sheet-scrim")) {
    top.click();
    return;
  }
  const target = top.querySelector<HTMLElement>("[tabindex]") ?? top;
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
  );
}

/**
 * Mirrors open overlays into history entries.
 *
 * The pushed entries keep React Router's own state (`key`, `idx`, `usr`), so
 * the router sees the same location and does not re-render a page; only this
 * component knows the entry stands for "a dialog is open".
 */
export function OverlayHistory() {
  const depth = useRef(0);
  const skipPops = useRef(0);
  const { pathname } = useLocation();

  // A new page starts with nothing open.
  useEffect(() => {
    depth.current = openOverlays().length;
  }, [pathname]);

  useEffect(() => {
    const sync = () => {
      const open = openOverlays().length;
      while (open > depth.current) {
        depth.current += 1;
        const state = (window.history.state as Record<string, unknown> | null) ?? {};
        window.history.pushState({ ...state, nuOverlay: depth.current }, "");
      }
      if (open < depth.current) {
        // Closed by its own button: drop the entries it added, quietly.
        const extra = depth.current - open;
        depth.current = open;
        const marker = (window.history.state as { nuOverlay?: number } | null)?.nuOverlay ?? 0;
        if (marker > 0) {
          skipPops.current += 1;
          window.history.go(-Math.min(extra, marker));
        }
      }
    };

    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    const onPop = (event: PopStateEvent) => {
      if (skipPops.current > 0) {
        skipPops.current -= 1;
        return;
      }
      const marker = (event.state as { nuOverlay?: number } | null)?.nuOverlay ?? 0;
      if (depth.current > marker) {
        // Back while a dialog is open: close it instead of leaving.
        depth.current = marker;
        closeTopOverlay();
      } else if (marker > 0 && openOverlays().length === 0) {
        // An entry left behind by a dialog that is gone: step over it.
        skipPops.current += 1;
        window.history.back();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return null;
}

/**
 * Remembers how far each history entry was scrolled, and puts it back when the
 * reader returns to that entry with back or forward.
 */
export function useScrollMemory(scroller: RefObject<HTMLElement>) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const current = useRef(location.key);

  // Record continuously, so the value is right at the moment of leaving.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => positions.current.set(current.current, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scroller]);

  useLayoutEffect(() => {
    const previous = current.current;
    current.current = location.key;
    const el = scroller.current;
    if (!el) return;
    if (navigationType === NavigationType.Replace) {
      // The same screen rewriting its own address (a filter, a default view):
      // the reader has not moved, so neither does the page.
      positions.current.set(location.key, positions.current.get(previous) ?? el.scrollTop);
      return;
    }
    if (navigationType !== NavigationType.Pop) {
      el.scrollTop = 0;
      return;
    }
    const target = positions.current.get(location.key) ?? 0;
    // The page may still be loading its rows: keep trying for a moment until
    // the content is tall enough to scroll that far.
    let tries = 0;
    let timer = 0;
    const restore = () => {
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) > 2 && tries++ < 30) timer = window.setTimeout(restore, 50);
    };
    restore();
    return () => window.clearTimeout(timer);
  }, [location.key, navigationType, scroller]);
}
