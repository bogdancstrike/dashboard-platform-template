import { NxIcon } from "@/components/NxIcon";

interface CanvasControlsProps {
  zoom: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  /** Present when a connection is selected and may be removed. */
  onUnlink?: () => void;
}

/** Zoom, fit, and removing the selected connection. */
export function CanvasControls({ zoom, onZoom, onFit, onUnlink }: CanvasControlsProps) {
  return (
    <div className="nx-wf-controls" onPointerDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label="Zoom in" onClick={() => onZoom(1.2)}>+</button>
      <button type="button" aria-label="Zoom out" onClick={() => onZoom(1 / 1.2)}>−</button>
      <button type="button" aria-label="Fit to view" onClick={onFit} data-testid="canvas-fit">
        <NxIcon name="expandAll" size={14} />
      </button>
      <span className="nx-wf-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
      {onUnlink && (
        <button type="button" className="nx-wf-unlink" data-testid="delete-edge" onClick={onUnlink}>
          Remove connection
        </button>
      )}
    </div>
  );
}
