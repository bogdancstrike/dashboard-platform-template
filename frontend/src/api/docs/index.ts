import { api } from "../client";

import type { DocBlock, DocLink, DocPage, DocSpace, MeetingNote, PageRef, Revision, Template, TreeItem } from "./types";

export type * from "./types";

/** The wiki and meeting notes (§48–49): spaces, the page tree, pages, revisions, links and notes. */
export const docsApi = {
  spaces: (signal?: AbortSignal) =>
    api.get<{ items: DocSpace[]; can_edit: boolean }>("/api/docs/spaces", { signal }),
  createSpace: (input: { name: string; description?: string; icon?: string }) =>
    api.post<DocSpace>("/api/docs/spaces", input),
  updateSpace: (id: string, input: { name?: string; description?: string; icon?: string }) =>
    api.put<DocSpace>(`/api/docs/spaces/${id}`, input),
  removeSpace: (id: string) => api.delete<{ deleted: boolean }>(`/api/docs/spaces/${id}`),
  tree: (spaceId: string, signal?: AbortSignal) =>
    api.get<{ space: DocSpace; items: TreeItem[] }>(`/api/docs/spaces/${spaceId}`, { signal }),
  recent: (signal?: AbortSignal) => api.get<{ items: PageRef[] }>("/api/docs/pages", { signal }),
  page: (id: string, signal?: AbortSignal) => api.get<DocPage>(`/api/docs/pages/${id}`, { signal }),
  create: (input: {
    space_id: string;
    parent_id?: string | null;
    title?: string;
    icon?: string;
    template?: string;
    blocks?: DocBlock[];
  }) => api.post<DocPage>("/api/docs/pages", input),
  save: (
    id: string,
    input: { title?: string; icon?: string | null; blocks?: DocBlock[]; expected_version?: number },
  ) => api.put<DocPage>(`/api/docs/pages/${id}`, input),
  remove: (id: string) => api.delete<{ deleted: number }>(`/api/docs/pages/${id}`),
  move: (
    id: string,
    input: { parent_id?: string | null; before_id?: string; after_id?: string; space_id?: string },
  ) => api.post<{ id: string; parent_id: string | null }>(`/api/docs/pages/${id}/move`, input),
  revisions: (id: string, signal?: AbortSignal) =>
    api.get<{ items: Revision[]; current_version: number }>(`/api/docs/pages/${id}/revisions`, {
      signal,
    }),
  revision: (id: string, revisionId: string, signal?: AbortSignal) =>
    api.get<{ id: string; version: number; title: string; blocks: DocBlock[] }>(
      `/api/docs/pages/${id}/revisions/${revisionId}`,
      { signal },
    ),
  restore: (id: string, revisionId: string) =>
    api.post<DocPage>(`/api/docs/pages/${id}/revisions/${revisionId}/restore`, {}),
  link: (id: string, resourceType: string, resourceId: string) =>
    api.post<{ links: DocLink[] }>(`/api/docs/pages/${id}/links`, {
      resource_type: resourceType,
      resource_id: resourceId,
    }),
  unlink: (id: string, linkId: string) =>
    api.delete<{ links: DocLink[] }>(`/api/docs/pages/${id}/links/${linkId}`),
  createTask: (id: string, blockId: string) =>
    api.post<DocPage>(`/api/docs/pages/${id}/actions`, { block_id: blockId }),
  summarise: (id: string) =>
    api.post<{ summary: string }>(`/api/docs/pages/${id}/summary`, {}),
  backlinks: (resourceType: string, resourceId: string, signal?: AbortSignal) =>
    api.get<{ items: PageRef[]; can_edit: boolean }>("/api/docs/backlinks", {
      params: { resource_type: resourceType, resource_id: resourceId },
      signal,
    }),
  search: (q: string, signal?: AbortSignal) =>
    api.get<{ items: PageRef[]; total: number; q: string }>("/api/docs/search", {
      params: { q },
      signal,
    }),
  templates: (signal?: AbortSignal) =>
    api.get<{ items: Template[] }>("/api/docs/templates", { signal }),
  meetingNotes: (eventId: string, signal?: AbortSignal) =>
    api.get<{ items: MeetingNote[]; can_edit: boolean }>("/api/docs/meetings", {
      params: { event_id: eventId },
      signal,
    }),
  takeNotes: (eventId: string) => api.post<DocPage>("/api/docs/meetings", { event_id: eventId }),
};
