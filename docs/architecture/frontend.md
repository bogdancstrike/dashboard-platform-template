# Frontend layout

How `frontend/src` is organised, what goes where, and the rules that keep it
that way. The overview of the whole system is [`../architecture.md`](../architecture.md).

## Folders

| Folder | Holds | Rule of thumb |
| --- | --- | --- |
| `app/` | `App.tsx`'s pieces: `routes/` (the route table, one module per navigation area), `shell/` (sidebar, rail, headers, phone tabs and sheet, user menu), `navigation/` (the menu as data, its types, the path helpers), `history.tsx`, `tours.ts`, `ErrorBoundary` | Anything that exists once per application. |
| `api/` | One module per API surface, typed requests and responses. | Nothing else calls `fetch` (the file preview, the developer console and its snippets are the documented exceptions). |
| `components/` | Shared UI. Cross-feature pieces sit in named folders (`layout/`, `feedback/`, `listing/`, `icons/`, `charts/`); a feature folder (`kanban/`, `recordsAnalytics/`, …) holds pieces used by that feature's pages. | A component used by one page only lives next to its feature, not here at the top level. |
| `entities/` | The contract the six record lists share: URL state, chrome, saved views. | |
| `hooks/` | Generic hooks with no feature knowledge: `useUrlState`, `useUrlOverlay`, `useDebouncedValue`, `useDiscardGuard`, `useEscapeToClose`, … | A hook that renders a feature's UI (`components/records/useBulk.tsx`) or knows a feature's data stays with that feature. |
| `lib/` | Pure helpers: `queryKeys.ts` (query keys and stale times), `errors.ts` (failure wording and toasts), formats, time, grids. | Helpers, not screens: no page or panel lives here. |
| `pages/` | One module per routed page: layout and the page's own decisions. Sub-folders group an area (`admin/`, `decisions/`, `entities/`, `recordsAnalytics/`, `showcase/`, `work/`). | |
| `styles/` | `index.css` is the single entry `main.tsx` imports. It pulls in `global.css` (`global/*.css`, the old `index.css` split by concern), `glass.css` (`glass/*.css`: ground, shell, the antd skin) and the four first-paint area sheets. Other area sheets are imported by the components that use them. | Order in the entries is cascade order. |
| `theme/` | Tokens and the builders that turn them into AntD and ECharts themes. | Colours come from tokens, never a hex at a call site. |
| `test/` | MSW handlers, render helpers, fixtures and the source-reading helpers (`routerSource()`, `stylesheetSource()`). | Never imported by shipped code (`test/isolation.test.ts`). |

## Naming

- **Components** are PascalCase files named after the component (`PanelHeader.tsx`).
- **Hooks and helpers** are camelCase (`useUrlState.ts`, `queryKeys.ts`).
- **Stylesheets** are kebab-case (`records-analytics.css`, `glass/shell-header.css`).
- **Showcase demos** (`pages/showcase/docs/demos/*.tsx`) keep their dotted kebab-case names (`status-tag.tones.tsx`): they are content keyed by entry and demo id, not modules.
- **Two words that are not synonyms:** *analysis* is the chart question builder (`components/analysis/`, used by the chart builder and explorer); *records analytics* is contracts, customer health, metric watches, the editable grid and version history (`components/recordsAnalytics/`, `pages/recordsAnalytics/`, `api/recordsAnalytics.ts`, `styles/records-analytics.css`). The Analytics page (`pages/AnalyticsPage.tsx`) is neither.

## Shared building blocks

Reach for these before writing the same thing again:

| Need | Use |
| --- | --- |
| A React Query key | `queryKeys.<family>(...parts)` from `lib/queryKeys.ts`; invalidate the family with `queryKeys.<family>()`. Fresh-for durations: `STALE.short / minute / long / hour`. |
| State in the address | `useUrlState(places)` (push for places, replace for adjustments), or `applyParamChanges(current, changes)` inside your own `setParams`. |
| A drawer or modal whose open state is in the address | `useUrlOverlay(key)` from `hooks/`, with `rootClassName={URL_OVERLAY}` from `app/history` on the overlay. |
| A mutation's failure toast | `onError: errorToast(message, { action: "export" })` or `apiMessageToast(message, fallback)` from `lib/errors.ts`. |
| A failed read | `FailureAlert` for the whole alert; `apiErrorDetails(error)` for the description under an alert that keeps its own headline. |
| A glass panel's heading row | `components/layout/PanelHeader`. |
| An icon | `NxIcon` (the design's set); the area sets in `components/icons/` (`KnIcon`, `TdIcon`, `FdIcon`, `PlanIcon`, `AstIcon`, `CoIcon`, `ChartKindIcon`), all drawn by `StrokeIcon`. A new glyph goes into the set it belongs to. |
| A routed page | Add it to the matching `app/routes/<area>Routes.tsx` with `lazyPage(() => import(...))` and a literal `path="…"` (the source-reading tests enumerate routes from it), and a menu entry in `app/navigation/navGroups.tsx`. |

## Size limits

`npm run lint` enforces them (see `eslint.config.js`):

- a module stays within **200 lines** of code, a test file within **400** (blank and comment lines are not counted);
- in files within the limit, functions over 80 lines and complexity over 15 are reported as warnings;
- `eslint.oversized.json` lists the files that were over the limit when the rule arrived. Splitting one removes its entry; nothing is ever added. The data tables `app/tours.ts` and `pages/showcase/docs/registry.ts`, and the fixtures in `src/test/`, are exempt by design.

When a file outgrows its limit, split by responsibility: a page becomes `index.tsx` (layout) + `use<Name>Page.ts` (queries and URL state) + parts; a component family becomes a folder with one file per piece. Move code verbatim first and improve it second.
