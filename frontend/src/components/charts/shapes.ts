/**
 * What each chart kind *needs*, declared beside the renderer that needs it
 * (§28, §44).
 *
 * The report builder offers seven of the fourteen kinds the platform themes,
 * and the reason is not that the other seven are unwanted: a heatmap needs a
 * second dimension, a scatter needs a second measure, a gauge needs one number
 * and no grouping at all. Offering them anyway produces a picture that is
 * empty or, worse, wrong — a treemap of one dimension drawn as a flat mosaic
 * looks like an answer.
 *
 * So the requirement is written down once, here, and every screen that offers
 * a choice of picture reads it. Two things follow that are worth the file:
 *
 * **A kind that cannot be drawn is offered and refused, not hidden** (§76).
 * "Heatmap — needs a second dimension" teaches somebody that heatmaps exist
 * and how to get one; a heatmap that quietly disappears from the list teaches
 * nothing.
 *
 * **The requirement lives with the renderer, not with the builder.** These are
 * facts about `options.ts` — what `heatmap()` reads, what `scatter()` reads —
 * and a list kept in a page is a list that goes stale the first time a
 * renderer changes what it consumes.
 */

import type { ChartKind } from "@/api/dashboard";

export interface ChartShape {
  kind: ChartKind;
  label: string;
  /** The question this picture answers, in the words somebody would ask it. */
  question: string;
  /** How many grouping columns it reads. */
  dimensions: 1 | 2;
  /** How many measures it reads. Two means x against y. */
  measures: 1 | 2;
  /** Whether the first dimension has to be a date bucketed into a series. */
  overTime?: boolean;
  /**
   * Whether it reads a *category* and cannot read a date.
   *
   * Marked per kind rather than inferred from `overTime`, because the two are
   * not opposites: a bar chart of months is a column chart of periods and
   * perfectly ordinary, while a pie of months is a pie of months.
   */
  categorical?: boolean;
  /** Whether it reads a single row rather than a list of them. */
  single?: boolean;
}

/**
 * Every kind, in the order a person browses them: shapes for comparing, then
 * for parts of a whole, then for the specialised questions.
 */
export const CHART_SHAPES: readonly ChartShape[] = [
  { kind: "bar", label: "Bar", question: "How do these compare?", dimensions: 1, measures: 1 },
  {
    kind: "hbar",
    label: "Horizontal bar",
    question: "How do these compare, when the labels are long?",
    dimensions: 1,
    measures: 1,
  },
  {
    kind: "line",
    label: "Line",
    question: "Which way is this going?",
    dimensions: 1,
    measures: 1,
    overTime: true,
  },
  {
    kind: "area",
    label: "Area",
    question: "Which way is this going, and how much of it is there?",
    dimensions: 1,
    measures: 1,
    overTime: true,
  },
  {
    kind: "multi-line",
    label: "Multi-line",
    question: "Which way are these going, against each other?",
    dimensions: 2,
    measures: 1,
    overTime: true,
  },
  {
    kind: "stacked-area",
    label: "Stacked area",
    question: "What is the total made of, over time?",
    dimensions: 2,
    measures: 1,
    overTime: true,
  },
  {
    kind: "stacked-bar",
    label: "Stacked bar",
    question: "What is each period made of?",
    dimensions: 2,
    measures: 1,
  },
  {
    kind: "stacked-hbar",
    label: "Stacked horizontal bar",
    question: "What is each category made of?",
    dimensions: 2,
    measures: 1,
  },
  {
    kind: "pie",
    label: "Pie",
    question: "What share is each?",
    dimensions: 1,
    measures: 1,
    categorical: true,
  },
  {
    kind: "treemap",
    label: "Treemap",
    question: "What share is each, nested inside its group?",
    dimensions: 2,
    measures: 1,
    categorical: true,
  },
  {
    kind: "funnel",
    label: "Funnel",
    question: "Where do they drop out of the sequence?",
    dimensions: 1,
    measures: 1,
    categorical: true,
  },
  {
    kind: "radar",
    label: "Radar",
    question: "What is the profile across these categories?",
    dimensions: 1,
    measures: 1,
    categorical: true,
  },
  {
    kind: "heatmap",
    label: "Heatmap",
    question: "Where do these two dimensions concentrate?",
    dimensions: 2,
    measures: 1,
  },
  {
    kind: "scatter",
    label: "Scatter",
    question: "Do these two numbers move together?",
    dimensions: 1,
    measures: 2,
  },
  {
    kind: "gauge",
    label: "Gauge",
    question: "How close to target is this one number?",
    dimensions: 1,
    measures: 1,
    single: true,
  },
] as const;

export const shapeFor = (kind: ChartKind): ChartShape | undefined =>
  CHART_SHAPES.find((shape) => shape.kind === kind);

/** The question a builder is currently composing, as far as a shape cares. */
export interface ChartDraft {
  dimensions: number;
  measures: number;
  /** Whether the first dimension is a date read as a series. */
  overTime: boolean;
}

/**
 * Whether a draft can feed a kind, and what is missing when it cannot.
 *
 * Returns the sentence rather than a boolean, because the sentence is what the
 * reader needs: "needs a second dimension" is actionable and "unavailable" is
 * not. `null` means it fits.
 */
export function missingFor(shape: ChartShape, draft: ChartDraft): string | null {
  if (draft.dimensions < shape.dimensions) {
    return shape.dimensions === 2 ? "needs a second grouping" : "needs a grouping";
  }
  if (draft.measures < shape.measures) {
    return shape.measures === 2 ? "needs a second measure" : "needs a measure";
  }
  // A time series read as a pie is a pie of months, which is a chart nobody
  // asked for; the reverse — a line of categories — implies an order the
  // categories do not have.
  if (shape.overTime && !draft.overTime) {
    return "needs a date grouped into a series";
  }
  if (shape.categorical && draft.overTime) {
    return "reads a category, not a date — a pie of months is a pie of months";
  }
  if (shape.single && draft.dimensions > 1) {
    return "reads one number, so it takes a single grouping";
  }
  return null;
}

/** Every kind this draft can actually draw, in browsing order. */
export const fittingShapes = (draft: ChartDraft): ChartShape[] =>
  CHART_SHAPES.filter((shape) => missingFor(shape, draft) === null);
