import { api, download } from "./client";

/**
 * Loading a spreadsheet somebody exported from something else (§29).
 *
 * Five things worth knowing before reading the types.
 *
 * **The steps are the model's, not the page's.** `step` is stored on the run,
 * so a draft reopens where it was left rather than wherever the data implies —
 * a run whose mapping happens to be complete but which nobody has looked at
 * should land on the preview, not skip past it.
 *
 * **`column_mapping` is `{column: field}`,** which reads backwards until you
 * notice why: the file is the thing with duplicates in it. Two columns can
 * want the same field and the server refuses that, and keying by column is
 * what makes the refusal expressible.
 *
 * **The counts add up.** `total_rows = valid + invalid + skipped` once the
 * rows have been validated, and `skipped` means one thing: after mapping, the
 * row has nothing in any mapped column. Before validation they are all zero,
 * because they are not yet facts about anything.
 *
 * **`line` is the line in the file**, not an index. Row 1 is the header, so
 * the first data row is 2 — which is the number somebody needs to find it in
 * the spreadsheet they are about to fix.
 *
 * **Nothing is written until the preview has been seen**, and then it is
 * all-or-nothing: a failure part-way leaves no records at all. `can_execute`
 * comes from the server for the same reason every other control does.
 *
 * **Letting one go takes two presses**, the rule `/exports` and `/mail` use:
 * the file first, the record second, with `removed` saying which happened.
 *
 * See `services/imports.py`.
 */

export type ImportStatus =
  | "DRAFT"
  | "VALIDATED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ImportStep = "UPLOAD" | "MAPPING" | "PREVIEW" | "EXECUTE" | "DONE";

/** One column as found in the file, with samples so two can be told apart. */
export interface DetectedColumn {
  index: number;
  name: string;
  samples: string[];
}

/** One thing wrong with one row, in the four terms needed to fix it. */
export interface RowProblem {
  /** The line in the file. The header is line 1. */
  line: number;
  column: string;
  field?: string;
  /** The value as it was written, so the report reads beside the sheet. */
  value: string;
  message: string;
}

/** One staged row, as the file has it and as the mapping reads it. */
export interface PreviewRow {
  line: number;
  source: Record<string, string>;
  values: Record<string, string | undefined>;
  problems: RowProblem[];
}

export interface ImportRun {
  id: string;
  reference: string;
  filename: string;
  target_entity: string;
  target_label: string;
  status: ImportStatus;
  step: ImportStep;
  delimiter: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  skipped_rows: number;
  imported_rows: number;
  detected_columns: DetectedColumn[];
  /** `{column: field}` — see the module note on why that way round. */
  column_mapping: Record<string, string>;
  /** Required fields with no column yet. Empty means ready to validate. */
  unmapped_required: string[];
  error_count: number;
  created_at: string | null;
  completed_at: string | null;
  can_execute: boolean;
  /** Whether letting it go would do anything — false only while it is writing. */
  can_discard: boolean;
  /**
   * Whether it still holds the staged file, and so which of `discard`'s two
   * presses the next one is. Said by the server rather than inferred: the
   * `/exports` page inferred the equivalent from `size_bytes` and could never
   * reach its own second press.
   */
  holds_file: boolean;
}

export interface ImportDetail extends ImportRun {
  errors: RowProblem[];
  preview: PreviewRow[];
  preview_total: number;
  /** Present on the answer to `begin`: what the file turned out to be. */
  dialect?: {
    delimiter: string;
    label: string;
    consistent: boolean;
    /** A sentence shown to the reader, so a wrong guess is visible. */
    note: string;
  };
  blank_rows?: number;
  ran_as?: string;
}

/** One field a column may be mapped onto, and what it accepts. */
export interface ImportField {
  name: string;
  label: string;
  kind: string;
  required: boolean;
  choices: string[];
  minimum: number | null;
  maximum: number | null;
  /** Which dataset a foreign key points at, so the wizard can say so. */
  references: string;
}

export interface ImportTarget {
  key: string;
  label: string;
  description: string;
  fields: ImportField[];
  required: string[];
}

export interface ImportCatalogue {
  targets: ImportTarget[];
  delimiters: Array<{ key: string; label: string }>;
  max_rows: number;
  max_bytes: number;
  preview_rows: number;
  open_limit: number;
  open: number;
  statuses: Array<{ key: ImportStatus; count: number }>;
  steps: ImportStep[];
  total: number;
}

export interface ImportsPage {
  items: ImportRun[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  columns: string[];
}

export interface ImportQuery {
  [key: string]: unknown;
  q?: string;
  status?: string;
  page?: number;
  page_size?: number;
}

export const importsApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<ImportCatalogue>("/imports/catalogue", { signal }),
  list: (params: ImportQuery = {}, signal?: AbortSignal) =>
    api.get<ImportsPage>("/imports", { params, signal }),
  entry: (id: string, signal?: AbortSignal) =>
    api.get<ImportDetail>(`/imports/${id}`, { signal }),
  /**
   * Send the file's text. Not a presigned upload: the API has to parse it, so
   * routing the bytes through object storage and back would move them through
   * the same worker twice.
   */
  begin: (input: {
    target_entity: string;
    filename: string;
    content: string;
    delimiter?: string;
  }) => api.post<ImportDetail>("/imports", input),
  /** Set the mapping and validate every row — one call, because it is one thought. */
  map: (id: string, columnMapping: Record<string, string>) =>
    api.put<ImportDetail>(`/imports/${id}/mapping`, { column_mapping: columnMapping }),
  /** Write the valid rows. All of them or none of them. */
  execute: (id: string) => api.post<ImportDetail>(`/imports/${id}/execute`, {}),
  /**
   * Let one go. The first press abandons the draft and drops the staged file;
   * a second removes the record. `removed` says which happened.
   */
  discard: (id: string) =>
    api.delete<ImportRun & { removed?: boolean }>(`/imports/${id}`),
  /** The error report, saved as a file to fix in the spreadsheet. */
  problems: (id: string, reference: string) =>
    download(`/imports/${id}/problems`, { fallbackName: `${reference}-problems.csv` }),
};
