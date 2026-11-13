/** How an arriving notification reaches the screen: the reader's pop-up settings, and the cap on toasts. */

import type { App } from "antd";

import type { Notification } from "@/api/notifications";
import type { UserPreferences } from "@/api/me";
import { chime } from "@/lib/chime";

type Toaster = ReturnType<typeof App.useApp>["notification"];

/**
 * How many notifications may be on screen at once, and for how long.
 *
 * Three, because a burst is a real thing this platform produces — one
 * automation can fire across forty records — and forty stacked cards cover
 * half the screen for a minute with something nobody reads. Past the third,
 * the rest are counted in one card that points at the notification centre,
 * which is where all of them are anyway (§17).
 */
const MAX_TOASTS = 3;
/** The overflow card reopens under one key, so it replaces itself. */
const OVERFLOW_KEY = "nu-live-overflow";

/** Which notifications are on screen now, and how many were counted instead of drawn. */
export interface PopupState {
  shown: Set<string>;
  overflow: { current: number };
}

export function popUp(
  data: Notification,
  wanted: UserPreferences["notifications"],
  toast: Toaster,
  state: PopupState,
): void {
  // The badge and the centre always update; the *pop-up* is the reader's
  // to switch off (§40). Read from the live preference rather than
  // captured at mount, so turning pop-ups off on `/preferences` takes
  // effect on the next notification rather than on the next reload.
  if (wanted.popups === "none") return;
  if (wanted.popups === "important" && data.severity === "INFO") return;
  if (wanted.popup_categories.length > 0 && !wanted.popup_categories.includes(data.category)) {
    return;
  }
  if (wanted.sound) chime();

  // A toast is the difference between "the badge changed while you were
  // looking elsewhere" and a notification you actually saw arrive. Kept
  // brief, bottom-right, and never for something the reader just did.
  //
  // **And never more than three at once.** A burst — an automation firing
  // across forty records, a batch job finishing — used to raise forty
  // stacked cards that covered the right-hand half of the screen for the
  // best part of a minute, and there is no reading forty toasts. Past the
  // third, the rest are *counted* rather than drawn, in one card that says
  // how many and points at the page where they all are. The notification
  // centre is the place that holds everything; a toast is only ever a
  // nudge (§17).
  const showing = state.shown;
  showing.add(data.id);
  if (showing.size <= MAX_TOASTS) {
    toast.open({
      message: data.title,
      // `compact` is the title alone: a burst of five is readable as five
      // lines and unreadable as five paragraphs.
      description: wanted.popup_style === "compact" ? undefined : (data.body ?? undefined),
      placement: wanted.popup_placement,
      duration: wanted.popup_seconds,
      key: data.id,
      onClose: () => showing.delete(data.id),
    });
    return;
  }

  // One card for the overflow, reopened under the same key so it replaces
  // itself rather than becoming the fortieth toast. Its own timer is
  // restarted by each arrival, because a burst that is still arriving is
  // one event, not several.
  state.overflow.current += 1;
  toast.open({
    key: OVERFLOW_KEY,
    message: `${state.overflow.current} more notification${state.overflow.current === 1 ? "" : "s"}`,
    description: "Open the notification centre to read them.",
    placement: wanted.popup_placement,
    duration: wanted.popup_seconds,
    onClose: () => {
      state.overflow.current = 0;
      showing.clear();
    },
  });
}
