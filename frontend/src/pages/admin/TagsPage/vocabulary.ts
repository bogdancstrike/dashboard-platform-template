import type { TagCategory, TagVocabulary } from "@/api/tags";

/** The categories the manager groups by — `services/tags.CATEGORIES`. */
export const CATEGORIES: TagCategory[] = [
  "GENERAL",
  "PRIORITY",
  "STATUS",
  "REGION",
  "GOVERNANCE",
  "ENGINEERING",
];

/** What the page says about the vocabulary, in one sentence. */
export function summarise(vocabulary: TagVocabulary | undefined): string {
  if (!vocabulary) return "";
  const unused = vocabulary.items.filter((tag) => tag.usage_count === 0).length;
  const parts = [`${vocabulary.total} tags`];
  if (unused) {
    // The first thing to look at: a tag on nothing is either new or dead, and
    // a vocabulary nobody prunes stops being one.
    parts.push(`${unused} on nothing`);
  }
  return parts.join(" · ");
}
