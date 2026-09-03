import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { meApi, type CurrentUser } from "@/api/me";
import { useAppearance } from "@/theme/AppearanceProvider";
import { signOut } from "./keycloak";

interface AuthContextValue {
  profile: CurrentUser | null;
  loading: boolean;
  error: Error | null;
  can: (permission?: string) => boolean;
  refresh: () => Promise<unknown>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { appearance, density, setAppearance, setDensity } = useAppearance();
  const remoteApplied = useRef(false);
  const lastSaved = useRef({ theme: appearance, density });

  const query = useQuery({
    queryKey: ["me"],
    queryFn: ({ signal }) => meApi.get(signal),
    staleTime: 0,
  });

  const preferenceMutation = useMutation({
    mutationFn: (preferences: Parameters<typeof meApi.updatePreferences>[0]) =>
      meApi.updatePreferences(preferences),
    onSuccess: ({ preferences }) => {
      queryClient.setQueryData<CurrentUser>(["me"], (current) =>
        current ? { ...current, preferences } : current,
      );
    },
  });

  // localStorage painted the first frame without a flash. Once identity
  // resolves, the user's durable server-side preference wins.
  useEffect(() => {
    if (!query.data || remoteApplied.current) return;
    const remote = query.data.preferences.appearance;
    lastSaved.current = { theme: remote.theme, density: remote.density };
    setAppearance(remote.theme);
    setDensity(remote.density);
    remoteApplied.current = true;
  }, [query.data, setAppearance, setDensity]);

  // Persist later UI changes, but never write the hydration values back.
  useEffect(() => {
    if (!remoteApplied.current) return;
    if (lastSaved.current.theme === appearance && lastSaved.current.density === density) return;
    const timer = window.setTimeout(() => {
      lastSaved.current = { theme: appearance, density };
      preferenceMutation.mutate({ appearance: { theme: appearance, density } });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [appearance, density, preferenceMutation]);

  const permissionSet = useMemo(
    () => new Set(query.data?.permissions ?? []),
    [query.data?.permissions],
  );
  const can = useCallback(
    (permission?: string) => !permission || permissionSet.has(permission),
    [permissionSet],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      profile: query.data ?? null,
      loading: query.isLoading,
      error: query.error instanceof Error ? query.error : null,
      can,
      refresh: query.refetch,
      signOut,
    }),
    [query.data, query.isLoading, query.error, query.refetch, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function usePermission(permission: string): boolean {
  return useAuth().can(permission);
}
