import type { CreateShapeSpec } from "./types";

export const CREATE_SHAPES: readonly CreateShapeSpec[] = [
  {
    key: "in place",
    name: "In place",
    when: "The new thing belongs in a list the reader is already looking at, and its whole content is a line of text.",
    unless: "Anything else has to be decided at the same time — an owner, a date — because then the row is a form pretending not to be one.",
    built: "An input where the row will be",
  },
  {
    key: "modal",
    name: "Plain modal",
    when: "One question, occasionally two. A name; a name and where it goes.",
    unless: "The answer needs the page behind it — a filter to read, a table to compare against — because a modal covers exactly that.",
    built: "Modal",
  },
  {
    key: "drawer",
    name: "Drawer",
    when: "One object's fields: enough to need a form, not enough to need steps. The page stays visible beside it.",
    unless: "The fields depend on each other in a way that makes half of them meaningless until an earlier one is answered — that is a wizard.",
    built: "Drawer",
  },
  {
    key: "wizard",
    name: "Wizard",
    when: "The decision has parts, and each part narrows the next. Nothing is written until the last step, and the review step is the point.",
    unless: "The parts are independent — then the reader is being made to click Next four times for no reason.",
    built: "Steps",
  },
  {
    key: "page",
    name: "Its own page",
    when: "Composing the thing *is* the work: a report, a chart. It wants the whole window, a live preview, and its own address so a half-built draft can be shared.",
    unless: "The reader was in the middle of something else — a create that navigates away loses their place.",
    built: "A route in App.tsx",
  },
];
