/**
 * The AntD theme, derived from `tokens.ts`.
 *
 * Nothing here invents a value. Every number and colour comes from the token
 * file, so re-theming the platform is one edit rather than a search for hex
 * codes across a hundred components.
 */

import { theme, type ThemeConfig } from "antd";

import { DENSITY, type Density } from "../tokens";
import { resolveAppearance, type Appearance } from "./appearance";
import { componentTokens } from "./componentTokens";
import { globalTokens } from "./globalTokens";

export { DARK_ACCENT, resolveAppearance, type Appearance } from "./appearance";
export { cssVariables } from "./cssVariables";

export function buildTheme(appearance: Appearance, density: Density): ThemeConfig {
  const mode = resolveAppearance(appearance);
  const scale = DENSITY[density];
  const dark = mode === "dark";
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: globalTokens(mode, scale),
    components: componentTokens(dark, scale),
  };
}
