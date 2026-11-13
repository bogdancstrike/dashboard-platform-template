import { AdvancedSearchDrawer } from "@/components/explorer/AdvancedSearchDrawer";
import { RecordPreview } from "@/components/explorer/RecordPreview";
import type { QueryNode } from "@/components/explorer/queryTree";
import { SavedSearchDrawer } from "@/components/explorer/SavedSearchDrawer";
import { SavedSearchForm } from "@/components/explorer/SavedSearchForm";

import { savedQuestion } from "./explorerUrl";
import type { ExplorerPage } from "./useExplorerPage";

/** The drawers and dialogs the address opens: rules, saved searches, a preview, the save form, bulk. */
export function ExplorerOverlays({ m }: { m: ExplorerPage }) {
  const { advancedOpen, advancedSearch, bulk, chooseResource, closePanel, closeRules, draftToSave, editing, openPanel, openSaved, params, previewId, queryText, request, requestedResource, resource, resources, saveOpen, saveValue, savedOn, savedOpen, set, setDraftToSave, setEditing, setSaveOpen } = m;
  return (
    <>
      {resource && request && advancedSearch && (
        <AdvancedSearchDrawer
          open={advancedOpen}
          fields={resource.fields}
          request={request}
          datasetLabel={resource.label}
          recordCount={resource.record_count}
          resources={resources}
          onChooseResource={chooseResource}
          {...(savedOn ? { onOpenSaved: () => openPanel({ panel: "saved", from: "rules" }) } : {})}
          onClose={closeRules}
          onSearch={(next) => set({ tree: next ? JSON.stringify(next) : null, page: null, panel: null })}
          {...(savedOn
            ? {
                onSave: (next: QueryNode | null) => {
                  setDraftToSave(next);
                  setSaveOpen(true);
                },
              }
            : {})}
        />
      )}

      {bulk.dialog}

      <RecordPreview
        resourceType={requestedResource}
        recordId={previewId}
        term={queryText}
        onClose={() => closePanel({ record: null })}
      />

      <SavedSearchDrawer
        open={savedOpen && savedOn}
        resourceType={resource?.key ?? ""}
        onClose={() => closePanel({ panel: null, from: null })}
        {...(params.get("from") === "rules"
          ? { onBack: () => closePanel({ panel: "rules", from: null }), backLabel: "Rules" }
          : {})}
        onOpen={openSaved}
        onEdit={(search) => {
          setEditing(search);
          setSaveOpen(true);
        }}
      />
      {saveValue && savedOn && (
        <SavedSearchForm
          open={saveOpen}
          value={editing ? savedQuestion(editing) : saveValue}
          {...(editing ? { search: editing } : {})}
          onClose={() => {
            setSaveOpen(false);
            setDraftToSave(undefined);
            setEditing(undefined);
          }}
          // Saving a draft also runs it: a search worth naming is one the
          // person is about to look at, and leaving the page showing something
          // else would make the saved name refer to rows nobody can see.
          onSaved={(saved) => {
            // Editing changes the name or the audience, not the question on
            // screen; only a freshly saved draft has a new question to show.
            if (!editing) {
              set({
                ...(draftToSave !== undefined
                  ? { tree: draftToSave ? JSON.stringify(draftToSave) : null }
                  : {}),
                saved: saved.id,
              });
            }
            setDraftToSave(undefined);
            setEditing(undefined);
          }}
          onTransferred={() => setEditing(undefined)}
        />
      )}
    </>
  );
}
