import { useSearchParams } from "react-router-dom";

/**
 * Page state kept in the address (§history): `places` are pushed, so back
 * returns to them; everything else is an adjustment and replaces.
 */
export function useUrlState(places: string[] = []) {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null | undefined>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === undefined || value === "") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: !Object.entries(changes).some(([key, value]) => places.includes(key) && value) },
    );
  return { params, set };
}
