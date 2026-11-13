import { useEffect, useState } from "react";

/**
 * Whether the page has finished arriving.
 *
 * Entrance animations belong to *arriving* on a page. After a moment the page
 * is marked settled, so a filter, a tab or a refetch that re-mounts its panels
 * changes the content in place instead of replaying the entrance — which read
 * as the whole page reloading.
 */
export function useSettledPage(pathname: string): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), 1400);
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return settled;
}
