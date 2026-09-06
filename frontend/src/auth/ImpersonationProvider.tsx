import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { setImpersonation } from "@/api/client";
import { usersApi, type ImpersonationTarget } from "@/api/users";
import { STORAGE_KEYS } from "@/config";

/**
 * Acting as somebody else (§12).
 *
 * Three decisions, and each is about limiting the blast radius of a feature
 * whose entire purpose is to see what another person sees:
 *
 * * **The server decides.** Starting an impersonation is a request the API can
 *   refuse — not an administrator's account, not a suspended one, not somebody
 *   who outranks you — so the client never has to guess, and a refusal arrives
 *   in words before a single impersonated request is made.
 * * **`sessionStorage`, not `localStorage`.** It survives a reload, because
 *   losing it there would be baffling; it does not survive into a new tab or a
 *   new day, because an administrator who forgot they were impersonating is
 *   the failure mode this feature actually has.
 * * **Every cached answer is thrown away** on entering and leaving. The whole
 *   point is that the same request now returns something different; serving a
 *   cached page from the previous identity is the one thing that would make
 *   the feature lie.
 */
interface ImpersonationValue {
  target: ImpersonationTarget | null;
  start: (userId: string) => Promise<ImpersonationTarget>;
  stop: () => void;
}

const ImpersonationContext = createContext<ImpersonationValue>({
  target: null,
  start: () => Promise.reject(new Error("Impersonation is not available here.")),
  stop: () => {},
});

function readStored(): ImpersonationTarget | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEYS.impersonating);
    return raw ? (JSON.parse(raw) as ImpersonationTarget) : null;
  } catch {
    return null;
  }
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ImpersonationTarget | null>(() => {
    const stored = readStored();
    // Restore the header before the first request of this page load goes out,
    // rather than in an effect that runs after it.
    setImpersonation(stored?.id ?? null);
    return stored;
  });

  const remember = useCallback((next: ImpersonationTarget | null) => {
    setImpersonation(next?.id ?? null);
    setTarget(next);
    try {
      if (next) {
        window.sessionStorage.setItem(STORAGE_KEYS.impersonating, JSON.stringify(next));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEYS.impersonating);
      }
    } catch {
      /* storage disabled; the header still carries it for this page */
    }
  }, []);

  const start = useCallback(
    async (userId: string) => {
      // Asked *before* the header is set, so this request is made as the
      // administrator and is audited as theirs.
      const next = await usersApi.impersonate(userId);
      remember(next);
      await queryClient.invalidateQueries();
      return next;
    },
    [queryClient, remember],
  );

  const stop = useCallback(() => {
    remember(null);
    void queryClient.invalidateQueries();
  }, [queryClient, remember]);

  const value = useMemo<ImpersonationValue>(
    () => ({ target, start, stop }),
    [target, start, stop],
  );

  return (
    <ImpersonationContext.Provider value={value}>{children}</ImpersonationContext.Provider>
  );
}

export function useImpersonation(): ImpersonationValue {
  return useContext(ImpersonationContext);
}
