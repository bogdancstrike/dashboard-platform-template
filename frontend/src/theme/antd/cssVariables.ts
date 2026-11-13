import { DENSITY, DENSITY_ZOOM, FONT, RADIUS, SEMANTIC, SEMANTIC_INK, type Density } from "../tokens";

import { resolveAppearance, type Appearance } from "./appearance";
import { MODE_VARIABLES } from "./modeVariables";

/**
 * The tokens the stylesheet needs as CSS custom properties.
 *
 * Anything styled outside an AntD component — the shell, the command palette,
 * a chart container — reads these, so it cannot drift from the component theme.
 */
export function cssVariables(appearance: Appearance, density: Density): Record<string, string> {
  const mode = resolveAppearance(appearance);
  const scale = DENSITY[density];

  return {
    ...MODE_VARIABLES[mode],
    "--nu-success": SEMANTIC.success,
    "--nu-warning": SEMANTIC.warning,
    "--nu-danger": SEMANTIC.danger,
    "--nu-info": SEMANTIC.info,
    // The readable half of the same four meanings, for text rather than fills
    // — see `SEMANTIC_INK`. Published as variables because the pages that need
    // them are styled in CSS, and a component resolving the theme in
    // JavaScript to pick a hex is a second place the mode can be got wrong.
    "--nu-success-ink": SEMANTIC_INK[mode].success,
    "--nu-warning-ink": SEMANTIC_INK[mode].warning,
    "--nu-danger-ink": SEMANTIC_INK[mode].danger,
    "--nu-info-ink": SEMANTIC_INK[mode].info,
    "--nu-zoom": String(DENSITY_ZOOM[density]),
    "--nu-row-height": `${scale.rowHeight}px`,
    "--nu-control-height": `${scale.controlHeight}px`,
    "--nu-font-size": `${scale.fontSize}px`,
    "--nu-padding": `${scale.padding}px`,
    "--nu-font": FONT.family,
    "--nu-font-mono": FONT.mono,
    // The radii AntD already applies to its own components, published so a
    // hand-built surface (the notification panel, a popover of our own) rounds
    // to the same corner rather than to whichever value somebody typed.
    "--nu-radius-control": `${RADIUS.control}px`,
    "--nu-radius-card": `${RADIUS.card}px`,
    "--nu-radius-modal": `${RADIUS.modal}px`,
  };
}
