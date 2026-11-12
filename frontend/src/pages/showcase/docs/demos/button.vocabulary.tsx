import { Button } from "antd";
import { DeleteOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";

export default function ButtonVocabulary() {
  return (
    <div className="nx-doc-row">
      {/* Primary: the one thing this surface is for. */}
      <Button type="primary" icon={<PlusOutlined />}>
        Create a report
      </Button>
      {/* Secondary: other verbs beside it. */}
      <Button>Export</Button>
      {/* Quiet: repeated per row, or a glyph in a toolbar. */}
      <Button type="text" icon={<SearchOutlined />} aria-label="Search this list" />
      {/* Destructive: with a confirm behind it. */}
      <Button danger icon={<DeleteOutlined />}>
        Delete
      </Button>
    </div>
  );
}
