/** What a widget kind is: its families and the facts every surface needs about one. */

import type { ReactNode } from "react";

/** The families a reader browses, in the order they are offered. */
export const KIND_FAMILIES = ["number", "chart", "records", "module", "saved"] as const;
export type KindFamily = (typeof KIND_FAMILIES)[number];

export const FAMILY_LABELS: Record<KindFamily, { label: string; hint: string }> = {
  number: { label: "Numbers", hint: "One figure, read at a glance." },
  chart: { label: "Charts", hint: "A shape, from a dataset you may read." },
  records: { label: "Records", hint: "The rows themselves, a few at a time." },
  module: {
    label: "Your modules",
    hint: "A page of the product, in miniature — answered by that page's own endpoint.",
  },
  saved: { label: "Things you saved", hint: "Drawn as you left them, not rebuilt." },
};

export interface KindSpec {
  label: string;
  /** The question it answers, in the words somebody would ask it. */
  question: string;
  icon: ReactNode;
  /** Its colour in the picker. Decoration there, and only there. */
  colour: string;
  /** Which shelf of the picker it sits on. */
  family: KindFamily;
  /** How many of one kind on a dashboard stops being useful. */
  maximum: number;
  /** Whether it names a dataset, a saved thing, or nothing at all. */
  needs: "dataset" | "report" | "search" | "insight" | "nothing";
  /** Where the reader would go to see the whole of it. Modules have a page. */
  page?: string;
}
