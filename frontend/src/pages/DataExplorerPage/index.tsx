import { Alert } from "antd";

import { errorText } from "@/lib/errors";

import { ExplorerHeader } from "./ExplorerHeader";
import { ExplorerOverlays } from "./ExplorerOverlays";
import { ResultsPanel } from "./ResultsPanel";
import { QuestionChips, SearchBar } from "./SearchBar";
import { StartPanels } from "./StartPanels";
import { useExplorerCommands } from "./useExplorerCommands";
import { useExplorerPage } from "./useExplorerPage";

/**
 * Data Explorer is the canonical composition of platform query primitives.
 * Its entire state is URL-backed, so back/forward, bookmarks and shared links
 * reproduce the same question and presentation for another authorized user.
 */
export default function DataExplorerPage() {
  const m = useExplorerPage();
  const { mode, catalogue, resource, set } = m;
  useExplorerCommands(m);

  return (
    <div className={`nx-fd-explore nx-fd-explore--${mode}`}>
      <ExplorerHeader m={m} />

      {catalogue.isError && (
        <Alert type="error" showIcon message="The explorer catalogue could not be loaded" description={errorText(catalogue.error)} />
      )}

      <>
          <SearchBar m={m} />

          <QuestionChips m={m} />

          {mode === "start" && resource && (
            <StartPanels
              dataset={resource.key}
              label={resource.label}
              onAsk={(term) => set({ q: term, page: null })}
            />
          )}

          <ResultsPanel m={m} />
      </>

      <ExplorerOverlays m={m} />
    </div>
  );
}
