import { Card, Skeleton, Typography } from "antd";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import { type DocSpace } from "@/api/docs";
import { relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

export function DocsHome({
  spaces,
  recent,
  loading,
  current,
}: {
  spaces: DocSpace[];
  recent?: Array<{ id: string; title: string; icon: string | null; space: string; updated_at: string; is_meeting?: boolean; updated_by?: { name: string } | null }>;
  loading: boolean;
  current?: DocSpace;
}) {
  const ordered = useMemo(() => [...spaces].sort((a, b) => Number(b.id === current?.id) - Number(a.id === current?.id)), [spaces, current]);
  return (
    <div className="nx-dc-home" data-testid="docs-home">
      <section>
        <h3 className="nx-dc-section">Spaces</h3>
        <div className="nx-dc-spaces">
          {ordered.map((item) => (
            <Link key={item.id} to={`/docs?space=${item.id}`} className={`nx-dc-space${item.id === current?.id ? " is-on" : ""}`} style={{ ["--space" as string]: item.color }}>
              <span className="nx-dc-space-icon" aria-hidden>{item.icon ?? "📚"}</span>
              <strong>{item.name}</strong>
              <span className="nx-co-muted">{item.description}</span>
              <span className="nx-dc-space-count">
                {item.page_count} page{item.page_count === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h3 className="nx-dc-section">Recently updated</h3>
        <Card className="nx-dc-card">
          {loading ? (
            <Skeleton active />
          ) : (recent ?? []).length === 0 ? (
            <EmptyState title="Nothing written yet" />
          ) : (
            <ul className="nx-dc-recent">
              {recent!.map((item) => (
                <li key={item.id}>
                  <Link to={`/docs/${item.id}`}>
                    <span aria-hidden className="nx-dc-recent-icon">{item.icon ?? (item.is_meeting ? "🗓️" : "📄")}</span>
                    <span className="nx-dc-recent-title">{item.title}</span>
                  </Link>
                  <Text type="secondary" className="nx-dc-recent-meta">
                    {item.space} · {item.updated_by?.name ? `${item.updated_by.name} · ` : ""}
                    {relativeTime(item.updated_at)}
                  </Text>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
