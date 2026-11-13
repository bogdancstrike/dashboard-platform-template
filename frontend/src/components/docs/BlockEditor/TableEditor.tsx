import { Button, Input, Space, Switch, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";

import type { DocBlock } from "@/api/docs";

const { Text } = Typography;

export function TableEditor({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const rows = block.rows ?? [[""]];
  const width = Math.max(1, ...rows.map((row) => row.length));
  const set = (r: number, c: number, value: string) =>
    onChange({ ...block, rows: rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)) });
  return (
    <div className="nx-dc-table-edit">
      <table className="nx-dc-table">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {Array.from({ length: width }, (_, c) => (
                <td key={c}>
                  <Input
                    size="small"
                    variant="borderless"
                    aria-label={`Row ${r + 1}, column ${c + 1}`}
                    value={row[c] ?? ""}
                    onChange={(event) => set(r, c, event.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <Space wrap>
        <Button icon={<PlusOutlined />} onClick={() => onChange({ ...block, rows: [...rows, Array(width).fill("")] })}>
          Row
        </Button>
        <Button icon={<PlusOutlined />} onClick={() => onChange({ ...block, rows: rows.map((row) => [...row, ""]) })}>
          Column
        </Button>
        {rows.length > 1 && (
          <Button onClick={() => onChange({ ...block, rows: rows.slice(0, -1) })}>
            Remove last row
          </Button>
        )}
        {width > 1 && (
          <Button onClick={() => onChange({ ...block, rows: rows.map((row) => row.slice(0, width - 1)) })}>
            Remove last column
          </Button>
        )}
        <Space size={6}>
          <Switch size="small" checked={block.header !== false} onChange={(header) => onChange({ ...block, header })} aria-label="Header row" />
          <Text type="secondary">Header row</Text>
        </Space>
      </Space>
    </div>
  );
}
