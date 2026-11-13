import { Grid } from "antd";

export type ShellDevice = "pc" | "tablet" | "phone";

/**
 * Which of the three shell layouts fits this width.
 *
 * Before the first measurement every breakpoint is undefined; that is treated
 * as the desktop so the first paint is not a phone layout on a laptop.
 */
export function useShellDevice(): ShellDevice {
  const screens = Grid.useBreakpoint();
  const measured = screens.xl !== undefined || screens.md !== undefined;
  return !measured || screens.xl ? "pc" : screens.md ? "tablet" : "phone";
}
