import type { FastConfig } from "./fast-config-store.ts";

export interface StartupFastDesiredResolutionInput {
  config: Pick<FastConfig, "persistState" | "desiredActive">;
  startupFastOverride: boolean;
  fastDesiredHandoff: boolean | undefined;
}

export function resolveStartupDesiredActive(input: StartupFastDesiredResolutionInput): boolean {
  if (input.startupFastOverride) {
    return true;
  }

  if (input.fastDesiredHandoff !== undefined) {
    return input.fastDesiredHandoff;
  }

  return input.config.persistState ? input.config.desiredActive : false;
}
