import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BgColorsOutlined, ColumnHeightOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";

import { searchApi } from "@/api/search";
import { FEATURES, useFeatures } from "@/settings/features";
import { type PageCommand } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useAppearance } from "@/theme/AppearanceProvider";
import type { Density } from "@/theme/tokens";
import { queryKeys } from "@/lib/queryKeys";

import { MIN_RECORD_TERM } from "./palette";

/**
 * Matching records, from the server, while the palette is open.
 *
 * Debounced and gated on two characters: one letter matches most of the
 * database and the request would be thrown away by the next keystroke
 * anyway. Disabled while the palette is closed, so a page with the provider
 * mounted costs nothing.
 */
export function useRecordHits(open: boolean, query: string) {
  const features = useFeatures();
  const term = useDebouncedValue(query.trim(), 200);
  const hits = useQuery({
    queryKey: queryKeys.paletteSearch(term),
    queryFn: ({ signal }) => searchApi.global(term, signal),
    enabled: open && term.length >= MIN_RECORD_TERM && features(FEATURES.globalSearch),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
  const records = useMemo(
    () =>
      (hits.data?.groups ?? []).flatMap((group) =>
        group.items.map((hit) => ({ hit, path: group.path, dataset: group.label })),
      ),
    [hits.data],
  );
  return { records, hits, term };
}

/** Theme and density, from anywhere: the appearance commands the palette always offers. */
export function useSettingsCommands(): PageCommand[] {
  const { appearance, mode, density, setAppearance, setDensity } = useAppearance();
  return useMemo(
    () => [
      {
        id: "theme",
        label: mode === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
        icon: mode === "dark" ? <SunOutlined /> : <MoonOutlined />,
        keywords: "appearance dark light colour color theme",
        run: () => setAppearance(mode === "dark" ? "light" : "dark"),
      },
      {
        id: "theme-system",
        label: "Follow the system theme",
        icon: <BgColorsOutlined />,
        keywords: "appearance auto os system",
        run: () => setAppearance("system"),
      },
      ...(["compact", "middle", "comfortable"] as Density[])
        .filter((option) => option !== density)
        .map((option) => ({
          id: `density-${option}`,
          label: `Use ${option} density`,
          icon: <ColumnHeightOutlined />,
          keywords: "density rows spacing size table",
          run: () => setDensity(option),
        })),
    ],
    [mode, density, setAppearance, setDensity, appearance],
  );
}
