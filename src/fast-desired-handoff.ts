export const FAST_DESIRED_HANDOFF_ENV = "PI_OPENAI_FAST_DESIRED";

export type FastDesiredHandoffEnvironment = Readonly<Record<string, string | undefined>>;
export type WritableFastDesiredHandoffEnvironment = Record<string, string | undefined>;

export function readFastDesiredHandoff(env: FastDesiredHandoffEnvironment = process.env): boolean | undefined {
  const value = env[FAST_DESIRED_HANDOFF_ENV];

  if (value === "1") {
    return true;
  }

  if (value === "0") {
    return false;
  }

  return undefined;
}

export function writeFastDesiredHandoff(
  desiredActive: boolean,
  env: WritableFastDesiredHandoffEnvironment = process.env,
): void {
  env[FAST_DESIRED_HANDOFF_ENV] = desiredActive ? "1" : "0";
}
