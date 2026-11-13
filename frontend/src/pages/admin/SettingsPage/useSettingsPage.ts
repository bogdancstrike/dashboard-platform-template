import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";

import { settingsApi } from "@/api/settings";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { applyParamChanges } from "@/hooks/useUrlState";
import { apiMessageToast } from "@/lib/errors";
import { queryKeys } from "@/lib/queryKeys";

/** The settings, the category and search in the address, and writing or resetting one. */
export function useSettingsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [term, setTerm] = useState(params.get("q") ?? "");
  const debounced = useDebouncedValue(term, 250);

  const category = params.get("category") ?? "";

  const set = (changes: Record<string, string | null>, replace = true) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      { replace },
    );

  const config = useQuery({
    queryKey: queryKeys.adminSettings(category, debounced),
    queryFn: ({ signal }) =>
      settingsApi.all({ ...(category ? { category } : {}), ...(debounced ? { q: debounced } : {}) }, signal),
  });

  const write = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      settingsApi.set(key, value),
    onSuccess: async (saved) => {
      message.success(`${saved.label} saved`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings() });
    },
    onError: apiMessageToast(message, "That change was refused."),
  });

  const reset = useMutation({
    mutationFn: (key: string) => settingsApi.reset(key),
    onSuccess: async (saved) => {
      message.success(`${saved.label} is back at its default`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminSettings() });
    },
    onError: apiMessageToast(message, "That reset was refused."),
  });

  usePageCommands("admin-settings", [
    {
      id: "settings.changed",
      label: "Show the settings that differ from the defaults",
      keywords: "settings changed drift default",
      run: () => set({ q: null, category: null }),
    },
    {
      id: "settings.reload",
      label: "Reload the configuration",
      keywords: "refresh reload settings current values",
      run: () => void config.refetch(),
    },
    {
      id: "settings.flags",
      label: "Switch a feature on or off instead",
      keywords: "flags features rollout toggle experiment",
      run: () => navigate("/admin/flags"),
    },
  ]);

  return { term, setTerm, category, set, config, write, reset };
}
