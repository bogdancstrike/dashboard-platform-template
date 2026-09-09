import { api } from "./client";

/**
 * The file manager (§20).
 *
 * Presigned-URL-first, and the shape of this client says so: `beginUpload`
 * returns a URL the *browser* PUTs to, and `downloadUrl` returns one the
 * browser follows. Neither the upload nor the download passes through the API,
 * which is what keeps a 400 MB file from occupying a worker for its duration.
 *
 * That is also why an upload is two calls: the API cannot see the transfer, so
 * `confirmUpload` is where it checks the object arrived rather than believing
 * the browser.
 */

export interface StoredFile {
  id: string;
  name: string;
  extension: string | null;
  mime_type: string | null;
  /** A coarse grouping — `DOCUMENT`, `IMAGE`, `SPREADSHEET`. */
  kind: string;
  size_bytes: number;
  checksum: string | null;
  folder_id: string | null;
  /** `UPLOADING` until the bytes are confirmed present, then `READY`. */
  status: string;
  version: number;
  download_count: number;
  preview_text: string | null;
  owner: string;
  created_at: string | null;
  last_accessed_at: string | null;
}

export interface FileFolder {
  id: string;
  name: string;
  path: string;
  parent_id: string | null;
  /** How deep the materialised path is, so a tree needs no traversal. */
  depth: number;
  color: string | null;
  is_shared: boolean;
  file_count: number;
  total_bytes: number;
  owner: string;
}

export interface FileTree {
  folders: FileFolder[];
  /** Files in no folder. Real, and reachable, or they are rows nobody sees. */
  unfiled: { file_count: number; total_bytes: number };
  /** `object` or `local` — the local one streams through the API (§24). */
  store: string;
  max_upload_bytes: number;
  refused_extensions: string[];
  can_manage: boolean;
}

/** What the browser needs to put the bytes somewhere itself. */
export interface UploadTicket {
  file: StoredFile;
  upload: { url: string; method: string; expires_in: number; headers: Record<string, string> };
}

export interface FilePage {
  items: StoredFile[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export const filesApi = {
  tree: (signal?: AbortSignal) => api.get<FileTree>("/api/files/tree", { signal }),
  list: (
    params: { folder_id?: string; q?: string; kind?: string; page?: number; page_size?: number },
    signal?: AbortSignal,
  ) => api.get<FilePage>("/api/files", { params, signal }),

  beginUpload: (input: { name: string; size_bytes: number; mime_type?: string; folder_id?: string | null }) =>
    api.post<UploadTicket>("/api/files", input),
  confirmUpload: (id: string) => api.post<StoredFile>(`/api/files/${id}/confirm`, {}),

  downloadUrl: (id: string) =>
    api.get<{ file: StoredFile; download: { url: string; method: string; expires_in: number } }>(
      `/api/files/${id}`,
    ),

  /**
   * The same object, framed for *showing* rather than saving (§20).
   *
   * One word of the response's disposition — `inline` instead of `attachment`
   * — and the bytes still go straight from storage to the browser. A preview
   * that streamed through the API would put a 400 MB file back on a worker.
   */
  previewUrl: (id: string, signal?: AbortSignal) =>
    api.get<{ file: StoredFile; download: { url: string; method: string; expires_in: number } }>(
      `/api/files/${id}`,
      { params: { inline: true }, signal },
    ),

  update: (id: string, input: { name?: string; folder_id?: string | null }) =>
    api.put<StoredFile>(`/api/files/${id}`, input),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean; name: string }>(`/api/files/${id}`),

  createFolder: (input: { name: string; parent_id?: string | null }) =>
    api.post<FileFolder>("/api/files/folders", input),
  removeFolder: (id: string) =>
    api.delete<{ id: string; deleted: boolean; path: string }>(`/api/files/folders/${id}`),
};

/**
 * Put one file's bytes where the ticket says, reporting progress.
 *
 * `XMLHttpRequest` rather than `fetch`, and this is the one place in the
 * product that reaches for it: `fetch` has no upload-progress event, and a
 * multi-file drop with no per-file progress is a spinner somebody watches for
 * four minutes wondering whether it is stuck.
 */
export function putBytes(
  ticket: UploadTicket,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(ticket.upload.method, ticket.upload.url, true);
    for (const [header, value] of Object.entries(ticket.upload.headers)) {
      if (value) request.setRequestHeader(header, value);
    }
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener("load", () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Storage refused the upload (${request.status})`)),
    );
    request.addEventListener("error", () =>
      reject(new Error("The upload could not reach storage.")),
    );
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
    request.send(file);
  });
}

/** Bytes as a person reads them. */
export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
