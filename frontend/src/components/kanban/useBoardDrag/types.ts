/** The drag engine's shapes: where a card would land, the drag in progress, and what a board tells the engine. */

export interface DropTarget {
  lane: string;
  /** Position in the lane, counted without the carried card. */
  index: number;
}

export interface BoardDrag {
  id: string;
  from: string;
  /** Where the card started, counted the same way as `over.index`. */
  origin: number;
  over: DropTarget;
  mode: "pointer" | "keyboard";
  /** The lifted card's height, so the gap it leaves is its own size. */
  height: number;
}

export interface BoardDragOptions {
  enabled: boolean;
  /** Lane ids, left to right. */
  lanes: string[];
  /** The card ids in a lane, top to bottom, as drawn. */
  items: (lane: string) => string[];
  /** Where a card would land given where the pointer is; defaults to the pointer's index. */
  resolveIndex?: (lane: string, id: string, pointerIndex: number, from: string) => number;
  /** The move itself. Not called when the card is put back where it was. */
  onDrop: (id: string, from: string, to: DropTarget) => void;
  /** "TSK-00012 Fix the importer", for announcements. */
  describe: (id: string) => string;
  laneName: (lane: string) => string;
}
