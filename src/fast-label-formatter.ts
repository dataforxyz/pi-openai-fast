import { fastColorToAnsi, resolveFastColorValue, type FastColorValue } from "./fast-colors.ts";

export interface FastLabelFormatOptions {
  active: boolean;
  darkFastColor?: FastColorValue;
  lightFastColor?: FastColorValue;
  footerVars?: Record<string, string>;
  isLightTheme?: boolean;
  colorMode?: "truecolor" | "256color";
  fallbackDarkColor?: FastColorValue;
  fallbackLightColor?: FastColorValue;
}

export const DEFAULT_DARK_FAST_COLOR = "#ff50be";
export const DEFAULT_LIGHT_FAST_COLOR = "#d20000";
const ANSI_RESET_FOREGROUND = "\x1b[39m";

/**
 * Formatting seam for the inline Fast Mode footer label.
 */
export class FastLabelFormatter {
  private resolveColor(options: FastLabelFormatOptions): FastColorValue {
    const isLightTheme = options.isLightTheme === true;
    const fallbackColor = isLightTheme
      ? options.fallbackLightColor ?? DEFAULT_LIGHT_FAST_COLOR
      : options.fallbackDarkColor ?? DEFAULT_DARK_FAST_COLOR;
    const colorToken = isLightTheme
      ? options.lightFastColor ?? fallbackColor
      : options.darkFastColor ?? fallbackColor;

    const resolved = resolveFastColorValue(colorToken, options.footerVars ?? {});
    return resolved ?? fallbackColor;
  }

  formatFastLabel(options: FastLabelFormatOptions): string {
    if (!options.active) {
      return "fast";
    }

    const colorMode: "truecolor" | "256color" = options.colorMode === "truecolor" ? "truecolor" : "256color";
    const color = this.resolveColor(options);
    const ansi = fastColorToAnsi(color, { mode: colorMode });
    return `${ansi}fast${ANSI_RESET_FOREGROUND}`;
  }

  formatModelLabel(modelName: string, options: FastLabelFormatOptions): string {
    if (!options.active) {
      return modelName;
    }

    return `${modelName} ${this.formatFastLabel(options)}`;
  }
}
