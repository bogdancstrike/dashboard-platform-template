import {
  BarChartOutlined,
  BarsOutlined,
  BuildOutlined,
  ClearOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";

import { usePageCommands } from "@/commands/CommandContext";

import { VIEW_OPTIONS } from "./explorerUrl";
import type { ExplorerPage } from "./useExplorerPage";

export function useExplorerCommands(m: ExplorerPage) {
  const {
    advancedSearch, setAdvancedOpen, activeFilterCount, clearQuestion, setDraftToSave, setEditing, setSaveOpen,
    savedOn, openPanel, view, set, resource, navigate, results,
  } = m;
  /**
   * What this page can do, for the palette (§31).
   *
   * The page with the most controls on it had none of them here, which is
   * backwards: the palette earns its keystroke on the screens where the thing
   * you want is behind a picker you have to find first. Every command is the
   * same action the visible control performs — not a second implementation —
   * and the ones a flag has switched off are absent rather than offered and
   * refused (§27, §76).
   */
  usePageCommands("explore", [
    ...(advancedSearch
      ? [
          {
            id: "explore.advanced",
            label: "Build an advanced condition",
            icon: <BuildOutlined />,
            keywords: "query builder rule group nested and or filter",
            run: () => setAdvancedOpen(true),
          },
        ]
      : []),
    ...(activeFilterCount > 0
      ? [
          {
            id: "explore.clear",
            label: `Clear the question (${activeFilterCount} active)`,
            icon: <ClearOutlined />,
            keywords: "reset filters start over empty",
            run: clearQuestion,
          },
        ]
      : []),
    {
      id: "explore.save",
      label: "Save this as a search",
      icon: <SaveOutlined />,
      keywords: "saved search bookmark keep reuse share",
      run: () => {
        setDraftToSave(undefined);
        setEditing(undefined);
        setSaveOpen(true);
      },
    },
    ...(savedOn
      ? [{
          id: "explore.saved",
          label: "Open the saved searches",
          icon: <FolderOpenOutlined />,
          keywords: "saved views panel mine shared",
          run: () => openPanel({ panel: "saved" }),
        }]
      : []),
    ...VIEW_OPTIONS.filter((option) => option.value !== view).map((option) => ({
      id: `explore.view.${option.value}`,
      label: `Read as ${option.label.toLowerCase()}`,
      icon: <BarsOutlined />,
      keywords: "view mode layout table list cards compact",
      run: () => set({ view: option.value, page: null }),
    })),
    ...(resource
      ? [
          {
            id: "explore.analyse",
            label: `Analyse ${resource.label.toLowerCase()} instead`,
            icon: <BarChartOutlined />,
            keywords: "analytics group chart measure cut",
            run: () => navigate(`/analytics?resource=${resource.key}`),
          },
        ]
      : []),
    {
      id: "explore.refresh",
      label: "Ask the question again",
      icon: <ReloadOutlined />,
      keywords: "refresh reload rerun current",
      run: () => void results.refetch(),
    },
  ]);
}
