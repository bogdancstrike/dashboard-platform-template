import { Navigate, Route } from "react-router-dom";

import { lazyPage } from "./lazyPage";
import { SavedSearchLink } from "./RouteHelpers";

const DataExplorerPage = lazyPage(() => import("@/pages/DataExplorerPage"));
const GlobalSearchPage = lazyPage(() => import("@/pages/GlobalSearchPage"));
const RelationshipExplorerPage = lazyPage(() => import("@/pages/RelationshipExplorerPage"));
const DataCatalogPage = lazyPage(() => import("@/pages/DataCatalogPage"));
const FavoritesPage = lazyPage(() => import("@/pages/FavoritesPage"));

/** Find: the explorer, search, relationships, the catalogue and favourites. */
export const findRoutes = (
  <>
    <Route path="explore" element={<DataExplorerPage />} />
    <Route path="find/global" element={<GlobalSearchPage />} />
    <Route path="find/relationships" element={<RelationshipExplorerPage />} />
    <Route path="find/catalog" element={<DataCatalogPage />} />
    {/* Advanced and saved searches now live in Data Explorer. Preserve the
        original addresses because search URLs are routinely bookmarked. */}
    <Route path="search" element={<Navigate to="/explore" replace />} />
    <Route path="search/saved" element={<Navigate to="/explore?panel=saved" replace />} />
    {/* The id goes with it (§5, §38). */}
    <Route path="search/saved/:searchId" element={<SavedSearchLink />} />
    <Route path="favorites" element={<FavoritesPage />} />
  </>
);
