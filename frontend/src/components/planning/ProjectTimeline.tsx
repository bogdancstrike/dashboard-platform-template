import { useState } from "react";

import { DEFAULT_TIMELINE, TimelineView, type TimelineState } from "./TimelineView";
import "@/styles/planning.css";

/** One project's work on the timeline — the same chart as /timeline, scoped (§18). */
export function ProjectTimeline({ projectId }: { projectId: string }) {
  const [state, setState] = useState<TimelineState>({ ...DEFAULT_TIMELINE, group: "epic" });
  return (
    <div data-testid="project-timeline">
      <TimelineView
        state={state}
        fixedProject={projectId}
        onChange={(changes) => setState((current) => ({ ...current, ...changes }))}
      />
    </div>
  );
}
