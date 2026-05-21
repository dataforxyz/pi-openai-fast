import type { FastConfig, FastSettingsUpdate, FooterMode } from "./fast-config-store.ts";
import { normalizeFastColorValue, resolveFastColorValue, type FastColorValue } from "./fast-colors.ts";
import type { FastStateEngine, FastStateTransition } from "./fast-state-engine.ts";
import type { FastModelIdentity } from "./supported-models.ts";

export const FAST_SETTINGS_TITLE = "OpenAI Fast Settings";
export const FAST_SETTINGS_SAVED_MESSAGE = "OpenAI Fast Settings saved.";
export const FAST_SETTINGS_SAVE_FAILED_MESSAGE =
  "Could not save OpenAI Fast Settings; the config update was not saved.";
export const FAST_SETTINGS_INVALID_COLOR_MESSAGE =
  "Fast color value must be a six-digit hex value, 256-color index, or variable reference.";

const SETTING_OPTIONS = [
  "Fast Mode",
  "Persist State",
  "Footer Mode",
  "Dark Fast Color",
  "Light Fast Color",
] as const;
const BOOLEAN_OPTIONS = ["true", "false"] as const;
const FOOTER_MODE_OPTIONS = ["replace", "status", "off"] as const;

type SettingOption = (typeof SETTING_OPTIONS)[number];
type BooleanOption = (typeof BOOLEAN_OPTIONS)[number];

