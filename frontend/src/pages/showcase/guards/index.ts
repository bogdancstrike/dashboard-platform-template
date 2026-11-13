/**
 * Which dialogs ask before discarding, and which deliberately do not (§74).
 *
 * An AntD drawer or modal closes on `Esc` and on a click outside it, and the
 * form inside holds its values in memory — so the gesture that dismisses a
 * dialog somebody has been typing into for two minutes is the same gesture
 * that dismisses one they opened by mistake. Nineteen such layers ship here,
 * and exactly one of them guarded before this file existed.
 *
 * The rule, and both halves matter:
 *
 * * **Guard when closing would lose something the reader typed or chose.** An
 *   email, an announcement, a rule tree, a widget's question, a role's name
 *   and code.
 * * **Do not guard otherwise, and say why.** A dialog whose state lives on the
 *   page behind it loses nothing — reopening shows the same choices — and a
 *   dialog holding one field that *is* the thing being named costs one gesture
 *   to retype. A confirmation there is the kind of guard that teaches people
 *   to click through confirmations, which is how the guards that matter stop
 *   working.
 *
 * `guards.test.ts` asserts this against the sources: every module that renders
 * a form inside a drawer or a modal is listed here, and a `guarded` one has to
 * use the hook. A dialog added without deciding fails the suite.
 */

import type { GuardedLayer } from "./types";
import { GUARDED_DIALOGS } from "./guardedDialogs";
import { UNGUARDED_DIALOGS } from "./unguardedDialogs";

export type { GuardedLayer } from "./types";

export const LAYERS: readonly GuardedLayer[] = [...GUARDED_DIALOGS, ...UNGUARDED_DIALOGS];

export const guardedLayers = (): GuardedLayer[] => LAYERS.filter((layer) => layer.guarded);
export const unguardedLayers = (): GuardedLayer[] => LAYERS.filter((layer) => !layer.guarded);
