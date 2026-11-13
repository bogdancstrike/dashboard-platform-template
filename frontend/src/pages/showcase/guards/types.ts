/** One dialog that holds a form, and what was decided about closing it. */
export interface GuardedLayer {
  /** The module, relative to `frontend/src`. */
  module: string;
  /** What the reader is editing, in the sentence the guard uses. */
  what: string;
  /** Whether closing it asks first. */
  guarded: boolean;
  /** Why — required either way, because both answers are decisions. */
  because: string;
}
