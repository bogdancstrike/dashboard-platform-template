import { Button, Switch, Tooltip } from "antd";

import { NxIcon } from "@/components/NxIcon";

import type { useWorkflowCanvasPage } from "./useWorkflowCanvasPage";

type Page = ReturnType<typeof useWorkflowCanvasPage>;

/** Live or paused, discard the draft, and publish. */
export function CanvasActions({ page }: { page: Page }) {
  const data = page.data!;
  const { toggle } = page;
  const { discard, publish } = page.draft;
  return (
    <div className="nx-wf-actions">
      <Tooltip title={data.can_edit ? undefined : "Only its author can change this."}>
        <span className="nx-wf-live">
          <Switch size="small" checked={data.rule.enabled} disabled={!data.can_edit} loading={toggle.isPending}
            aria-label={data.rule.enabled ? "Pause workflow" : "Turn workflow on"}
            data-testid="canvas-enabled" onChange={(enabled) => toggle.mutate(enabled)} />
          <span>{data.rule.enabled ? "Live" : "Paused"}</span>
        </span>
      </Tooltip>
      {data.dirty && data.can_edit && (
        <Button onClick={() => discard.mutate()} loading={discard.isPending} data-testid="discard-draft">Discard draft</Button>
      )}
      {data.can_edit && (
        <Button type="primary" onClick={() => publish.mutate()} loading={publish.isPending} data-testid="publish-workflow"
          icon={<NxIcon name="flow" size={16} />}>
          Publish
        </Button>
      )}
    </div>
  );
}
