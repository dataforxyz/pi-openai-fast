import type {
  BeforeProviderRequestEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEvent,
} from "@earendil-works/pi-coding-agent";
import { FAST_COMMAND } from "./capabilities.ts";
import { executeFastCommand } from "./fast-command.ts";
import { DEFAULT_FAST_CONFIG, FastConfigStore, type FastConfig, type FastConfigRepository } from "./fast-config-store.ts";
import { readFastDesiredHandoff } from "./fast-desired-handoff.ts";
import { FastStateEngine } from "./fast-state-engine.ts";
import { FooterFeedback } from "./footer-feedback.ts";
import { ServiceTierInjector } from "./service-tier-injector.ts";
import { isStartupFastOverrideRequested, registerStartupFastOverrideFlag } from "./startup-fast-override.ts";
import { resolveStartupDesiredActive } from "./startup-fast-resolution.ts";

type ModelSelectEvent = Extract<ExtensionEvent, { type: "model_select" }>;

export interface PiOpenAIFastRuntimeOptions {
  configStore?: FastConfigRepository;
  stateEngine?: FastStateEngine;
  serviceTierInjector?: ServiceTierInjector;
  footerFeedback?: FooterFeedback;
}

function cloneDefaultConfig(): FastConfig {
  return {
    persistState: DEFAULT_FAST_CONFIG.persistState,
    desiredActive: DEFAULT_FAST_CONFIG.desiredActive,
    supportedModels: [...DEFAULT_FAST_CONFIG.supportedModels],
    footer: { ...DEFAULT_FAST_CONFIG.footer, vars: { ...DEFAULT_FAST_CONFIG.footer.vars } },
  };
}

/**
 * Package-level registration boundary for the focused Fast Mode extension.
 *
 * This lifecycle module wires Pi command and provider-request hooks while
 * leaving command parsing, state derivation, config persistence, and payload
 * mutation in their own modules.
 */
export function registerPiOpenAIFast(pi: ExtensionAPI, options: PiOpenAIFastRuntimeOptions = {}): void {
  const configStore = options.configStore ?? new FastConfigStore();
  const stateEngine =
    options.stateEngine ??
    new FastStateEngine({
      desiredActive: DEFAULT_FAST_CONFIG.desiredActive,
      supportedModels: DEFAULT_FAST_CONFIG.supportedModels,
    });
  const serviceTierInjector = options.serviceTierInjector ?? new ServiceTierInjector();
  const footerFeedback = options.footerFeedback ?? new FooterFeedback();

  registerStartupFastOverrideFlag(pi);

  let configLoaded = false;
  let currentConfig = cloneDefaultConfig();

  function getUiForFooterFeedback(ui: ExtensionContext["ui"] | undefined): {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setFooter: ExtensionContext["ui"]["setFooter"] | undefined;
    setStatus: ExtensionContext["ui"]["setStatus"] | undefined;
  } {
    return {
      notify(message, type) {
        ui?.notify?.(message, type);
      },
      setFooter: typeof ui?.setFooter === "function" ? ui.setFooter.bind(ui) : undefined,
      setStatus: typeof ui?.setStatus === "function" ? ui.setStatus.bind(ui) : undefined,
    };
  }

  function getNotifier(ui: ExtensionContext["ui"] | undefined):
    | { notify(message: string, type: "info" | "warning" | "error"): void }
    | undefined
  {
    if (typeof ui?.notify === "function") {
      return { notify: ui.notify.bind(ui) };
    }

    return undefined;
  }

  function notifyUi(ui: ExtensionContext["ui"] | undefined, message: string, type: "info" | "warning" | "error"): void {
    ui?.notify?.(message, type);
  }

  function syncFooter(ctx: ExtensionContext, currentModel = ctx.model): void {
    footerFeedback.syncFooterMode(currentConfig.footer.mode, getUiForFooterFeedback(ctx.ui), {
      context: {
        model: currentModel,
        sessionManager: ctx.sessionManager,
        modelRegistry: ctx.modelRegistry,
        getContextUsage: () => ctx.getContextUsage(),
      },
      isFastActive: () => stateEngine.snapshot().active,
      getThinkingLevel: () => pi.getThinkingLevel(),
      fastLabelColors: {
        dark: currentConfig.footer.darkFastColor,
        light: currentConfig.footer.lightFastColor,
        vars: { ...currentConfig.footer.vars },
      },
    });
  }

  async function loadConfig(
    ctx: ExtensionContext,
    currentModel = ctx.model,
  ): Promise<FastConfig> {
    currentConfig = await configStore.load(ctx.cwd);
    configLoaded = true;
    const startupFastOverride = isStartupFastOverrideRequested(pi);
    const transition = stateEngine.transition({
      supportedModels: currentConfig.supportedModels,
      desiredActive: resolveStartupDesiredActive({
        config: currentConfig,
        startupFastOverride,
        fastDesiredHandoff: readFastDesiredHandoff(),
      }),
      startupFastOverride,
      currentModel,
    });
    footerFeedback.notifyForTransition(transition, getNotifier(ctx.ui));
    syncFooter(ctx, currentModel);
    return currentConfig;
  }

  async function ensureConfig(ctx: ExtensionContext): Promise<FastConfig> {
    if (!configLoaded) {
      return await loadConfig(ctx);
    }

    return currentConfig;
  }

  pi.registerCommand(FAST_COMMAND, {
    description: "Toggle Fast Mode priority service tier",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const config = await ensureConfig(ctx);
      const result = await executeFastCommand(args, {
        stateEngine,
        config,
        currentModel: ctx.model,
        saveDesiredActive: (desiredActive) => configStore.writeDesiredActive(ctx.cwd, desiredActive),
        notify: (message, type) => notifyUi(ctx.ui, message, type),
      });

      if (result.kind === "toggled") {
        currentConfig = { ...currentConfig, desiredActive: result.state.desiredActive };
        footerFeedback.notifyForTransition(result.transition, getNotifier(ctx.ui));
        syncFooter(ctx);
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await loadConfig(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx: ExtensionContext) => {
    footerFeedback.cleanup(getUiForFooterFeedback(ctx.ui));
  });

  pi.on("model_select", async (event: ModelSelectEvent, ctx: ExtensionContext) => {
    if (!configLoaded) {
      await loadConfig(ctx, event.model);
      return;
    }

    const transition = stateEngine.transition({ currentModel: event.model });
    footerFeedback.notifyForTransition(transition, getNotifier(ctx.ui));
    syncFooter(ctx, event.model);
  });

  pi.on("thinking_level_select", (_event, ctx: ExtensionContext) => {
    if (configLoaded) {
      syncFooter(ctx);
    }
  });

  pi.on("before_provider_request", (event: BeforeProviderRequestEvent) => {
    const nextPayload = serviceTierInjector.inject(event.payload, stateEngine.snapshot());
    return nextPayload === event.payload ? undefined : nextPayload;
  });
}
