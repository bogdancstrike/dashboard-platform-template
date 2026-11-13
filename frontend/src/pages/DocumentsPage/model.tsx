/** The knowledge page's helpers. */

export const SCOPE_LABEL: Record<string, string> = {
  PRIVATE: "Only me",
  SHARED: "Shared",
  PUBLIC: "Everyone",
};

/**
 * Ask your documents (§44).
 *
 * The address carries the place: `?collection=` (pushed — it is a different
 * thing to look at), `?thread=` (pushed — a conversation is a place too),
 * `?tab=` (replaced — a view of the same place), and `?passage=` for the
 * citation preview, a URL drawer, so back closes it.
 */
