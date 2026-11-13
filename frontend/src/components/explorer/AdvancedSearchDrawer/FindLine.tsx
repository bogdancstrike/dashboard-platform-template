import { Select } from "antd";

import type { ExplorerRequest, ExplorerResource } from "@/api/explorer";

/** "Find [dataset] where …" — the dataset as a choice when there are others, and the way to a saved search. */
export function FindLine({
  request,
  datasetLabel,
  resources,
  onChooseResource,
  onOpenSaved,
}: {
  request: ExplorerRequest;
  datasetLabel?: string;
  resources?: ExplorerResource[];
  onChooseResource?: (key: string) => void;
  onOpenSaved?: () => void;
}) {
  return (
    <div className="nx-fd-dfind">
      <span>Find</span>
      {resources && resources.length > 0 && onChooseResource ? (
        <Select
          className="nx-fd-dfind-select"
          aria-label="Dataset"
          data-testid="dataset-select"
          value={request.resource_type}
          popupMatchSelectWidth={false}
          onChange={onChooseResource}
          options={resources.map((item) => ({
            value: item.key,
            label: (
              <span className="nx-fd-typeopt">
                <span>{item.label}</span>
                <span className="nx-fd-muted">{item.record_count.toLocaleString()}</span>
              </span>
            ),
          }))}
          labelRender={() => resources.find((item) => item.key === request.resource_type)?.label ?? request.resource_type}
        />
      ) : (
        <b>{datasetLabel ?? request.resource_type}</b>
      )}
      <span>where</span>
      {onOpenSaved && (
        <button type="button" className="nx-fd-link nx-fd-push" onClick={onOpenSaved}>
          Load a saved search
        </button>
      )}
    </div>
  );
}
