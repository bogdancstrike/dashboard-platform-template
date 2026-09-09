import { api } from "./client";

/**
 * Tags — one shared vocabulary, applied to anything (§37).
 *
 * Three things worth knowing before reading the types.
 *
 * **Reading the vocabulary needs no permission; applying a tag needs
 * `records.update`; changing the vocabulary needs `tags.manage`.** A picker
 * that cannot list the options is not a picker, putting a tag on a record is an
 * edit to that record, and renaming a tag changes what every record carrying it
 * says. The payloads publish `can_apply` and `can_manage` so a control can be
 * disabled with a reason rather than hidden (§76).
 *
 * **A record's tags are set as a whole set**, in one call. Add-one and
 * remove-one calls from two people editing the same record interleave into a
 * set neither of them chose.
 *
 * **A tag that does not exist is refused, not created.** A typo would otherwise
 * become a permanent member of a shared vocabulary, which is exactly what
 * having a vocabulary prevents.
 */

export type TagCategory =
  | "GENERAL"
  | "PRIORITY"
  | "STATUS"
  | "REGION"
  | "GOVERNANCE"
  | "ENGINEERING";

export interface Tag {
  id: string;
  name: string;
  /** The stable identity: "Urgent", "urgent" and " URGENT " are one tag. */
  slug: string;
  color: string;
  description: string;
  category: TagCategory;
  usage_count: number;
  /** Recolourable and describable, but never renamed or removed. */
  is_system: boolean;
}

export interface TagVocabulary {
  items: Tag[];
  total: number;
  categories: Array<{ value: TagCategory; count: number }>;
  can_manage: boolean;
  limit_per_record: number;
  taggable: string[];
}

export interface RecordTags {
  resource_type: string;
  resource_id: string;
  items: Tag[];
  can_apply: boolean;
  limit: number;
}

export interface TagInput {
  name?: string;
  color?: string;
  description?: string;
  category?: TagCategory;
}

export const tagsApi = {
  vocabulary: (signal?: AbortSignal) => api.get<TagVocabulary>("/tags", { signal }),
  create: (input: TagInput) => api.post<Tag>("/tags", input),
  update: (id: string, input: TagInput) => api.put<Tag>(`/tags/${id}`, input),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean; name: string; records: number }>(
      `/tags/${id}`,
    ),

  onRecord: (resourceType: string, recordId: string, signal?: AbortSignal) =>
    api.get<RecordTags>(`/api/records/${resourceType}/${recordId}/tags`, { signal }),
  /** The whole set, by name. Names not in the vocabulary are refused. */
  apply: (resourceType: string, recordId: string, names: string[]) =>
    api.put<RecordTags>(`/api/records/${resourceType}/${recordId}/tags`, { tags: names }),
};
