# pi-openai-fast

Pi extension for OpenAI Fast Mode.

## Install

```bash
pi install git:github.com/studioarray/pi-openai-fast
```

## Commands and CLI flags

- `/fast` toggles the **Desired Fast State** for the current Pi process. With `persistState: true` it also writes `desiredActive`; with `persistState: false` it is session-only and does not write config.
- Every accepted `/fast` toggle mirrors the new **Desired Fast State** into the **Fast Desired Handoff** environment value, `PI_OPENAI_FAST_DESIRED=1` or `PI_OPENAI_FAST_DESIRED=0`, so same-process session replacements such as `/new` and newly spawned descendant Pi processes can see the current intent.
- If a persistent save fails, the current process still keeps the latest **Desired Fast State** and handoff value, but warns that the preference was not saved.
- `--fast` starts one run with **Desired Fast State** enabled and seeds `PI_OPENAI_FAST_DESIRED=1` for descendants of that run. The startup flag itself never writes or persists the Fast preference (`desiredActive`), though normal config loading may still create default config when no config files exist.

## Fast state, handoff, and process boundaries

**Desired Fast State** is the user's intent: Fast Mode requested on or off. **Active Fast State** is the runtime result: desired-on plus the current model being a **Supported Model**. Provider requests receive `service_tier: "priority"`, and footer/status feedback shows `fast`, only while **Active Fast State** is true.

If Fast Mode is desired but the selected model is absent or unsupported, the desired state is preserved but Fast Mode remains inactive until a supported model is selected. Each Pi process checks its own selected model against its own `supportedModels` list before becoming active.

Startup resolves desired state in this order:

1. `--fast` wins and starts desired-on.
2. Exact `PI_OPENAI_FAST_DESIRED=1` or `PI_OPENAI_FAST_DESIRED=0` wins over config-derived behavior.
3. Config-derived behavior applies last: `desiredActive` is used only when `persistState` is `true`; otherwise startup defaults to desired-off.

Invalid handoff values are warned about, ignored, and treated as if no handoff value was present, so normal config-derived behavior can still apply.

The **Fast Desired Handoff** is a general environment handoff for descendant Pi processes; it is not subagents-specific. It is inherited only by processes that start after the value is set. Already-running child or descendant processes do not update retroactively after a parent toggles `/fast`, and a child process that does not load `pi-openai-fast` cannot apply this extension's behavior.

A session-only `/fast` toggle survives same-process replacements and descendants through `PI_OPENAI_FAST_DESIRED`, but it disappears on normal Pi process exit unless either `persistState: true` saved `desiredActive` or the next Pi process inherits a `PI_OPENAI_FAST_DESIRED` value from its parent environment.

## Default supported models

```json
[
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5"
]
```

Fast Mode activates only when the current model matches one of these default entries. To change the list, edit `supportedModels` as shown in the config below.

## Config

Extension config is read from `~/.pi/agent/extensions/pi-openai-fast.json` and `.pi/extensions/pi-openai-fast.json`. Project config overrides global config for known fields.

By default, `/fast` is session-only because `persistState` defaults to `false`. Set `persistState` to `true` in JSON to have `/fast` write `desiredActive` for future sessions.

Default config:

```json
{
  "persistState": false,
  "desiredActive": false,
  "supportedModels": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5"
  ],
  "footer": {
    "mode": "replace",
    "vars": {}
  }
}
```

The default shape intentionally omits `footer.darkFastColor` and `footer.lightFastColor`. Missing color fields mean there is no **Fast Label Color Override**.

`supportedModels` controls which models are **Supported Models**:

- Each entry is an exact Pi model key in the form `provider/model`, for example `openai/gpt-5.5`.
- Matching is exact. Wildcard, prefix, and regex-like entries are ignored rather than treated as patterns.
- An explicit empty list is valid and intentionally disables all Fast activation.
- Invalid entries are ignored with warnings; valid entries in the same list are still kept.

`footer.mode` values:

- `replace` installs the extension-owned Footer Clone and shows inline `fast` after the model name only while **Active Fast State** is true.
- `status` leaves Pi's footer in place and publishes only a plain `fast` status indicator while active. It does not apply **Theme-Matched Fast Label Color** or color overrides.
- `off` leaves footer/status UI untouched. Service-tier injection still follows **Active Fast State** independently of footer mode.

## Fast label colors

In `replace` mode, an active **Fast Label** uses **Theme-Matched Fast Label Color** by default. For thinking levels `minimal`, `low`, `medium`, `high`, and `xhigh`, the label is rendered with Pi's current thinking-border color. Thinking `off`, missing or unexpected thinking levels, and missing theme support fall back to the surrounding dim footer styling. The old pink/red literals are not active defaults.

Advanced users can opt in to a **Fast Label Color Override** by setting `footer.darkFastColor` and/or `footer.lightFastColor`. Valid override values are:

- six-digit hex strings such as `"#112233"`
- 256-color indexes as numbers or numeric strings, such as `42` or `"42"`
- variable references from `footer.vars`, including nested variables
- an empty string `""` to request the terminal default foreground

Theme selection is explicit: Pi theme name `light` selects `lightFastColor`; every other theme name selects `darkFastColor`. If the selected theme-specific override is absent or invalid, the extension uses **Theme-Matched Fast Label Color** instead of falling back to the sibling override.

Invalid override values, missing variables, and circular variables are ignored and reported through the normal config warning paths when the config layer can be validated. A lower-priority valid override may still apply; otherwise the label falls back to **Theme-Matched Fast Label Color**.

### Legacy Fast Label Color migration

Older generated config may contain direct literal **Legacy Fast Label Color** values: `#ff50be` for the dark field or `#d20000` for the light field. Direct legacy literals are treated as unset during load and merge, with surrounding whitespace ignored and hex case ignored, so they do not block theme-matched behavior or override real custom colors from another config layer. Successful config writes remove those direct legacy literal fields while preserving real overrides, `footer.vars`, sibling footer settings, and unknown user-owned fields.

If you intentionally want one of the old literal colors, re-express it through a variable-valued **Fast Label Color Override** so the value is clearly user-owned:

```json
{
  "footer": {
    "mode": "replace",
    "vars": {
      "oldFastPink": "#ff50be",
      "oldFastRed": "#d20000"
    },
    "darkFastColor": "oldFastPink",
    "lightFastColor": "oldFastRed"
  }
}
```

## Warnings and config repair

Warnings from config loading, config writes, supported-model normalization, Fast label color normalization, and invalid Fast Desired Handoff values are shown through Pi UI notifications when a UI warning sink is available. Headless runs fall back to console warnings prefixed with `[pi-openai-fast]`. Warning delivery failures are ignored so startup, command handling, and rendering can continue.

A **Malformed Fast Config** is a selected config file that exists but cannot be read as a JSON object. Loading remains tolerant and can fall back to other layers or defaults, but preference writes are conservative:

- Writes target project config when it exists; otherwise they target global config.
- If the selected write target is a **Malformed Fast Config**, the file is preserved byte-for-byte and `desiredActive` is not written.
- A malformed project config prevents writing that project target instead of falling back to overwrite global config.
- Repair the malformed JSON manually before `/fast` preference saves can persist again.

Unknown user-owned config fields are preserved on successful writes, while known invalid fields may be sanitized. The legacy `active` field is read only as a migration alias when `desiredActive` is missing and is omitted on write.

## Reference attribution

Inspired by [pi-better-openai](https://github.com/mattleong/pi-better-openai/).
