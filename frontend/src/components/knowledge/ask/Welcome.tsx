import { Typography } from "antd";

import type { CollectionDetail } from "@/api/knowledge";
import { EmptyState } from "@/components/EmptyState";
import { KnIcon } from "@/components/icons/KnIcon";

const { Text } = Typography;

/** What an empty conversation opens on: suggested questions, or why there is nothing to ask yet. */
export function Welcome({
  collection,
  ready,
  suggestions,
  onAsk,
}: {
  collection: CollectionDetail;
  ready: boolean;
  suggestions: string[];
  onAsk: (question: string) => void;
}) {
  return (
    <div className="nx-kn-welcome">
      <span className="nx-kn-welcome-mark">
        <KnIcon name="spark" size={22} />
      </span>
      {ready ? (
        <>
          <Text strong className="nx-kn-welcome-title">
            Ask anything about {collection.name}
          </Text>
          <Text type="secondary">
            Answers come only from its {collection.counts.ready} document
            {collection.counts.ready === 1 ? "" : "s"}, and every claim cites the page it came from.
          </Text>
          <div className="nx-kn-chips" data-testid="ask-suggestions">
            {suggestions.map((item) => (
              <button key={item} type="button" className="nx-kn-chip" onClick={() => onAsk(item)}>
                {item}
              </button>
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          compact
          title="Nothing to ask yet"
          hint="Questions are answered once at least one document has been read. Add files on the Documents tab."
        />
      )}
    </div>
  );
}