export interface FastSettingsUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  input?(title: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface FastSettingsConfigStore {
  load(cwd: string): Promise<FastConfig>;
  writeSettings(cwd: string, update: FastSettingsUpdate): Promise<boolean>;
}

export interface FastSettingsFooterFeedback {
  notifyForTransition(transition: FastStateTransition, notifier: FastSettingsUi | undefined): void;
  syncFooterMode?(mode: FooterMode, ui: FastSettingsUi | undefined): void;
}

export interface FastSettingsDependencies {
  cwd: string;
  configStore: FastSettingsConfigStore;
  stateEngine: FastStateEngine;
  footerFeedback: FastSettingsFooterFeedback;
  ui: FastSettingsUi;
  currentModel?: FastModelIdentity | undefined;
  initialConfig?: FastConfig | undefined;
}

export type FastSettingsResult =
  | { kind: "cancelled"; config: FastConfig }
  | { kind: "unchanged"; config: FastConfig }
  | { kind: "saved"; config: FastConfig; update: FastSettingsUpdate }
  | { kind: "failed"; config: FastConfig; update: FastSettingsUpdate };

type FastSettingsPromptResult =
  | { kind: "cancelled" }
  | { kind: "update"; update: FastSettingsUpdate };

function isSettingOption(value: string | undefined): value is SettingOption {
  return SETTING_OPTIONS.some((option) => option === value);
}

function isBooleanOption(value: string | undefined): value is BooleanOption {
  return BOOLEAN_OPTIONS.some((option) => option === value);
}

function isFooterModeOption(value: string | undefined): value is FooterMode {
  return FOOTER_MODE_OPTIONS.some((option) => option === value);
}

function booleanFromOption(option: BooleanOption): boolean {
  return option === "true";
}

function isEmptyUpdate(update: FastSettingsUpdate): boolean {
  return (
    update.persistState === undefined &&
    update.desiredActive === undefined &&
    update.footerMode === undefined &&
    update.darkFastColor === undefined &&
    update.lightFastColor === undefined
  );
}

function configWithSettingsUpdate(config: FastConfig, update: FastSettingsUpdate): FastConfig {
  return {
    ...config,
    persistState: update.persistState ?? config.persistState,
    desiredActive: update.desiredActive ?? config.desiredActive,
    supportedModels: [...config.supportedModels],
    footer: {
      ...config.footer,
      mode: update.footerMode ?? config.footer.mode,
      vars: { ...config.footer.vars },
      darkFastColor: update.darkFastColor ?? config.footer.darkFastColor,
      lightFastColor: update.lightFastColor ?? config.footer.lightFastColor,
    },
  };
}

async function promptForBooleanSetting(
  ui: FastSettingsUi,
  title: string,
  currentValue: boolean,
  field: "persistState" | "desiredActive",
): Promise<FastSettingsPromptResult> {
  const selected = await ui.select(title, [...BOOLEAN_OPTIONS]);

  if (!isBooleanOption(selected)) {
    return { kind: "cancelled" };
  }

  const nextValue = booleanFromOption(selected);
  return {
    kind: "update",
    update: nextValue === currentValue ? {} : { [field]: nextValue },
  };
}

function parseColorSetting(input: string | undefined, vars: Record<string, string>): FastColorValue | undefined {
  if (input === undefined) {
    return undefined;
  }

  const normalized = normalizeFastColorValue(input);
  if (normalized === undefined) {
    return undefined;
  }

  if (normalized === "") {
    return normalized;
  }

  if (typeof normalized === "string" && !/^#[0-9a-fA-F]{6}$/.test(normalized) && !/^\d+$/.test(normalized)) {
    const resolved = resolveFastColorValue(normalized, vars);
    if (resolved === undefined) {
      return undefined;
    }
  }

  return normalized;
}

async function promptForFooterColorSetting(
  ui: FastSettingsUi,
  title: string,
  currentColor: string | number,
  field: "darkFastColor" | "lightFastColor",
  vars: Record<string, string>,
): Promise<FastSettingsPromptResult> {
  if (typeof ui.input !== "function") {
    return { kind: "cancelled" };
  }

  const response = await ui.input(title, `${currentColor}`);
  const normalized = parseColorSetting(response, vars);

  if (response === undefined) {
    return { kind: "cancelled" };
  }

  if (normalized === undefined) {
    ui.notify(FAST_SETTINGS_INVALID_COLOR_MESSAGE, "warning");
    return { kind: "cancelled" };
  }

  if (normalized === currentColor) {
    return { kind: "update", update: {} };
  }

  return { kind: "update", update: { [field]: normalized } as FastSettingsUpdate };
}

async function promptForFooterModeSetting(
  ui: FastSettingsUi,
  currentMode: FooterMode,
): Promise<FastSettingsPromptResult> {
  const selected = await ui.select("Footer Mode", [...FOOTER_MODE_OPTIONS]);

  if (!isFooterModeOption(selected)) {
    return { kind: "cancelled" };
  }

  return {
    kind: "update",
    update: selected === currentMode ? {} : { footerMode: selected },
  };
}

export async function collectFastSettingsUpdate(
  ui: FastSettingsUi,
  config: FastConfig,
): Promise<FastSettingsPromptResult> {
  const selectedSetting = await ui.select(FAST_SETTINGS_TITLE, [...SETTING_OPTIONS]);

  if (!isSettingOption(selectedSetting)) {
    return { kind: "cancelled" };
  }

  if (selectedSetting === "Fast Mode") {
    return await promptForBooleanSetting(ui, "Fast Mode", config.desiredActive, "desiredActive");
  }

  if (selectedSetting === "Persist State") {
    return await promptForBooleanSetting(ui, "Persist State", config.persistState, "persistState");
  }

  if (selectedSetting === "Footer Mode") {
    return await promptForFooterModeSetting(ui, config.footer.mode);
  }

  if (selectedSetting === "Dark Fast Color") {
    return await promptForFooterColorSetting(
      ui,
      "Dark Fast Color",
      config.footer.darkFastColor,
      "darkFastColor",
      config.footer.vars,
    );
  }

  return await promptForFooterColorSetting(
    ui,
    "Light Fast Color",
    config.footer.lightFastColor,
    "lightFastColor",
    config.footer.vars,
  );
}

export async function saveFastSettingsUpdate(
  dependencies: FastSettingsDependencies,
  config: FastConfig,
  update: FastSettingsUpdate,
): Promise<FastSettingsResult> {
  if (isEmptyUpdate(update)) {
    return { kind: "unchanged", config };
  }

  const saved = await dependencies.configStore.writeSettings(dependencies.cwd, update);

  if (!saved) {
    dependencies.ui.notify(FAST_SETTINGS_SAVE_FAILED_MESSAGE, "warning");
    return { kind: "failed", config, update };
  }

  const nextConfig = configWithSettingsUpdate(config, update);

  if (update.desiredActive !== undefined) {
    const transition = dependencies.stateEngine.transition({
      desiredActive: update.desiredActive,
      currentModel: dependencies.currentModel,
    });
    dependencies.footerFeedback.notifyForTransition(transition, dependencies.ui);
  }

  if (
    update.footerMode !== undefined ||
    update.darkFastColor !== undefined ||
    update.lightFastColor !== undefined
  ) {
    dependencies.footerFeedback.syncFooterMode?.(update.footerMode ?? config.footer.mode, dependencies.ui);
  }

  dependencies.ui.notify(FAST_SETTINGS_SAVED_MESSAGE, "info");
  return { kind: "saved", config: nextConfig, update };
}

export async function runFastSettings(dependencies: FastSettingsDependencies): Promise<FastSettingsResult> {
  const config = dependencies.initialConfig ?? (await dependencies.configStore.load(dependencies.cwd));
  const promptResult = await collectFastSettingsUpdate(dependencies.ui, config);

  if (promptResult.kind === "cancelled") {
    return { kind: "cancelled", config };
  }

  return await saveFastSettingsUpdate(dependencies, config, promptResult.update);
}
