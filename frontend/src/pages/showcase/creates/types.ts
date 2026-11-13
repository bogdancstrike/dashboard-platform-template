/** The five ways a create opens. */
export type CreateShape = "in place" | "modal" | "drawer" | "wizard" | "page";

export interface CreateShapeSpec {
  key: CreateShape;
  name: string;
  /** The size of decision it fits. */
  when: string;
  /** When it is the wrong answer — the half that stops it being a default. */
  unless: string;
  /** What a reader will find in the code: the AntD component it is built on. */
  built: string;
}

export interface CreateFlow {
  /** What gets created, in the reader's words. */
  what: string;
  shape: CreateShape;
  /** Where the control is. A route, without the leading slash. */
  where: string;
  /** The `data-testid` of the control that opens it, where it has one. */
  testId?: string;
  /** The module that opens it, relative to `frontend/src`. */
  opens: string;
  /** Why this shape and not the next one up. */
  because: string;
}

/**
 * Every create in the platform, classified.
 *
 * Ordered by shape, smallest decision first, because that is the order
 * somebody choosing a shape for a *new* create wants to read them in: start at
 * the top and stop at the first one that fits.
 */
