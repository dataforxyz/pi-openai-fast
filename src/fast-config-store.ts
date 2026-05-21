import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { FastColorValue } from "./fast-colors.ts";
import { normalizeFastColorValue } from "./fast-colors.ts";

export const DEFAULT_SUPPORTED_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
] as const;

export type FooterMode = "replace" | "status" | "off";

export interface FastFooterConfig {
  mode: FooterMode;
  vars: Record<string, string>;
  darkFastColor: FastColorValue;
  lightFastColor: FastColorValue;
}

export interface FastConfig {
  persistState: boolean;
  desiredActive: boolean;
  supportedModels: string[];
  footer: FastFooterConfig;
}

export const DEFAULT_FAST_CONFIG: FastConfig = {
  persistState: false,
  desiredActive: false,
  supportedModels: [...DEFAULT_SUPPORTED_MODELS],
  footer: {
    mode: "replace",
    vars: {},
    darkFastColor: "#ff50be",
    lightFastColor: "#d20000",
  },
};

export type FastConfigWarningCode = "config-read-failed" | "config-default-write-failed" | "config-write-failed";

export interface FastConfigWarning {
  code: FastConfigWarningCode;
  path: string;
  message: string;
  cause?: unknown;
}

export type FastConfigWarningSink = (warning: FastConfigWarning) => void;

export interface FastConfigStoreOptions {
  home?: string;
  warn?: FastConfigWarningSink;
}

export interface FastConfigRepository {
  load(cwd: string): Promise<FastConfig>;
  writeDesiredActive(cwd: string, desiredActive: boolean): Promise<boolean>;
}

interface FastConfigPaths {
  project: string;
  global: string;
}

type JsonRecord = Record<string, unknown>;

function defaultFastConfig(): FastConfig {
  return {
    persistState: DEFAULT_FAST_CONFIG.persistState,
    desiredActive: DEFAULT_FAST_CONFIG.desiredActive,
    supportedModels: [...DEFAULT_FAST_CONFIG.supportedModels],
    footer: {
      mode: DEFAULT_FAST_CONFIG.footer.mode,
      vars: { ...DEFAULT_FAST_CONFIG.footer.vars },
      darkFastColor: DEFAULT_FAST_CONFIG.footer.darkFastColor,
      lightFastColor: DEFAULT_FAST_CONFIG.footer.lightFastColor,
    },
  };
}

function configToRawRecord(config: FastConfig): JsonRecord {
  return {
    persistState: config.persistState,
    desiredActive: config.desiredActive,
    supportedModels: [...config.supportedModels],
    footer: {
      mode: config.footer.mode,
      vars: { ...config.footer.vars },
      darkFastColor: config.footer.darkFastColor,
      lightFastColor: config.footer.lightFastColor,
    },
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFooterMode(value: unknown): value is FooterMode {
  return value === "replace" || value === "status" || value === "off";
}

function normalizeSupportedModelEntry(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf("/");

  if (
    trimmed.length === 0 ||
    /\s/.test(trimmed) ||
    separatorIndex <= 0 ||
    separatorIndex === trimmed.length - 1
  ) {
    return undefined;
  }

  return trimmed;
}

function normalizeSupportedModels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry) => {
    const normalized = normalizeSupportedModelEntry(entry);
    return normalized === undefined ? [] : [normalized];
  });
}

function parseJsonRecord(text: string): JsonRecord {
  const parsed: unknown = JSON.parse(text);

  if (!isRecord(parsed)) {
    throw new Error("Config JSON must be an object.");
  }

  return parsed;
}

function normalizeStringRecord(source: JsonRecord): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function hasOwnField(record: JsonRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function migratedDesiredActive(source: JsonRecord, fallback: boolean): boolean {
  if (typeof source.desiredActive === "boolean") {
    return source.desiredActive;
  }

  if (!hasOwnField(source, "desiredActive") && typeof source.active === "boolean") {
    return source.active;
  }

  return fallback;
}

function sanitizeFooterRecordForWrite(source: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...source };

  if (hasOwnField(next, "mode") && !isFooterMode(next.mode)) {
    delete next.mode;
  }

  if (hasOwnField(next, "vars")) {
    if (isRecord(next.vars)) {
      next.vars = normalizeStringRecord(next.vars);
    } else {
      delete next.vars;
    }
  }

  if (hasOwnField(next, "darkFastColor")) {
    const darkFastColor = normalizeFastColorValue(next.darkFastColor);
    if (darkFastColor === undefined) {
      delete next.darkFastColor;
    } else {
      next.darkFastColor = darkFastColor;
    }
  }

  if (hasOwnField(next, "lightFastColor")) {
    const lightFastColor = normalizeFastColorValue(next.lightFastColor);
    if (lightFastColor === undefined) {
      delete next.lightFastColor;
    } else {
      next.lightFastColor = lightFastColor;
    }
  }

  return next;
}

