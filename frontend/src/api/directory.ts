import { api } from "./client";

/**
 * The people directory — what every "pick a person" control reads.
 *
 * Deliberately not the user administration API (§12): this is the business
 * card, and it is what a viewer is allowed to see about a colleague they want
 * to share something with.
 */
export interface Person {
  id: string;
  name: string;
  email: string;
  username: string;
  job_title: string | null;
  avatar_url: string | null;
  /** Precomputed so a picker does not re-derive it per row. */
  initials: string;
  is_me: boolean;
}

export interface PeoplePage {
  items: Person[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

export const directoryApi = {
  people: (query: string, signal?: AbortSignal) =>
    api.get<PeoplePage>("/api/directory/people", { params: { q: query }, signal }),
};
