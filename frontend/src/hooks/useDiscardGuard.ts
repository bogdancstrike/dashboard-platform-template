import { App as AntApp } from "antd";
import { useCallback, useState } from "react";

/**
 * Leaving with unsaved changes is a decision, not an accident (§74).
 *
 * An AntD drawer or modal closes on `Esc` and on a click outside it, and the
 * form inside it holds its values in memory — so the gesture that dismisses a
 * dialog somebody has been typing into for two minutes is the same gesture
 * that dismisses one they opened by mistake. Every such layer in this platform
 * either asks before discarding or is listed in
 * `pages/showcase/guards.ts` with the reason it does not need to.
 *
 * The hook rather than a copy per dialog, because the copies drift in exactly
 * the way that matters: one of them forgets to reset the flag after a
 * successful save and then asks the reader to confirm discarding changes they
 * have already saved.
 *
 * Usage: mark the form dirty on change, call `requestClose` from every path
 * that closes the layer (the X, Cancel, `onCancel`, `onClose`), and call
 * `settled` after a successful save so the close that follows it is silent.
 */
export function useDiscardGuard({
  close,
  what,
}: {
  /** What to do when leaving is confirmed, or when there is nothing to lose. */
  close: () => void;
  /**
   * The subject, for the sentence: "This announcement has edits that have not
   * been saved." One noun phrase, lower case.
   */
  what: string;
}): {
  /** True while there is something to lose. */
  dirty: boolean;
  /** Call from the form's `onValuesChange` (or any control that edits). */
  touch: () => void;
  /** Call after a successful save, so the close that follows asks nothing. */
  settled: () => void;
  /** Close, asking first if there is something to lose. */
  requestClose: () => void;
} {
  const { modal } = AntApp.useApp();
  const [dirty, setDirty] = useState(false);

  const touch = useCallback(() => setDirty(true), []);
  const settled = useCallback(() => setDirty(false), []);

  const requestClose = useCallback(() => {
    if (!dirty) {
      close();
      return;
    }
    modal.confirm({
      title: "Discard your changes?",
      content: `This ${what} has edits that have not been saved.`,
      okText: "Discard",
      okButtonProps: { danger: true },
      cancelText: "Keep editing",
      onOk: () => {
        setDirty(false);
        close();
      },
    });
  }, [close, dirty, modal, what]);

  return { dirty, touch, settled, requestClose };
}
