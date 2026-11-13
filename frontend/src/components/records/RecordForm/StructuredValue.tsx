import { Input, Typography } from "antd";
import { useState } from "react";

import { EditableField } from "./fields";

const { Text } = Typography;

/**
 * A structured field, edited as the JSON it is.
 *
 * Deliberately plain. A page that knows what the document *means* — the task
 * board's checklist, say — gives it a real control; this is the fallback for
 * every other declared JSON field, and it earns its place by being honest:
 * the value is shown as it is stored, and unparseable text is refused here
 * rather than sent to the server to be refused there.
 */
export function StructuredValue({
  field,
  value,
  onChange,
}: {
  field: EditableField;
  value: unknown;
  onChange?: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => (value == null ? "" : JSON.stringify(value, null, 2)));
  const [invalid, setInvalid] = useState(false);

  return (
    <>
      <Input.TextArea
        rows={5}
        aria-label={field.label}
        status={invalid ? "error" : undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim()) {
            setInvalid(false);
            onChange?.(null);
            return;
          }
          try {
            onChange?.(JSON.parse(next));
            setInvalid(false);
          } catch {
            // Left invalid rather than sent: the server would refuse it, and
            // a save that fails on syntax is a round trip nobody needed.
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <Text type="danger" style={{ fontSize: 12 }}>
          That is not valid JSON yet.
        </Text>
      )}
    </>
  );
}
