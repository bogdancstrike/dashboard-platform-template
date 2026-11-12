/**
 * The advanced mode of the Data Explorer as a page of its own
 * (`/explore?mode=advanced`) — the design's "Advanced filters" screen.
 *
 * "Find [dataset] where all / any of these match", the condition builder under
 * it, and beside it what the draft *would* answer: a live count recounted as
 * the tree is edited, a breakdown by the first facet the dataset declares, and
 * the condition exactly as the server compiled it. Nothing behind the page is
 * re-asked until **Run search**, the same contract the drawer keeps (§4, §51).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, App as AntApp, Select, Tooltip } from "antd";

import { explorerApi, type ExplorerRequest, type ExplorerResource } from "@/api/explorer";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

import { ConditionBuilder, fieldIcon, fieldKindLabel, humanise } from "./ConditionBuilder";
import {
  appendChild,
  conjunctionOf,
  newRule,
  normalise,
  setGroupProps,
  setRuleField,
  treeStats,
} from "./conditionTree";
import { FdIcon } from "./fdIcons";
import { emptyTree, type QueryNode } from "./queryTree";

export interface AdvancedWorkspaceProps {
  resources: ExplorerResource[];
  resource: ExplorerResource;
  /** The question on screen; the draft starts as a copy of its tree. */
  request: ExplorerRequest;
  draft: QueryNode | null;
  onDraft: (tree: QueryNode) => void;
  onChooseResource: (key: string) => void;
  onRun: (tree: QueryNode | null) => void;
  onSave: (tree: QueryNode | null) => void;
}

/** A draft and its preview, shared by the page and its header actions. */
export function useDraftPreview(request: ExplorerRequest | null, draft: QueryNode | null) {
  const previewRequest = useMemo<ExplorerRequest | null>(
    () => (request ? { ...request, condition_tree: draft, page: 1, page_size: 1, facets: true } : null),
    [request, draft],
  );
  const debounced = useDebouncedValue(previewRequest, 280);
  const preview = useQuery({
    queryKey: ["explorer-preview", debounced],
    queryFn: ({ signal }) => explorerApi.query(debounced!, signal),
    enabled: Boolean(debounced),
    placeholderData: (previous) => previous,
  });
  return { preview, settling: preview.isFetching || previewRequest !== debounced };
}

