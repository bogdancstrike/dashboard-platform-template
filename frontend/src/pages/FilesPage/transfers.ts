/** Where the reader is in the tree. `unfiled` is a real place, not an absence. */
export const UNFILED = "unfiled";

/** One transfer in flight, as the tray shows it. */
export interface Transfer {
  id: string;
  name: string;
  size: number;
  progress: number;
  state: "uploading" | "done" | "failed";
  error?: string;
}
