import { Button } from "antd";

import { NxIcon } from "@/components/NxIcon";
import { PageHeader } from "@/components/PageHeader";

import type { ExplorerPage } from "./useExplorerPage";

/** The title — the saved search's name once one is open — the count, and the save buttons. */
export function ExplorerHeader({ m }: { m: ExplorerPage }) {
  const { advancedSearch, allRecords, mode, openPanel, request, resource, savedName, savedOn, setSaveOpen, stats, total } = m;
  return (
    <PageHeader
      title={
        mode === "results" && savedName
          ? <span data-testid="explorer-title">{savedName}</span>
          : <>Data <em>explorer</em></>
      }
      subtitle={
        mode === "results"
          ? [
              resource?.label,
              stats.rules ? `${stats.rules} ${stats.rules === 1 ? "rule" : "rules"}${stats.groups ? ` in ${stats.groups + 1} groups` : ""}` : "",
              total !== undefined ? `${total.toLocaleString()} ${total === 1 ? "result" : "results"}` : "",
            ].filter(Boolean).join(" · ")
          : `Ask a question of ${allRecords.toLocaleString()} records — simply, or with rules and groups`
      }
      actions={
        <>
          {savedOn && (
            <Button icon={<NxIcon name="heart" size={15} />} onClick={() => openPanel({ panel: "saved" })}>
              Saved searches
            </Button>
          )}
          {mode === "results" || !advancedSearch ? (
            <Button
              type="primary"
              icon={<NxIcon name="heart" size={15} />}
              data-testid="save-search"
              disabled={!request}
              onClick={() => setSaveOpen(true)}
            >
              Save search
            </Button>
          ) : null}
        </>
      }
    />
  );
}
