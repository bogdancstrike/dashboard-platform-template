/**
 * The route table, one module per area of the navigation (§1).
 *
 * Each module declares its pages with `lazyPage` and exports a fragment of
 * `<Route>` elements; `App` mounts them under the shell in this order. The
 * paths stay literal string props so the source-reading tests (routes,
 * tours, gallery, a11y) can enumerate them without rendering the router.
 */
export { accountRoutes, systemRoutes } from "./accountRoutes";
export { adminRoutes } from "./adminRoutes";
export { analyseRoutes } from "./analyseRoutes";
export { findRoutes } from "./findRoutes";
export { overviewRoutes } from "./overviewRoutes";
export { recordRoutes } from "./recordRoutes";
export { workRoutes } from "./workRoutes";
