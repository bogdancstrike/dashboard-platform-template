import { Input, Segmented, Select, Space, Switch, Tooltip } from "antd";

import { type TimelineGrouping } from "@/api/planning";

import { ZOOMS, type Zoom } from "../gantt";
import { projectOptions, useProjects } from "../useProjects";
import type { TimelineState } from "./state";

/** What a timeline bar's colours mean. */
export function TimelineLegend({ critical }: { critical: boolean }) {
  return (
    <span className="nx-pl-legend" aria-label="Legend">
      <span>
        <i /> Task
      </span>
      <span>
        <i className="is-milestone" /> Milestone
      </span>
      {critical && (
        <span>
          <i className="is-critical" /> Critical path
        </span>
      )}
      <span>
        <i className="is-broken" /> Broken dependency
      </span>
    </span>
  );
}

/** Group, zoom, project, search, done and critical path — every choice the address keeps. */
export function TimelineToolbar({
  state,
  onChange,
  fixedProject,
  compact,
  term,
  onTerm,
  legend,
}: {
  state: TimelineState;
  onChange: (changes: Partial<TimelineState>) => void;
  fixedProject?: string;
  compact: boolean;
  term: string;
  onTerm: (term: string) => void;
  legend: React.ReactNode;
}) {
  const projects = useProjects();
  return (
    <div className="nx-pl-toolbar" data-testid="timeline-toolbar">
      <Segmented
        aria-label="Group by"
        value={state.group}
        onChange={(value) => onChange({ group: value as TimelineGrouping })}
        options={[
          { value: "project", label: "Project" },
          { value: "epic", label: "Epic" },
          { value: "assignee", label: "Person" },
        ]}
      />
      <Segmented
        aria-label="Zoom"
        data-testid="timeline-zoom"
        value={state.zoom}
        onChange={(value) => onChange({ zoom: value })}
        options={(Object.keys(ZOOMS) as Zoom[]).map((zoom) => ({ value: zoom, label: ZOOMS[zoom].label }))}
      />
      {!fixedProject && (
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label="Project"
          placeholder="Every project"
          style={{ minWidth: compact ? 160 : 240 }}
          loading={projects.isLoading}
          value={state.project || undefined}
          onChange={(value: string | undefined) => onChange({ project: value ?? "" })}
          options={projectOptions(projects.data)}
          data-testid="timeline-project"
        />
      )}
      <Input.Search
        allowClear
        aria-label="Search the timeline"
        placeholder="Search work"
        style={{ width: compact ? 150 : 200 }}
        value={term}
        onChange={(event) => {
          onTerm(event.target.value);
          onChange({ q: event.target.value });
        }}
      />
      <Space size={6}>
        <Switch size="small" checked={state.done} onChange={(done) => onChange({ done })} aria-label="Show finished work" />
        <span>Done</span>
      </Space>
      <Tooltip title="The chain of linked work with no slack: if any of it slips, the end date slips.">
        <Space size={6}>
          <Switch
            size="small"
            checked={state.critical}
            onChange={(critical) => onChange({ critical })}
            aria-label="Highlight the critical path"
            data-testid="timeline-critical"
          />
          <span>Critical path</span>
        </Space>
      </Tooltip>
      <span className="nx-pl-spacer" />
      {!compact && legend}
    </div>
  );
}
