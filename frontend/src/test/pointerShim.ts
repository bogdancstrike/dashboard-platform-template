/**
 * jsdom has no PointerEvent, and without one `fireEvent.pointer*` builds a bare
 * Event that loses clientX/clientY — so a drag test would drag nowhere.
 * Imported for its side effect by the tests that drag.
 */
if (!("PointerEvent" in window)) {
  class PointerEventShim extends MouseEvent {
    pointerType: string;
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "mouse";
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim, configurable: true });
}



/**
 * Make `document.elementFromPoint` answer `target()` (jsdom has no layout, so
 * hit-testing a drag needs telling what is under the pointer). Returns the undo.
 */
export function pointAt(target: () => Element | null): () => void {
  const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
  const saved = Object.getOwnPropertyDescriptor(doc, "elementFromPoint");
  doc.elementFromPoint = () => target();
  return () => {
    if (saved) Object.defineProperty(doc, "elementFromPoint", saved);
    else delete (doc as { elementFromPoint?: unknown }).elementFromPoint;
  };
}
