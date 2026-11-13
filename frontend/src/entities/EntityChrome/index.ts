/**
 * The parts every entity page keeps in common (§7).
 *
 * Not a layout — a layout is what made the six pages indistinguishable in the
 * first place. These are the three pieces that must behave identically
 * everywhere because they are about the *contract* rather than the subject:
 * how a dataset says how many rows it has and where to export them, how a
 * facet becomes a filter, and how a declared metric is rendered.
 *
 * Everything else — lanes, timelines, gauges, ledgers — belongs to the page
 * that knows what it is looking at.
 */

export { EntityHeader } from "./EntityHeader";
export { EntityFilters } from "./EntityFilters";
export { MetricStrip } from "./MetricStrip";
export { formatMetric } from "./formatMetric";
export { EntityEmpty, EntityError } from "./EntityStates";
