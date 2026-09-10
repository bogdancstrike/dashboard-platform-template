/**
 * Asking before doing something that cannot be taken back (§73).
 *
 * Most deletes in the product already confirmed, and each had written its own
 * sentence — so "It disappears from every list", "The layout goes" and "This
 * removes it from the database" all meant the same thing in three registers,
 * and a few destructive controls had no confirmation at all because nobody
 * noticed they were missing.
 *
 * Two rules, and they are why this is a module rather than a snippet.
 *
 * **A confirmation says what will happen, not "are you sure".** "Are you sure?"
 * asks the reader to supply the consequence from memory, which is precisely
 * what they were not thinking about a moment ago. Every caller passes the
 * consequence, and the type requires it.
 *
 * **The button says the verb.** `okText` is "Delete", never "OK" — the last
 * word somebody reads before committing should be the thing being committed,
 * and a dialog whose buttons are OK and Cancel makes them re-read the title to
 * find out which is which.
 *
 * Copying gets the same treatment for a different reason. A copy is not
 * destructive, but it *is* surprising: a duplicate is private, shares nothing,
 * and is a second thing that will drift from the first. Saying so once, at the
 * moment it is made, is cheaper than the conversation about which of the two
 * dashboards is the real one.
 */

import type { HookAPI } from "antd/es/modal/useModal";

/**
 * What a copy *is*, said once.
 *
 * Every duplicate in the product means the same three things and each dialog
 * was about to say them in its own words. The caller adds what is specific to
 * the thing being copied; this is the part that never varies.
 */
export const COPY_MEANS =
  "It becomes a private copy you own and can change. It shares with nobody, and it will not follow the original when that changes.";

/** What every confirmation needs to be worth reading. */
export interface Confirmation {
  /** The thing, named as the reader knows it — "Revenue by channel". */
  what: string;
  /** What happens, in a sentence. Required: this is the whole point. */
  consequence: string;
  /** Runs on confirm. A promise is awaited, so the dialog holds until it lands. */
  onOk: () => void | Promise<unknown>;
}

/**
 * Delete something, once the reader has read what that means.
 *
 * The title names the thing rather than its kind, because "Delete this report?"
 * and "Delete Revenue by channel?" are different questions when four reports
 * are on screen.
 */
export function confirmDelete(modal: HookAPI, { what, consequence, onOk }: Confirmation): void {
  modal.confirm({
    title: `Delete ${what}?`,
    content: consequence,
    okText: "Delete",
    okButtonProps: { danger: true, "data-testid": "confirm-delete" },
    cancelText: "Keep it",
    onOk,
  });
}

/**
 * Remove something from where it is, without destroying it.
 *
 * Distinct from deleting on purpose: taking a widget off a dashboard, a card
 * off a board, a person off a share. The data survives, and a dialog that
 * says "delete" about it teaches the reader to fear a reversible gesture —
 * after which they stop reading the ones that matter.
 */
export function confirmRemove(modal: HookAPI, { what, consequence, onOk }: Confirmation): void {
  modal.confirm({
    title: `Remove ${what}?`,
    content: consequence,
    okText: "Remove",
    okButtonProps: { danger: true, "data-testid": "confirm-remove" },
    cancelText: "Leave it",
    onOk,
  });
}

/**
 * Take a copy, having said what a copy is.
 *
 * Not destructive and still worth a sentence: the copy is private, shares
 * nothing, and is a second thing that will drift from the first. Somebody who
 * expected "edit this" and got "a private duplicate" finds out an hour later,
 * having edited the wrong one.
 */
export function confirmCopy(modal: HookAPI, { what, consequence, onOk }: Confirmation): void {
  modal.confirm({
    title: `Make a copy of ${what}?`,
    content: consequence,
    okText: "Make a copy",
    okButtonProps: { "data-testid": "confirm-copy" },
    cancelText: "Cancel",
    onOk,
  });
}
