/**
 * One region of a layout's wireframe.
 *
 * A gallery of *names* asks a reader to imagine the shape; a gallery with the
 * shape in it does not. Deliberately a structure rather than a picture: an
 * SVG or a screenshot is a second copy that drifts from the page it claims to
 * describe, and it cannot be themed, translated or read aloud. Twelve columns,
 * because that is the grid the product is built on.
 */
export interface Region {
  label: string;
  /** Columns of twelve. */
  span: number;
  /** Rows tall, for a region that runs down the side of others. */
  rows?: number;
  /** The one region that carries the answer, drawn with weight. */
  primary?: boolean;
}

/** One layout the template offers, with what it is for and what it costs. */
export interface PageLayout {
  key: string;
  name: string;
  /** What shape the reader sees. One sentence. */
  shape: string;
  /** The shape itself, as regions — so nobody has to imagine it. */
  wireframe: Region[][];
  /** The question this layout is the right answer to. */
  when: string;
  /** When it is the wrong answer — the half a gallery usually omits. */
  unless: string;
  /**
   * What it is built from.
   *
   * The question after "which shape" is always "what do I need" — and a
   * gallery that answers the first and not the second has stopped one step
   * short of being useful.
   */
  pieces: string[];
  /**
   * What it keeps in the address (§69).
   *
   * Every layout here is linkable and back-button-able, and *which* state is
   * in the URL is the decision somebody copying the layout has to make on
   * their own page.
   */
  url: string;
  /** The routes built this way. Asserted complete against the router. */
  routes: string[];
}
