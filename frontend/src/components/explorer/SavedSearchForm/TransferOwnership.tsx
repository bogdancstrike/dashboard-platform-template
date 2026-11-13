import { Divider, Popconfirm, Space, Typography } from "antd";

import type { SavedSearch } from "@/api/explorer";
import { PeoplePicker } from "@/components/PeoplePicker";

const { Text } = Typography;

/** Handing a saved search to somebody else — permanent, so it asks first. */
export function TransferOwnership({
  search,
  heir,
  onHeir,
  busy,
  onTransfer,
}: {
  search: SavedSearch;
  heir: string[];
  onHeir: (ids: string[]) => void;
  busy: boolean;
  onTransfer: (ownerId: string) => void;
}) {
  return (
    <>
      <Divider plain>Ownership</Divider>
      <Space direction="vertical" style={{ width: "100%" }} size={8}>
        <Text type="secondary">
          Owned by {search.owner.name}. Handing it over is permanent: you keep read
          access and lose the ability to change it.
        </Text>
        <PeoplePicker
          aria-label="Transfer ownership to"
          data-testid="saved-search-heir"
          multiple={false}
          value={heir}
          exclude={[search.owner.id]}
          placeholder="Transfer to…"
          onChange={(ids) => onHeir(ids)}
        />
        <Popconfirm
          title="Hand over this saved search?"
          description="You will keep read access and lose the ability to change it."
          okText="Transfer"
          disabled={heir.length === 0}
          onConfirm={() => heir[0] && onTransfer(heir[0])}
        >
          <button
            type="button"
            className="nu-link-button nu-danger-link"
            disabled={heir.length === 0 || busy}
          >
            Transfer ownership
          </button>
        </Popconfirm>
      </Space>
    </>
  );
}
