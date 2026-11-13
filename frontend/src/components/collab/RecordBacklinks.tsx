/**
 * "Pages about this record" (§48): the wiki pages that link here, above the
 * record's conversation. Says nothing at all when there are none — an empty
 * box on every record page would be noise.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { docsApi } from "@/api/docs";
import { relativeTime } from "@/lib/time";
import { FEATURES, withFeature } from "@/settings/features";

const SOURCE: Record<string, string> = {
  MANUAL: "linked",
  MENTION: "mentioned",
  ACTION: "action item",
};

function RecordBacklinksInner({ resourceType, resourceId }: { resourceType: string; resourceId: string }) {
  const links = useQuery({
    queryKey: ["doc-backlinks", resourceType, resourceId],
    queryFn: ({ signal }) => docsApi.backlinks(resourceType, resourceId, signal),
    enabled: Boolean(resourceId),
    retry: false,
    staleTime: 30_000,
  });
  const items = links.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="nx-co-backlinks" aria-label="Wiki pages about this record" data-testid="record-backlinks">
      <h4>Pages about this</h4>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <Link to={`/docs/${item.id}`}>
              <span aria-hidden>{item.icon ?? (item.is_meeting ? "🗓️" : "📄")}</span>
              <span className="nx-co-backlink-title">{item.title}</span>
            </Link>
            <span className="nx-co-muted">
              {item.space} · {SOURCE[item.source ?? "MANUAL"] ?? "linked"} · {relativeTime(item.updated_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Rendered only while its feature flag is on (§27). */
export const RecordBacklinks = withFeature(FEATURES.docs, RecordBacklinksInner);
