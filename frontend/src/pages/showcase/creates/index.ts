/**
 * How a "create" opens, and why that shape (§10, §33).
 *
 * A platform that opens every create the same way is telling the reader that
 * every decision is the same size, and they are not: naming a folder is one
 * word, writing an announcement is a form, and composing a dashboard is a
 * sequence of choices where each one narrows the next. A drawer sliding in to
 * collect eight characters is theatre; a modal holding fourteen fields is a
 * form in a box too small for it; and a wizard for one field is four clicks
 * where one would do.
 *
 * So there are five shapes, and this is the declaration of which create uses
 * which. `creates.test.ts` asserts it against the code: every shape is
 * actually used, every entry's implementation contains the component its shape
 * implies, and — the assertion that keeps this true — every "new something"
 * control in the shipped sources is classified here. A create added without a
 * decision about its shape fails a test.
 *
 * Rendered on `/showcase/templates` for the same reason the layouts are: the
 * question "what shapes does this template give me, and when do I reach for
 * each" deserves an answer inside the product rather than in a wiki nobody
 * updates.
 */

import type { CreateFlow, CreateShape } from "./types";
import { RECORD_AND_ADMIN_FLOWS } from "./recordAndAdminFlows";
import { COLLABORATION_AND_BUILDER_FLOWS } from "./collaborationAndBuilderFlows";

export { CREATE_SHAPES } from "./shapes";
export type { CreateFlow, CreateShape, CreateShapeSpec } from "./types";

/** Every create in the product, in the order the gallery lists them. */
export const CREATE_FLOWS: readonly CreateFlow[] = [...RECORD_AND_ADMIN_FLOWS, ...COLLABORATION_AND_BUILDER_FLOWS];

/** The flows that open one shape, in declaration order. */
export const flowsOf = (shape: CreateShape): CreateFlow[] =>
  CREATE_FLOWS.filter((flow) => flow.shape === shape);