export function AdvancedWorkspace({
  resources,
  resource,
  request,
  draft,
  onDraft,
  onChooseResource,
  onRun,
  onSave,
}: AdvancedWorkspaceProps) {
  const { message } = AntApp.useApp();
  const tree = useMemo(() => normalise(draft), [draft]);
  const stats = treeStats(tree);
  const { preview, settling } = useDraftPreview(request, tree);
  const conj = conjunctionOf(tree);
  const [fieldQuery, setFieldQuery] = useState("");
  const noun = resource.label.toLowerCase();

  const run = () => onRun(stats.rules ? tree : null);

  // ⌘/Ctrl + Enter runs, from anywhere on the page — the shortcut the actions
  // panel advertises.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = preview.data?.total;
  const facet = useMemo(() => {
    const facets = preview.data?.facets ?? {};
    const name = Object.keys(facets).find((key) => (facets[key]?.length ?? 0) > 0);
    if (!name) return null;
    const rows = [...(facets[name] ?? [])].sort((a, b) => b.count - a.count);
    const top = rows.slice(0, 4);
    const rest = rows.slice(4).reduce((sum, row) => sum + row.count, 0);
    const bars = [...top.map((row) => ({ label: humanise(row.value || "—"), n: row.count })), ...(rest ? [{ label: "Other", n: rest }] : [])];
    const max = Math.max(1, ...bars.map((bar) => bar.n));
    return { label: resource.fields.find((field) => field.name === name)?.label ?? humanise(name), bars, max };
  }, [preview.data, resource.fields]);

  const fieldGroups = useMemo(() => {
    const term = fieldQuery.trim().toLowerCase();
    const match = resource.fields.filter((field) => field.filterable && (!term || field.label.toLowerCase().includes(term)));
    const groups: Array<[string, typeof match]> = [
      ["Choices", match.filter((field) => field.kind === "enum" || field.kind === "bool")],
      ["Numbers & dates", match.filter((field) => field.kind === "number" || field.kind === "datetime")],
      ["Text & links", match.filter((field) => !["enum", "bool", "number", "datetime"].includes(field.kind))],
    ];
    return groups.filter(([, list]) => list.length > 0);
  }, [resource.fields, fieldQuery]);

  const addField = (name: string) => {
    const field = resource.fields.find((item) => item.name === name);
    if (!field) return;
    const rule = newRule();
    const withRule = appendChild(tree, tree.id as string, rule);
    onDraft(setRuleField(withRule, rule.id as string, field));
  };

  const compiled = preview.data?.condition_text?.trim() || "All records";

  return (
    <div className="nx-fd-adv">
      <div className="nx-fd-adv-main">
        <section className="nx-fd-adv-hero nx-glass nx-glass--strong" aria-label="Query subject">
          <span className="nx-fd-adv-word">Find</span>
          <Select
            className="nx-fd-adv-type"
            variant="borderless"
            aria-label={`Record type: ${resource.label}`}
            data-testid="dataset-select"
            value={resource.key}
            popupMatchSelectWidth={false}
            onChange={onChooseResource}
            labelRender={() => (
              <span className="nx-fd-adv-typelabel">
                <span className="nx-fd-adv-typeicon"><FdIcon name="table" size={15} /></span>
                {resource.label}
              </span>
            )}
            options={resources.map((item) => ({
              value: item.key,
              label: (
                <span className="nx-fd-typeopt">
                  <span>{item.label}</span>
                  <span className="nx-fd-muted">{item.record_count.toLocaleString()}</span>
                </span>
              ),
            }))}
          />
          <span className="nx-fd-adv-word is-muted">where</span>
          <div className="nx-fd-adv-allany" role="group" aria-label="Root group: match all or any">
            {(["AND", "OR"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={conj === option}
                className={conj === option ? "is-on" : ""}
                onClick={() => onDraft(setGroupProps(tree, tree.id as string, { conjunction: option }))}
              >
                {option === "AND" ? "all" : "any"}
              </button>
            ))}
          </div>
          <span className="nx-fd-adv-word is-muted">of these match</span>
          <span className="nx-fd-adv-url">/explore?mode=advanced</span>
        </section>

        <ConditionBuilder fields={resource.fields} value={tree} onChange={onDraft} />
      </div>

      <aside className="nx-fd-adv-side" aria-label="Query summary">
        <section className="nx-fd-adv-live nx-glass nx-glass--strong" aria-label="Live result">
          <span className="nx-fd-eyebrow"><span className="nx-fd-pulse" aria-hidden="true" />Live preview</span>
          <div className="nx-fd-adv-count" aria-live="polite" data-testid="advanced-live-count">
            <span className="nx-fd-adv-n">{total === undefined ? "—" : total.toLocaleString()}</span>
            <span className="nx-fd-adv-noun"><em className="nx-em">{noun}</em> match</span>
          </div>
          <span className="nx-fd-muted nx-fd-small">
            of {resource.record_count.toLocaleString()} {noun} · {settling ? "recounting…" : "recounted as you edit"}
          </span>
          {facet && (
            <div className="nx-fd-adv-bars" aria-label={`Matches by ${facet.label.toLowerCase()}`}>
              {facet.bars.map((bar) => (
                <div className="nx-fd-adv-bar" key={bar.label}>
                  <span className="nx-fd-ellipsis">{bar.label}</span>
                  <span className="nx-fd-adv-track"><span style={{ width: `${Math.round((bar.n / facet.max) * 100)}%` }} /></span>
                  <b>{bar.n.toLocaleString()}</b>
                </div>
              ))}
            </div>
          )}
          <div className="nx-fd-adv-stats">
            <span>
              {stats.rules} {stats.rules === 1 ? "rule" : "rules"} · {stats.groups} {stats.groups === 1 ? "group" : "groups"}
            </span>
            {stats.incomplete > 0 && (
              <>
                <span>·</span>
                <span className="nx-fd-pill nx-fd-pill--warn">{stats.incomplete} incomplete</span>
              </>
            )}
            <button type="button" className="nx-fd-link nx-fd-push" onClick={run}>Preview rows</button>
          </div>
        </section>

        {preview.isError && (
          <Alert
            type="error"
            showIcon
            message="This condition could not be previewed"
            description={preview.error instanceof Error ? preview.error.message : "Unknown error"}
          />
        )}

        <section className="nx-fd-adv-code nx-glass" aria-labelledby="nx-fd-compiled">
          <div className="nx-fd-row">
            <h2 id="nx-fd-compiled" className="nx-fd-h2">Compiled by the server</h2>
            <Tooltip title="Copy">
              <button
                type="button"
                className="nx-fd-iconbtn"
                aria-label="Copy compiled query"
                onClick={() => {
                  void navigator.clipboard?.writeText(compiled).then(
                    () => message.success("Copied"),
                    () => message.error("Could not copy"),
                  );
                }}
              >
                <FdIcon name="copy" size={14} />
              </button>
            </Tooltip>
          </div>
          <span className="nx-fd-muted nx-fd-small">What is written here is what will run.</span>
          <pre data-testid="query-inspector">{compiled}</pre>
          {stats.incomplete > 0 && (
            <span className="nx-fd-skipped">
              -- skipped: {stats.incomplete} incomplete {stats.incomplete === 1 ? "rule" : "rules"}
            </span>
          )}
        </section>

        <section className="nx-fd-adv-fields nx-glass" aria-labelledby="nx-fd-fields">
          <h2 id="nx-fd-fields" className="nx-fd-h2">Fields</h2>
          <label className="nx-fd-adv-fsearch">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14zM20 20l-3.5-3.5" /></svg>
            <input
              type="search"
              aria-label="Search fields"
              placeholder={`Search ${resource.fields.filter((field) => field.filterable).length} fields`}
              value={fieldQuery}
              onChange={(event) => setFieldQuery(event.target.value)}
            />
          </label>
          <div className="nx-fd-adv-flist">
            {fieldGroups.map(([name, list]) => (
              <div key={name}>
                <span className="nx-fd-eyebrow nx-fd-adv-fgroup">{name}</span>
                {list.map((field) => (
                  <div className="nx-fd-adv-field" key={field.name}>
                    <span className="nx-fd-cb-ticon"><FdIcon name={fieldIcon(field)} size={13} strokeWidth={2.1} /></span>
                    <span className="nx-fd-ellipsis nx-fd-grow">{field.label}</span>
                    <span className="nx-fd-muted nx-fd-tiny">{fieldKindLabel(field)}</span>
                    <button
                      type="button"
                      className="nx-fd-iconbtn is-accent"
                      aria-label={`Add rule: ${field.label.toLowerCase()}`}
                      onClick={() => addField(field.name)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="nx-fd-adv-actions nx-glass nx-glass--strong" aria-label="Query actions">
          <button type="button" className="nx-fd-run" onClick={run} data-testid="run-advanced-page">
            <FdIcon name="play" size={14} fill />
            Run search
          </button>
          <div className="nx-fd-row">
            <button type="button" className="nx-fd-ghost" disabled={stats.rules === 0} onClick={() => onDraft(emptyTree())}>
              Clear
            </button>
            <button type="button" className="nx-fd-soft" onClick={() => onSave(stats.rules ? tree : null)}>
              Save…
            </button>
          </div>
          <span className="nx-fd-muted nx-fd-tiny nx-fd-center">⌘ Enter to run · incomplete rules are skipped</span>
        </section>
      </aside>

      <div className="nx-fd-adv-dock nx-glass nx-glass--strong" role="region" aria-label="Query actions">
        <span className="nx-fd-adv-dockn">
          <b>{total === undefined ? "—" : total.toLocaleString()}</b>
          <span>match</span>
        </span>
        <button type="button" className="nx-fd-iconbtn is-plain" aria-label="Clear query" onClick={() => onDraft(emptyTree())}>
          <FdIcon name="close" size={15} strokeWidth={2.2} />
        </button>
        <button type="button" className="nx-fd-iconbtn" aria-label="Save search" onClick={() => onSave(stats.rules ? tree : null)}>
          <FdIcon name="bookmark" size={15} />
        </button>
        <button type="button" className="nx-fd-run is-dock" onClick={run}>
          <FdIcon name="play" size={13} fill />
          Run
        </button>
      </div>
    </div>
  );
}
