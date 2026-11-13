import type { AutomationCatalogue } from "@/api/automations";
import type { ExplorerResource } from "@/api/explorer";
import type { CanvasCatalogueExtras } from "@/api/workflowGraph";

export type Catalogue = AutomationCatalogue & CanvasCatalogueExtras;

/** What every step editor is handed: the step's data, the setter, and the catalogues it picks from. */
export interface EditorProps {
  data: Record<string, unknown>;
  set: (changes: Record<string, unknown>) => void;
  catalogue: Catalogue;
  /** The dataset the workflow's trigger watches. */
  dataset?: ExplorerResource;
  datasets: ExplorerResource[];
}
