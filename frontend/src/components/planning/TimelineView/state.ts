import type { TimelineGrouping } from "@/api/planning";

import type { Zoom } from "../gantt";

export interface TimelineState {
  group: TimelineGrouping;
  zoom: Zoom;
  project: string;
  q: string;
  done: boolean;
  critical: boolean;
}

export const DEFAULT_TIMELINE: TimelineState = {
  group: "project",
  zoom: "week",
  project: "",
  q: "",
  done: true,
  critical: true,
};
