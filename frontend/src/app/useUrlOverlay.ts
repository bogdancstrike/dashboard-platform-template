/**
 * An overlay whose open state lives in the address (`?group=<id>`).
 *
 * Opening *pushes* an entry, so the browser's back — and the phone's back
 * gesture — closes it, and an overlay opened from inside another one (a log
 * line's sibling, say) is walked back one at a time. Closing goes back when
 * this page pushed the entry, and otherwise removes the parameter in place: a
 * pasted link with `?group=…` in it should close to the list, not leave the
 * page. The overlay itself carries `rootClassName={URL_OVERLAY}` so the
 * shell's generic overlay history does not count it a second time.
 */
import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

const MARK = "nuUrlOverlay";

export function useUrlOverlay(key: string) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const value = params.get(key);
  const pushed = Boolean((location.state as Record<string, unknown> | null)?.[MARK]);

  const open = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params);
      next.set(key, id);
      setParams(next, { state: { [MARK]: true } });
    },
    [key, params, setParams],
  );

  const close = useCallback(() => {
    if (pushed) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next, { replace: true });
  }, [key, params, pushed, navigate, setParams]);

  return { value, open, close };
}
