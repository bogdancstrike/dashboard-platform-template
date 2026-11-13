import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { publicApi } from "@/api/recordsAnalytics";

import { GRANT_KEY, embeddingOrigin, failure, storedGrant, type State } from "./access";

/** Loading the shared dashboard, and unlocking it with a password when it asks for one. */
export function usePublicDashboard(token: string) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  const load = useCallback(
    async (grant: string | null) => {
      try {
        const data = await publicApi.view(token, grant, embeddingOrigin());
        setState({ kind: "ready", data });
        document.title = `${data.dashboard.name} · Nucleus`;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401 && error.details["reason"] === "password_required") {
          const meta = await publicApi.meta(token).catch(() => ({ name: "Shared dashboard" }));
          setState({ kind: "locked", name: meta.name });
        } else {
          setState(failure(error));
        }
      }
    },
    [token],
  );

  useEffect(() => {
    void load(storedGrant(token));
  }, [load, token]);

  const unlock = async () => {
    setUnlocking(true);
    try {
      const result = await publicApi.unlock(token, password);
      if (result.grant) {
        try {
          sessionStorage.setItem(GRANT_KEY(token), result.grant);
        } catch {
          /* a private window: the grant lives for this load only */
        }
      }
      await load(result.grant);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState((current) => (current.kind === "locked" ? { ...current, error: "That password is not right." } : current));
      } else {
        setState(failure(error));
      }
    } finally {
      setUnlocking(false);
    }
  };

  return { state, password, setPassword, unlocking, unlock };
}
