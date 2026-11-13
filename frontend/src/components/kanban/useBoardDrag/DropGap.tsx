/** The gap a carried card will land in. */
export function DropGap({ height, label = "Drop here" }: { height: number; label?: string }) {
  return (
    <li
      className="nx-drop-gap"
      data-drop-slot
      data-testid="drop-slot"
      aria-hidden
      style={{ height: Math.max(48, Math.round(height)) }}
    >
      <span>{label}</span>
    </li>
  );
}