function sanitizeConfigRecordForWrite(source: JsonRecord): JsonRecord {
  const next: JsonRecord = { ...source };

  delete next.active;

  if (hasOwnField(next, "persistState") && typeof next.persistState !== "boolean") {
    delete next.persistState;
  }

  if (hasOwnField(next, "desiredActive") && typeof next.desiredActive !== "boolean") {
    delete next.desiredActive;
  }

  if (hasOwnField(next, "supportedModels")) {
    const supportedModels = normalizeSupportedModels(next.supportedModels);
    if (supportedModels) {
      next.supportedModels = supportedModels;
    } else {
      delete next.supportedModels;
    }
  }

  if (hasOwnField(next, "footer")) {
    if (isRecord(next.footer)) {
      next.footer = sanitizeFooterRecordForWrite(next.footer);
    } else {
      delete next.footer;
    }
  }

  return next;
}

function mergeKnownConfig(base: FastConfig, source: JsonRecord): FastConfig {
  const next: FastConfig = {
    ...base,
    supportedModels: [...base.supportedModels],
    footer: { ...base.footer, vars: { ...base.footer.vars } },
  };

  if (typeof source.persistState === "boolean") {
    next.persistState = source.persistState;
  }
  next.desiredActive = migratedDesiredActive(source, next.desiredActive);
  const supportedModels = normalizeSupportedModels(source.supportedModels);
  if (supportedModels) {
    next.supportedModels = supportedModels;
  }
  if (isRecord(source.footer)) {
    if (isFooterMode(source.footer.mode)) {
      next.footer.mode = source.footer.mode;
    }
    if (isRecord(source.footer.vars)) {
      next.footer.vars = normalizeStringRecord(source.footer.vars);
    }
    const darkFastColor = normalizeFastColorValue(source.footer.darkFastColor);
    if (darkFastColor !== undefined) {
      next.footer.darkFastColor = darkFastColor;
    }
    const lightFastColor = normalizeFastColorValue(source.footer.lightFastColor);
    if (lightFastColor !== undefined) {
      next.footer.lightFastColor = lightFastColor;
    }
  }

  return next;
}

type ConfigReadResult =
  | { kind: "missing" }
  | { kind: "loaded"; record: JsonRecord }
  | { kind: "failed" };

function defaultWarningSink(warning: FastConfigWarning): void {
  console.warn(`[pi-openai-fast] ${warning.message}`);
}

function emitWarning(warn: FastConfigWarningSink, warning: FastConfigWarning): void {
  try {
    warn(warning);
  } catch {
    // A warning sink should not turn config fallback into a startup failure.
  }
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    return !isMissingPathError(error);
  }
}

async function readConfigRecord(path: string, warn: FastConfigWarningSink): Promise<ConfigReadResult> {
  try {
    return { kind: "loaded", record: parseJsonRecord(await readFile(path, "utf8")) };
  } catch (error) {
    if (isMissingPathError(error)) {
      return { kind: "missing" };
    }

    emitWarning(warn, {
      code: "config-read-failed",
      path,
      message: `Could not read pi-openai-fast config at ${path}; using defaults for that config layer.`,
      cause: error,
    });
    return { kind: "failed" };
  }
}

async function writeConfigRecord(
  path: string,
  record: JsonRecord,
  warn: FastConfigWarningSink,
  code: FastConfigWarningCode,
): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return true;
  } catch (error) {
    emitWarning(warn, {
      code,
      path,
      message: `Could not write pi-openai-fast config at ${path}; the config update was not saved.`,
      cause: error,
    });
    return false;
  }
}

async function selectWriteTarget(paths: FastConfigPaths): Promise<string> {
  return (await pathExists(paths.project)) ? paths.project : paths.global;
}

function rawRecordForWrite(readResult: ConfigReadResult): JsonRecord {
  if (readResult.kind === "loaded") {
    return readResult.record;
  }

  if (readResult.kind === "missing") {
    return configToRawRecord(defaultFastConfig());
  }

  return {};
}

export class FastConfigStore implements FastConfigRepository {
  private readonly home: string;
  private readonly warn: FastConfigWarningSink;

  constructor(options: FastConfigStoreOptions = {}) {
    this.home = options.home ?? homedir();
    this.warn = options.warn ?? defaultWarningSink;
  }

  paths(cwd: string): FastConfigPaths {
    return {
      project: join(cwd, ".pi", "extensions", "pi-openai-fast.json"),
      global: join(this.home, ".pi", "agent", "extensions", "pi-openai-fast.json"),
    };
  }

  async load(cwd: string): Promise<FastConfig> {
    const paths = this.paths(cwd);
    let config = defaultFastConfig();

    const globalConfig = await readConfigRecord(paths.global, this.warn);
    const projectConfig = await readConfigRecord(paths.project, this.warn);

    if (globalConfig.kind === "missing" && projectConfig.kind === "missing") {
      await writeConfigRecord(paths.global, configToRawRecord(config), this.warn, "config-default-write-failed");
      return config;
    }

    if (globalConfig.kind === "loaded") {
      config = mergeKnownConfig(config, globalConfig.record);
    }

    if (projectConfig.kind === "loaded") {
      config = mergeKnownConfig(config, projectConfig.record);
    }

    return config;
  }

  async writeDesiredActive(cwd: string, desiredActive: boolean): Promise<boolean> {
    const paths = this.paths(cwd);
    const target = await selectWriteTarget(paths);
    const existing = await readConfigRecord(target, this.warn);
    const next = sanitizeConfigRecordForWrite(rawRecordForWrite(existing));
    next.desiredActive = desiredActive;

    return await writeConfigRecord(target, next, this.warn, "config-write-failed");
  }
}
