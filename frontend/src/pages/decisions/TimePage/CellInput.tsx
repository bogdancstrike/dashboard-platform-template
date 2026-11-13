import { useEffect, useState } from "react";
import { Tooltip } from "antd";

import { decimalHours, hours, parseDuration } from "@/api/time";

/** One cell of the grid: hours as typed, saved on blur or Enter. */
export function CellInput({
  minutes, fixed, disabled, weekend, label, onCommit,
}: {
  minutes: number; fixed: number; disabled: boolean; weekend: boolean; label: string;
  onCommit: (minutes: number) => void;
}) {
  const [text, setText] = useState(decimalHours(minutes));
  useEffect(() => setText(decimalHours(minutes)), [minutes]);
  const commit = () => {
    const parsed = parseDuration(text);
    if (parsed === null) {
      setText(decimalHours(minutes));
      return;
    }
    if (parsed !== minutes) onCommit(parsed);
  };
  return (
    <Tooltip title={fixed ? `${hours(fixed)} from timers and typed entries` : ""}>
      <input
        className={`nx-td-cell${weekend ? " is-weekend" : ""}`}
        value={text}
        disabled={disabled}
        inputMode="decimal"
        aria-label={label}
        placeholder={disabled ? "" : "–"}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          if (event.key === "Escape") setText(decimalHours(minutes));
        }}
      />
    </Tooltip>
  );
}
