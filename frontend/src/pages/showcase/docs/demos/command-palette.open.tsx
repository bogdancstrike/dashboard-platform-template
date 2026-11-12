import { Button, Typography } from "antd";

export default function CommandPaletteOpen() {
  return (
    <div className="nx-doc-row">
      <Button
        data-testid="open-palette"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
      >
        Open the palette
      </Button>
      <span className="nx-doc-muted">
        Or press <Typography.Text keyboard>⌘K</Typography.Text> / <Typography.Text keyboard>Ctrl K</Typography.Text> anywhere.
      </span>
    </div>
  );
}
